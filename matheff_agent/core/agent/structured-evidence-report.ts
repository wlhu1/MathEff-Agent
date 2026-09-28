import { z } from "zod";
import type { EvidenceRoute } from "./evidence-routing-policy";
import type { EvidenceLedger, EvidenceRecord } from "./evidence-ledger";

const statisticalClaimSchema = z.object({
  factor: z.string(),
  specification: z.enum(["SINGLE", "MUTUAL"]),
  estimate: z.number(),
  ci_low: z.number(),
  ci_high: z.number(),
  pv_sign_consistency: z.string(),
  evidence_result_id: z.string(),
}).strict();

export const evidenceReportSchema = z.object({
  schema_version: z.literal("EVIDENCE_REPORT_V1"),
  report_id: z.string(),
  evidence_version: z.string(),
  route: z.string(),
  scope_status: z.enum(["SUPPORTED", "UNAVAILABLE", "EXCEEDS_SCOPE"]),
  statistical_claims: z.array(statisticalClaimSchema),
  case_evidence_summary: z.unknown().nullable(),
  profile_stability: z.unknown().nullable(),
  boundary_sensitivity: z.unknown().nullable(),
  uncertainty_summary: z.unknown().nullable(),
  benchmark_sensitivity: z.unknown().nullable(),
  weighting_sensitivity: z.unknown().nullable(),
  robustness_evidence: z.unknown().nullable(),
  provenance: z.unknown().nullable(),
  unavailable_evidence: z.array(z.string()),
  professional_follow_up_questions: z.array(z.string()),
  safety_note: z.string(),
  evidence_ledger: z.unknown(),
  interpretation_boundary: z.string(),
}).strict();

export type EvidenceReport = z.infer<typeof evidenceReportSchema> & { evidence_ledger: EvidenceLedger };

export function buildStructuredEvidenceReport(route: EvidenceRoute, records: EvidenceRecord[], ledger: EvidenceLedger): EvidenceReport {
  const dmlRecord = records.find((record) => record.tool === "get_dml_evidence" && record.status === "OK");
  const dml = dmlRecord?.output as { factor?: string; single?: { estimate: number; ci_low: number; ci_high: number; pv_sign_consistency: string }; mutual?: { estimate: number; ci_low: number; ci_high: number; pv_sign_consistency: string } } | undefined;
  const claims = dml && dmlRecord ? (["single", "mutual"] as const).map((specification) => ({ factor: dml.factor ?? route.factor ?? "UNKNOWN", specification: specification.toUpperCase() as "SINGLE" | "MUTUAL", estimate: dml[specification]!.estimate, ci_low: dml[specification]!.ci_low, ci_high: dml[specification]!.ci_high, pv_sign_consistency: dml[specification]!.pv_sign_consistency, evidence_result_id: dmlRecord.result_id })) : [];
  const scope = records.find((record) => record.tool === "check_evidence_scope" && record.status === "OK")?.output as { status?: "SUPPORTED" | "UNAVAILABLE" | "EXCEEDS_SCOPE"; reason?: string } | undefined;
  const uncertainty = records.find((record) => record.tool === "summarize_uncertainty" && record.status === "OK")?.output ?? null;
  const robustness = records.find((record) => record.tool === "get_sensitivity_evidence" && record.status === "OK")?.output ?? null;
  const caseSummary = records.find((record) => record.tool === "generate_evidence_report" && record.status === "OK")?.output ?? null;
  const profile = records.find((record) => record.tool === "analyze_profile_stability" && record.status === "OK")?.output ?? null;
  const boundary = records.find((record) => record.tool === "analyze_boundary_sensitivity" && record.status === "OK")?.output ?? null;
  const provenance = records.find((record) => record.tool === "get_analysis_provenance" && record.status === "OK")?.output ?? null;
  const uncertaintyRobustness = uncertainty && typeof uncertainty === "object" && "robustness" in uncertainty ? (uncertainty as { robustness: unknown }).robustness : null;
  const unavailable = records.filter((record) => record.status === "ERROR").map((record) => `${record.tool}: ${record.error ?? "unavailable"}`);
  for (const requiredTool of route.required_tools) if (!records.some((record) => record.tool === requiredTool && record.status === "OK")) unavailable.push(`${requiredTool}: required evidence was not retrieved`);
  if (scope?.status === "UNAVAILABLE" && scope.reason) unavailable.push(scope.reason);
  return evidenceReportSchema.parse({
    schema_version: "EVIDENCE_REPORT_V1",
    report_id: ledger.report_id,
    evidence_version: ledger.report_evidence_version,
    route: route.intent,
    scope_status: scope?.status ?? (route.supported ? "SUPPORTED" : "EXCEEDS_SCOPE"),
    statistical_claims: claims,
    case_evidence_summary: caseSummary,
    profile_stability: profile,
    boundary_sensitivity: boundary,
    uncertainty_summary: uncertainty,
    benchmark_sensitivity: route.sensitivity === "BENCHMARK" ? uncertaintyRobustness : null,
    weighting_sensitivity: route.sensitivity === "EQUAL_SYSTEM" || route.sensitivity === "BRR_FAY" ? robustness : null,
    robustness_evidence: robustness,
    provenance,
    unavailable_evidence: [...new Set(unavailable)],
    professional_follow_up_questions: ["Which contextual evidence could clarify the observed pattern?", "Does the pattern persist across occasions or independent evidence sources?", "Which supported factors warrant further examination without assuming causation?"],
    safety_note: "This evidence report is a decision-support and evidence-organization artifact, not a validated diagnostic instrument or intervention prescription.",
    evidence_ledger: ledger,
    interpretation_boundary: ledger.interpretation_boundary,
  }) as EvidenceReport;
}
