import type { LlmProvider, ChatMessage } from "../llm/types";
import { OPENAI_TOOLS } from "../../tools/registry";
import { executeToolCall } from "./tool-executor";
import { SYSTEM_PROMPT } from "./conversation-policy";
import { agentResponseSchema, safeStructuredFallback, type AgentResponse } from "./report-schema";
import { guardResponse } from "./language-guard";
import { classifyEvidenceRequest, argumentsForRequiredTool, type EvidenceRoute } from "./evidence-routing-policy";
import { verifyEvidenceIntegrity } from "../evidence/evidence-integrity";
import { detectLikelyPii } from "../../examples/schema";
import { makeEvidenceRecord, buildEvidenceLedger, type EvidenceRecord } from "./evidence-ledger";
import { buildStructuredEvidenceReport, type EvidenceReport } from "./structured-evidence-report";
import { validateClaims } from "./claim-evidence-validator";

export const MAX_TOOL_ROUNDS = 4;
export type ToolTrace = { round: number; tool: string; status: "OK" | "ERROR"; summary: string; result_id?: string };
export type OrchestratorResult = {
  response: AgentResponse;
  evidence_report: EvidenceReport;
  tool_trace: ToolTrace[];
  guard_applied: boolean;
  claim_validation: { valid: boolean; violations: string[]; regeneration_attempted: boolean };
  provider: string;
  model: string;
  rounds: number;
};

function outOfScopeResponse(reason = "This request is outside the scope of MathEff-Agent."): AgentResponse {
  return {
    summary: reason,
    evidence_interpretation: [],
    uncertainty: ["MathEff-Agent only supports organization and interpretation of the frozen mathematics-learning evidence included in this project."],
    follow_up_questions: ["Would you like help organizing supported MRLE profile, DML-association, sensitivity, or provenance evidence?"],
    cautions: ["No unsupported analysis was performed."],
    tools_used: [],
  };
}

function enforceCausalBoundary(response: AgentResponse): AgentResponse {
  const text = JSON.stringify(response);
  if (/cannot|does not|not establish|unable/i.test(text) && /caus/i.test(text) && /individual|case/i.test(text) && /population|association/i.test(text)) return response;
  return {
    summary: "The available evidence cannot establish individual causation.",
    evidence_interpretation: response.evidence_interpretation,
    uncertainty: ["Case-level profile evidence is descriptive, while DML estimates are population-level adjusted associations with context-adjusted MRLE; neither establishes individual causation.", ...response.uncertainty],
    follow_up_questions: response.follow_up_questions.length ? response.follow_up_questions : ["Which contextual factors warrant further examination by a qualified professional?"],
    cautions: ["Do not convert population-level associations into an individual causal diagnosis or intervention prescription.", ...response.cautions],
    tools_used: response.tools_used,
  };
}

function safeEvidenceFallback(records: EvidenceRecord[], detail: string): AgentResponse {
  const dml = records.find((record) => record.tool === "get_dml_evidence" && record.status === "OK")?.output as { factor?: string; single?: { estimate: number; ci_low: number; ci_high: number }; mutual?: { estimate: number; ci_low: number; ci_high: number } } | undefined;
  const profile = records.find((record) => record.tool === "analyze_profile_stability" && record.status === "OK")?.output as { modal_profile?: string; modal_count?: number } | undefined;
  const interpretation: string[] = [];
  if (dml?.single && dml.mutual) interpretation.push(`${dml.factor} single estimate ${dml.single.estimate} with CI [${dml.single.ci_low}, ${dml.single.ci_high}] and mutual estimate ${dml.mutual.estimate} with CI [${dml.mutual.ci_low}, ${dml.mutual.ci_high}]; these are population-level adjusted associations with MRLE.`);
  if (profile?.modal_profile) interpretation.push(`The modal descriptive profile was ${profile.modal_profile}, observed in ${profile.modal_count} of 10 plausible-value-specific results.`);
  return {
    summary: "A deterministic evidence-bounded fallback was used because the generated wording did not pass claim validation.",
    evidence_interpretation: interpretation,
    uncertainty: [detail.replace(/:-?\d+(?:\.\d+)?/g, ""), "Plausible-value, profile-boundary, confidence-interval, and robustness uncertainty remain distinct."],
    follow_up_questions: ["Which supported evidence dimension should be reviewed next?"],
    cautions: ["This is not an individual causal, diagnostic, risk/protective, or intervention conclusion."],
    tools_used: [...new Set(records.map((record) => record.tool))],
  };
}

function hasPiiInQuery(query: string) {
  return /[^\s@]+@[^\s@]+\.[^\s@]+/.test(query) || /(?:\+?\d[\d\s().-]{6,}\d)/.test(query);
}

function containsCjkResponse(response: AgentResponse) {
  return /[\u3400-\u9fff]/.test(JSON.stringify(response));
}

async function finalize(input: { response: AgentResponse; route: EvidenceRoute; records: EvidenceRecord[]; traces: ToolTrace[]; provider: LlmProvider; model: string; rounds: number; guardApplied: boolean; validation: { valid: boolean; violations: string[] }; repairAttempted: boolean }): Promise<OrchestratorResult> {
  const ledger = await buildEvidenceLedger({ records: input.records, factor: input.route.factor, sensitivity: input.route.sensitivity });
  const evidenceReport = buildStructuredEvidenceReport(input.route, input.records, ledger);
  return { response: input.response, evidence_report: evidenceReport, tool_trace: input.traces, guard_applied: input.guardApplied, claim_validation: { ...input.validation, regeneration_attempted: input.repairAttempted }, provider: input.provider.name, model: input.model, rounds: input.rounds };
}

export async function runEvidenceAgent(provider: LlmProvider, query: string, caseEvidence?: unknown): Promise<OrchestratorResult> {
  const route = classifyEvidenceRequest(query, caseEvidence != null);
  const records: EvidenceRecord[] = [];
  const traces: ToolTrace[] = [];
  const integrity = await verifyEvidenceIntegrity();
  if (!integrity.ok) {
    const record = await makeEvidenceRecord(1, "verify_evidence_integrity", {}, { ok: false, error: integrity.errors.join(";") }); records.push(record);
    traces.push({ round: 0, tool: "verify_evidence_integrity", status: "ERROR", summary: integrity.errors.join(";"), result_id: record.result_id });
    const response = outOfScopeResponse("Evidence loading was blocked because the frozen evidence version or hash did not match the declared manifest.");
    return finalize({ response, route, records, traces, provider, model: provider.model, rounds: 0, guardApplied: true, validation: { valid: true, violations: [] }, repairAttempted: false });
  }
  if (hasPiiInQuery(query) || (caseEvidence != null && detectLikelyPii(caseEvidence).length > 0)) {
    const response = outOfScopeResponse("The request was not processed because identity-bearing or contact information was detected. Use a pseudonymous case ID and only the minimum statistical evidence fields.");
    return finalize({ response, route, records, traces, provider, model: provider.model, rounds: 0, guardApplied: true, validation: { valid: true, violations: [] }, repairAttempted: false });
  }
  if (route.intent === "OUT_OF_SCOPE") {
    const response = outOfScopeResponse();
    return finalize({ response, route, records, traces, provider, model: provider.model, rounds: 0, guardApplied: false, validation: { valid: true, violations: [] }, repairAttempted: false });
  }

  for (const tool of route.required_tools) {
    const args = argumentsForRequiredTool(tool, route, caseEvidence);
    if (!args) continue;
    const execution = await executeToolCall(tool, JSON.stringify(args));
    const record = await makeEvidenceRecord(records.length + 1, tool, args, execution); records.push(record);
    traces.push({ round: 0, tool, status: record.status, summary: record.status === "OK" ? "Mandatory deterministic evidence retrieved by routing policy." : `Mandatory evidence unavailable: ${record.error}`, result_id: record.result_id });
  }

  const allowedTools = new Set(route.required_tools);
  const completedMandatory = new Set(records.filter((record) => record.status === "OK").map((record) => record.tool));
  const routedTools = OPENAI_TOOLS.filter((tool) => allowedTools.has(tool.function.name) && !completedMandatory.has(tool.function.name));
  const routeInstruction = `The deterministic routing policy classified this as ${route.intent}. Mandatory tools have already been executed. Synthesize only the supplied tool evidence. Never invent a number, factor, sample, confidence interval, specification, sensitivity result, or source. Use "unavailable" when evidence is absent. Respond to every user-facing field in English, even when the user writes in another language. Routed tools: ${route.required_tools.join(", ")}.`;
  const evidencePayload = records.map((record) => ({ result_id: record.result_id, tool: record.tool, status: record.status, output: record.output, error: record.error }));
  const messages: ChatMessage[] = [
    { role: "system", content: `${SYSTEM_PROMPT}\n${routeInstruction}` },
    { role: "user", content: JSON.stringify({ query, case_evidence: caseEvidence ?? null, mandatory_tool_evidence: evidencePayload }) },
  ];
  const focalFactorsSupplied = caseEvidence && typeof caseEvidence === "object" && "factor_values" in caseEvidence && caseEvidence.factor_values && typeof caseEvidence.factor_values === "object" ? Object.keys(caseEvidence.factor_values) : [];
  const guardContext = { route_kind: route.intent === "PROFILE_QUERY" ? "PROFILE" : route.intent, focal_factors_supplied: focalFactorsSupplied, dml_outcome: "context-adjusted MRLE", tools_used: records.filter((record) => record.status === "OK").map((record) => record.tool) };
  const invalidRetries = new Map<string, number>();
  let rounds = 0; let lastModel = provider.model; let anyGuardApplied = false; let claimRepairAttempted = false;

  while (rounds < MAX_TOOL_ROUNDS) {
    rounds += 1;
    const completion = await provider.complete({ messages, tools: routedTools.length ? routedTools : undefined, response_format: { type: "json_object" }, temperature: 0.1, max_tokens: 1800 });
    lastModel = completion.model; messages.push(completion.message); const calls = completion.message.tool_calls ?? [];
    if (calls.length) {
      for (const call of calls) {
        if (!allowedTools.has(call.function.name) || completedMandatory.has(call.function.name)) {
          traces.push({ round: rounds, tool: call.function.name, status: "ERROR", summary: "Rejected by intent-specific tool allowlist." });
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ ok: false, error: "TOOL_NOT_ALLOWED_FOR_INTENT" }) });
          continue;
        }
        const execution = await executeToolCall(call.function.name, call.function.arguments);
        const invalid = !execution.ok && (execution.error === "INVALID_JSON_ARGUMENTS" || execution.error === "INVALID_TOOL_ARGUMENTS");
        if (invalid) {
          const retries = invalidRetries.get(call.function.name) ?? 0; invalidRetries.set(call.function.name, retries + 1);
          if (retries >= 1) { messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ ok: false, error: "INVALID_ARGUMENT_RETRY_LIMIT" }) }); continue; }
        }
        let parsedInput: unknown = {}; try { parsedInput = JSON.parse(call.function.arguments || "{}"); } catch { parsedInput = {}; }
        const record = await makeEvidenceRecord(records.length + 1, call.function.name, parsedInput, execution); records.push(record);
        traces.push({ round: rounds, tool: call.function.name, status: record.status, summary: record.status === "OK" ? "Validated deterministic evidence output returned." : `Rejected: ${record.error}`, result_id: record.result_id });
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ ...execution, result_id: record.result_id }) });
      }
      continue;
    }

    let json: unknown = null; try { json = JSON.parse(completion.message.content ?? "{}"); } catch { json = null; }
    const parsed = agentResponseSchema.safeParse(json);
    if (!parsed.success && rounds < MAX_TOOL_ROUNDS) {
      messages.push({ role: "user", content: "Return one valid JSON object with exactly: summary (string), evidence_interpretation (string array), uncertainty (string array), follow_up_questions (string array), cautions (string array), tools_used (string array)." });
      continue;
    }
    const base = parsed.success ? parsed.data : safeStructuredFallback(records.map((record) => record.tool), "The provider did not return the required JSON schema after bounded repair.");
    if (containsCjkResponse(base)) {
      if (rounds < MAX_TOOL_ROUNDS) {
        messages.push({ role: "user", content: "Preserve the same evidence and required JSON schema, but rewrite every user-facing string in English only. Do not output Chinese characters." });
        continue;
      }
      const fallback = safeEvidenceFallback(records, "The provider did not satisfy the English-only publication output requirement after bounded repair.");
      return finalize({ response: fallback, route, records, traces, provider, model: lastModel, rounds, guardApplied: true, validation: validateClaims(fallback, records), repairAttempted: claimRepairAttempted });
    }
    base.tools_used = [...new Set([...base.tools_used, ...records.map((record) => record.tool)])];
    const bounded = route.intent === "CAUSAL_BOUNDARY" ? enforceCausalBoundary(base) : base;
    const guarded = guardResponse(bounded, guardContext);
    anyGuardApplied ||= guarded.guard_applied;
    const validation = validateClaims(guarded.response, records);
    if ((!validation.valid || guarded.guard_applied) && !claimRepairAttempted && rounds < MAX_TOOL_ROUNDS) {
      claimRepairAttempted = true;
      messages.push({ role: "user", content: `One evidence-bounded correction is permitted. Violations: ${[...validation.violations, ...guarded.matched].join(", ")}. Use only mandatory_tool_evidence values and preserve their factor/specification/CI associations. If robustness evidence is unavailable, say unavailable. Return only the required JSON object.` });
      continue;
    }
    if (!validation.valid || guarded.guard_applied) {
      const fallback = safeEvidenceFallback(records, [...validation.violations, ...guarded.matched].join(", "));
      const fallbackValidation = validateClaims(fallback, records);
      return finalize({ response: fallback, route, records, traces, provider, model: lastModel, rounds, guardApplied: true, validation: fallbackValidation, repairAttempted: claimRepairAttempted });
    }
    return finalize({ response: guarded.response, route, records, traces, provider, model: lastModel, rounds, guardApplied: anyGuardApplied, validation, repairAttempted: claimRepairAttempted });
  }
  const fallback = safeEvidenceFallback(records, "Tool calling stopped at the four-round safety limit.");
  return finalize({ response: fallback, route, records, traces, provider, model: lastModel, rounds, guardApplied: anyGuardApplied, validation: validateClaims(fallback, records), repairAttempted: claimRepairAttempted });
}
