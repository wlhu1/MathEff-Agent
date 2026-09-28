import { FACTOR_CODES } from "../../examples/schema";
import type { AgentResponse } from "./report-schema";
import type { EvidenceRecord } from "./evidence-ledger";

export type ClaimValidation = { valid: boolean; violations: string[] };
const prohibited = [/\bcausal effect\b/i, /\bmechanism effect\b/i, /\bintervention effect\b/i, /counterfactual (?:effect|prediction|simulation)/i, /validated diagnostic/i, /deterministic diagnosis/i, /precise (?:individual|personalized) diagnosis/i, /\brisk factor\b/i, /\bprotective factor\b/i, /automatic treatment/i, /treatment recommendation/i];

function flattenNumbers(value: unknown, result: number[] = []): number[] {
  if (typeof value === "number" && Number.isFinite(value)) result.push(value);
  else if (typeof value === "string") for (const match of value.matchAll(/(?<![A-Za-z])-?\d+(?:\.\d+)?/g)) result.push(Number(match[0]));
  else if (Array.isArray(value)) value.forEach((item) => flattenNumbers(item, result));
  else if (value && typeof value === "object") Object.values(value as Record<string, unknown>).forEach((item) => flattenNumbers(item, result));
  return result;
}

function closeToAny(value: number, evidence: number[]) {
  return evidence.some((candidate) => Math.abs(candidate - value) <= Math.max(5e-4, Math.abs(candidate) * 1e-6));
}

export function validateClaims(response: AgentResponse, records: EvidenceRecord[]): ClaimValidation {
  const text = [response.summary, ...response.evidence_interpretation, ...response.uncertainty, ...response.follow_up_questions, ...response.cautions].join("\n");
  const violations: string[] = [];
  for (const pattern of prohibited) if (pattern.test(text) && !/(?:not|no|cannot|does not|do not)[^.]{0,80}(?:causal|mechanism|intervention|diagnos|risk|protect)/i.test(text)) violations.push(`PROHIBITED_INTERPRETATION:${pattern.source}`);
  const evidenceNumbers = records.flatMap((record) => flattenNumbers(record.output));
  const structuralNumbers = [0, 1, 3, 4, 8, 10, 19, 24, 95, 100];
  for (const value of flattenNumbers(text)) if (!closeToAny(value, [...evidenceNumbers, ...structuralNumbers])) violations.push(`UNSUPPORTED_NUMERIC_CLAIM:${value}`);
  const uppercaseTokens = text.match(/\b[A-Z][A-Z0-9_]{4,15}\b/g) ?? [];
  const permittedTokens = new Set([...FACTOR_CODES, "MRLE", "DML", "ICT", "PISA", "BRR", "PV"]);
  for (const token of uppercaseTokens) if (!permittedTokens.has(token as typeof FACTOR_CODES[number]) && !["SINGLE", "MUTUAL", "BOUNDARY", "SUPPORTED", "UNAVAILABLE", "HIGH_SCORE_HIGH_MRLE", "HIGH_SCORE_LOW_MRLE", "LOW_SCORE_HIGH_MRLE", "LOW_SCORE_LOW_MRLE"].includes(token)) violations.push(`UNKNOWN_FACTOR_OR_CODE:${token}`);
  const sensitivityTools = records.filter((record) => record.tool === "get_sensitivity_evidence" && record.status === "OK");
  if (/equal-system|senate/i.test(text) && !sensitivityTools.some((record) => JSON.stringify(record.output).includes("EQUAL_SYSTEM"))) violations.push("UNSUPPORTED_EQUAL_SYSTEM_CLAIM");
  if (/BRR(?:-Fay)?/i.test(text) && !sensitivityTools.some((record) => JSON.stringify(record.output).includes("BRR_FAY"))) violations.push("UNSUPPORTED_BRR_FAY_CLAIM");
  const dml = records.find((record) => record.tool === "get_dml_evidence" && record.status === "OK")?.output as { single?: { estimate: number }; mutual?: { estimate: number } } | undefined;
  if (dml) {
    const single = text.match(/\bsingle\b[^\d-]{0,30}(-?\d+(?:\.\d+)?)/i);
    const mutual = text.match(/\bmutual(?:ly adjusted)?\b[^\d-]{0,30}(-?\d+(?:\.\d+)?)/i);
    if (single && !closeToAny(Number(single[1]), [dml.single!.estimate])) violations.push("SINGLE_ESTIMATE_MISMATCH");
    if (mutual && !closeToAny(Number(mutual[1]), [dml.mutual!.estimate])) violations.push("MUTUAL_ESTIMATE_MISMATCH");
  }
  return { valid: violations.length === 0, violations: [...new Set(violations)] };
}
