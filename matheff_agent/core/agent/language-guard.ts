import type { AgentResponse } from "./report-schema";

export type GuardContext = {
  route_kind?: string;
  tools_used?: string[];
  focal_factors_supplied?: string[];
  dml_outcome?: string;
};

const unsafe = [/\bcaused\b/i, /causal effect/i, /mechanism effect/i, /intervention effect/i, /counterfactual (?:effect|prediction|simulation)/i, /validated diagnostic/i, /deterministic diagnosis/i, /precise (individual|personalized) diagnosis/i, /risk factor/i, /protective factor/i, /proven intervention/i, /automatic treatment/i, /treatment recommendation/i, /must intervene/i, /will improve/i, /will increase MRLE/i, /fixed student type/i];
const negatingBoundary = /cannot|does not|not establish|unable|do not|\bnot\b|neither|no evidence|\bno\b/i;
const mrleSelfEfficacyConfusion = [/self[- ]efficacy\s*\(\s*MRLE\s*\)/i, /MRLE\s*(?:means|is|=|refers to)\s*(?:mathematics\s*)?self[- ]efficacy/i];
const wrongDmlOutcome = [/association\s+(?:between\s+[^.]*?\s+and|with)\s+(?:mathematics\s+)?achievement/i, /achievement\s+association/i, /predicts?\s+(?:mathematics\s+)?achievement/i, /effect\s+on\s+(?:mathematics\s+)?achievement/i];
const wrongGeneralDmlSample = /strict complete-case/i;
const factorTerms: Record<string, RegExp> = {
  MATHEFF: /mathematics self[- ]efficacy/i,
  ANXMAT: /mathematics anxiety/i,
  GROSAGR: /growth mindset/i,
  DISCLIM: /disciplinary climate/i,
  RELATST: /student.?teacher relationship/i,
  COGACMCO: /cognitive activation/i,
  ICTWKDY: /weekday ICT activity/i,
  ICTEFFIC: /self[- ]efficacy in digital competencies/i,
};

function responseStatements(response: AgentResponse) {
  return [response.summary, ...response.evidence_interpretation, ...response.uncertainty, ...response.follow_up_questions, ...response.cautions]
    .flatMap((value) => value.split(/(?<=[.!?])\s+/));
}

function isPositiveUnsupported(statement: string, pattern: RegExp) {
  return pattern.test(statement) && !negatingBoundary.test(statement);
}

export function guardResponse(response: AgentResponse, context: GuardContext = {}): { response: AgentResponse; guard_applied: boolean; matched: string[] } {
  const statements = responseStatements(response);
  const matched = unsafe
    .filter((pattern) => statements.some((statement) => isPositiveUnsupported(statement, pattern)))
    .map((pattern) => `UNSUPPORTED_CLAIM:${pattern.source}`);

  if (statements.some((statement) => mrleSelfEfficacyConfusion.some((pattern) => isPositiveUnsupported(statement, pattern)))) {
    matched.push("SEMANTIC_MRLE_SELF_EFFICACY_CONFUSION");
  }

  const usesFrozenDml = context.tools_used?.some((tool) => tool === "get_dml_evidence" || tool === "compare_dml_specifications" || tool === "get_factor_evidence_overview");
  if (usesFrozenDml && context.dml_outcome === "context-adjusted MRLE" && statements.some((statement) => wrongDmlOutcome.some((pattern) => isPositiveUnsupported(statement, pattern)))) {
    matched.push("SEMANTIC_DML_OUTCOME_NOT_MRLE");
  }
  if (usesFrozenDml && statements.some((statement) => wrongGeneralDmlSample.test(statement) && !/only|not|does not|BRR(?:-Fay)?|targeted/i.test(statement))) {
    matched.push("SEMANTIC_GENERAL_DML_SAMPLE_MISLABELED_AS_STRICT_COMPLETE_CASE");
  }

  if (context.route_kind === "PROFILE" && statements.some((statement) => /\bclassification\b|\bclassified as\b/i.test(statement) && !negatingBoundary.test(statement))) {
    matched.push("SEMANTIC_PROFILE_CLASSIFICATION_WORDING");
  }

  if (context.route_kind === "PROFILE") {
    const supplied = new Set(context.focal_factors_supplied ?? []);
    for (const [factor, term] of Object.entries(factorTerms)) {
      if (supplied.has(factor)) continue;
      if (statements.some((statement) => term.test(statement) && /high|low|above|below|elevated|reduced|level|value/i.test(statement) && !negatingBoundary.test(statement))) {
        matched.push(`SEMANTIC_UNSUPPLIED_FACTOR_INFERENCE:${factor}`);
      }
    }
  }

  const uniqueMatched = [...new Set(matched)];
  if (!uniqueMatched.length) return { response, guard_applied: false, matched: [] };
  return {
    guard_applied: true,
    matched: uniqueMatched,
    response: {
      summary: "The requested interpretation exceeded the supported evidence boundary. The system can organize descriptive profile stability and frozen adjusted-association-with-MRLE evidence for professional review.",
      evidence_interpretation: [],
      uncertainty: ["The available results are observational and plausible-value-specific."],
      follow_up_questions: ["Would you like a noncausal summary of the relevant frozen evidence?"],
      cautions: ["No validated individual diagnosis, causal effect, risk/protective classification, or intervention prescription is supported."],
      tools_used: response.tools_used,
    },
  };
}
