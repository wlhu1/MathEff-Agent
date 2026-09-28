import { FACTOR_CODES, type CaseEvidence } from "../../examples/schema";

export type EvidenceIntent = "PROFILE_QUERY" | "FACTOR_QUERY" | "ROBUSTNESS_QUERY" | "FULL_CASE_REPORT" | "PROVENANCE_QUERY" | "CAUSAL_BOUNDARY" | "OUT_OF_SCOPE";
export type SensitivityKind = "EQUAL_SYSTEM" | "BRR_FAY" | "BENCHMARK";

export type EvidenceRoute = {
  intent: EvidenceIntent;
  supported: boolean;
  factor?: typeof FACTOR_CODES[number];
  sensitivity?: SensitivityKind;
  required_tools: string[];
  reason: string;
};

const factorPatterns: Array<[typeof FACTOR_CODES[number], RegExp]> = [
  ["MATHEFF", /MATHEFF|MATHEMATICS SELF[- ]EFFICACY/i],
  ["ANXMAT", /ANXMAT|MATHEMATICS ANXIETY/i],
  ["GROSAGR", /GROSAGR|GROWTH MINDSET/i],
  ["DISCLIM", /DISCLIM|DISCIPLINARY CLIMATE/i],
  ["RELATST", /RELATST|STUDENT.?TEACHER RELATIONSHIP/i],
  ["COGACMCO", /COGACMCO|COGNITIVE ACTIVATION/i],
  ["ICTWKDY", /ICTWKDY|WEEKDAY ICT/i],
  ["ICTEFFIC", /ICTEFFIC|DIGITAL COMPETENC/i],
];

export function extractFactor(query: string) {
  return factorPatterns.find(([, pattern]) => pattern.test(query))?.[0];
}

export function classifyEvidenceRequest(query: string, hasCaseEvidence = false): EvidenceRoute {
  const factor = extractFactor(query);
  if (/CAUSE|CAUSAL|DIAGNOS|RISK|PROTECT|INTERVENT|PRESCRIB|COUNTERFACTUAL|TREATMENT/i.test(query)) {
    return { intent: "CAUSAL_BOUNDARY", supported: true, factor, required_tools: hasCaseEvidence ? ["validate_case_evidence", "analyze_profile_stability", "summarize_uncertainty", ...(factor ? ["get_dml_evidence"] : [])] : factor ? ["get_dml_evidence", "summarize_uncertainty"] : ["check_evidence_scope"], reason: "The request requires an explicit noncausal/decision-support boundary." };
  }
  if (/FULL (CASE )?REPORT|EVIDENCE PACKET|PROFESSIONAL REPORT/i.test(query) && hasCaseEvidence) {
    return { intent: "FULL_CASE_REPORT", supported: true, factor, sensitivity: "BENCHMARK", required_tools: ["validate_case_evidence", "analyze_profile_stability", "analyze_boundary_sensitivity", "summarize_uncertainty", "get_analysis_provenance", "generate_evidence_report"], reason: "A complete case report requires case validation, profile, boundary, benchmark uncertainty, provenance, and structured report evidence." };
  }
  if (/EQUAL.SYSTEM|SENATE|BRR|FAY|WEIGHT|BENCHMARK|ROBUST|SENSITIV/i.test(query)) {
    const sensitivity: SensitivityKind = /BRR|FAY/i.test(query) ? "BRR_FAY" : /BENCHMARK/i.test(query) ? "BENCHMARK" : "EQUAL_SYSTEM";
    return { intent: "ROBUSTNESS_QUERY", supported: true, factor, sensitivity, required_tools: ["check_evidence_scope", ...(factor && sensitivity !== "BENCHMARK" ? ["get_dml_evidence", "get_sensitivity_evidence"] : []), "summarize_uncertainty", "get_analysis_provenance"], reason: "A robustness claim requires matching sensitivity and provenance evidence; unavailable scope must be explicit." };
  }
  if (/SOURCE|PROVENANCE|SAMPLE|METHOD|VERSION|HASH/i.test(query)) {
    return { intent: "PROVENANCE_QUERY", supported: true, factor, required_tools: ["get_analysis_provenance", "check_evidence_scope"], reason: "The request concerns the frozen evidence source, method, or version." };
  }
  if (factor || /DML|SINGLE|MUTUAL|CONFIDENCE INTERVAL|ADJUSTED ASSOCIATION/i.test(query)) {
    return { intent: "FACTOR_QUERY", supported: Boolean(factor), factor, required_tools: ["check_evidence_scope", ...(factor ? ["get_dml_evidence", "compare_dml_specifications", "summarize_uncertainty", "get_analysis_provenance"] : [])], reason: factor ? "A factor claim requires frozen DML, specification-comparison, uncertainty, and provenance evidence." : "No supported factor could be identified." };
  }
  if (hasCaseEvidence || /PROFILE|STABILITY|BOUNDARY|UNCERTAINTY|MRLE|PLAUSIBLE VALUE/i.test(query)) {
    return { intent: "PROFILE_QUERY", supported: hasCaseEvidence, factor, required_tools: hasCaseEvidence ? ["validate_case_evidence", "analyze_profile_stability", "analyze_boundary_sensitivity", "summarize_uncertainty"] : ["check_evidence_scope"], reason: hasCaseEvidence ? "A profile claim requires validated PV-specific case and boundary evidence." : "CaseEvidence is required for case-specific profile interpretation." };
  }
  return { intent: "OUT_OF_SCOPE", supported: false, required_tools: [], reason: "The request is outside the frozen MathEff evidence scope." };
}

export function argumentsForRequiredTool(tool: string, route: EvidenceRoute, caseEvidence?: unknown): Record<string, unknown> | null {
  const case_evidence = caseEvidence as CaseEvidence | undefined;
  if (["validate_case_evidence", "analyze_profile_stability", "generate_evidence_report"].includes(tool)) return case_evidence ? { case_evidence } : null;
  if (tool === "analyze_boundary_sensitivity") return case_evidence ? { case_evidence, buffers: [0.1, 0.2, 0.3] } : null;
  if (tool === "get_dml_evidence" || tool === "compare_dml_specifications") return route.factor ? { factor: route.factor } : null;
  if (tool === "get_sensitivity_evidence") return route.factor && route.sensitivity && route.sensitivity !== "BENCHMARK" ? { factor: route.factor, sensitivity: route.sensitivity } : null;
  if (tool === "get_analysis_provenance") return { include_hashes: true };
  if (tool === "check_evidence_scope") return { request_type: route.intent, factor: route.factor, sensitivity: route.sensitivity };
  if (tool === "summarize_uncertainty") return { case_evidence, factor: route.factor, sensitivity: route.sensitivity };
  return null;
}
