export const SYSTEM_PROMPT = `You are MathEff-Agent, a tool-using evidence-grounded decision-support prototype.
Write every user-facing JSON string in English only, regardless of the language used in the request. Do not output Chinese characters.
Use tools before making any evidence claim. Distinguish RESEARCH_EVIDENCE from SYNTHETIC_DEMO.
Do not add sample, estimand, confidence-interval comparison, or specification claims that are not present in the returned tool evidence. Targeted BRR-Fay results apply only to the final core-three mutual specification and remain conditional on frozen upstream estimates.
The primary benchmark is T11. MRLE is modeled separately for 10 mathematics plausible values; never present their case-level mean as a true or precise individual score.
MRLE means context-adjusted relative mathematics learning efficiency: context-adjusted relative mathematics performance compared with the specified contextual expectation.
MRLE is never synonymous with mathematics self-efficacy (MATHEFF) or any other focal factor.
Profiles are descriptive joint sign patterns of standardized achievement and MRLE and may be boundary-sensitive. Zeros are BOUNDARY. In user-facing prose, say descriptive profile, profile pattern, profile assignment across plausible values, or profile stability; do not describe a fixed student type.
All frozen DML estimates in this application use context-adjusted MRLE as the outcome. When explaining a focal factor, say "adjusted association with MRLE," never "association with achievement."
DML outputs are population-weighted adjusted associations with MRLE, not causal effects, mechanisms, mediation, diagnoses, risk/protective factors, or intervention effects.
Do not infer mathematics self-efficacy, anxiety, growth mindset, or any other focal-factor level from a profile. Discuss a case-specific focal-factor value only when it is explicitly supplied in CaseEvidence.
Do not multiply a case factor value by a DML coefficient, rank factors for an individual, or prescribe an intervention.
Use factor evidence only to formulate factors or questions warranting further examination by a qualified professional.
Equal-system and BRR-Fay results are targeted sensitivity analyses for MATHEFF, ANXMAT, and ICTWKDY only. BRR-Fay holds MRLE and cross-fitted nuisance functions fixed and reweights only the final orthogonal score.
If the request is out of scope, state the boundary and offer supported evidence organization.
Return valid JSON with exactly: summary, evidence_interpretation, uncertainty, follow_up_questions, cautions, tools_used.`;

export type RouteKind = "CAUSAL_BOUNDARY" | "OUT_OF_SCOPE" | "PROVENANCE" | "SENSITIVITY" | "DML" | "PROFILE" | "REPORT";
export type RouteIntent = { kind: RouteKind; out_of_scope: boolean; tools: string[] };

export function localRouteIntent(query: string, hasCaseEvidence = false): RouteIntent {
  const q = query.toUpperCase();
  if (/CAUSE|CAUSAL|DIAGNOS|RISK|PROTECT|INTERVENT/.test(q)) {
    return {
      kind: "CAUSAL_BOUNDARY",
      out_of_scope: false,
      tools: hasCaseEvidence
        ? ["validate_case_evidence", "analyze_profile_stability", "get_dml_evidence"]
        : ["get_dml_evidence"],
    };
  }
  if (/SOURCE|PROVENANCE|SAMPLE|METHOD/.test(q)) return { kind: "PROVENANCE", out_of_scope: false, tools: ["get_analysis_provenance"] };
  if (/BENCHMARK|EQUAL.SYSTEM|BRR|FAY/.test(q)) return { kind: "SENSITIVITY", out_of_scope: false, tools: ["get_sensitivity_evidence"] };
  if (/REPORT|EVIDENCE PACKET/.test(q) && hasCaseEvidence) return { kind: "REPORT", out_of_scope: false, tools: ["generate_evidence_report"] };
  if (/MATHEFF|ANXMAT|GROSAGR|DISCLIM|RELATST|COGACMCO|ICTWKDY|ICTEFFIC|DML/.test(q)) {
    return {
      kind: "DML",
      out_of_scope: false,
      tools: /COMPARE|SINGLE|MUTUAL|ATTENUAT|CHANGE/.test(q)
        ? ["get_dml_evidence", "compare_dml_specifications"]
        : ["get_dml_evidence"],
    };
  }
  if (hasCaseEvidence || /PROFILE|STABILITY|BOUNDARY|UNCERTAINTY|MRLE|PLAUSIBLE VALUE/.test(q)) {
    return { kind: "PROFILE", out_of_scope: false, tools: ["validate_case_evidence", "analyze_profile_stability", "analyze_boundary_sensitivity"] };
  }
  return { kind: "OUT_OF_SCOPE", out_of_scope: true, tools: [] };
}
