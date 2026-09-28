import { z } from "zod";
import { caseEvidenceSchema, FACTOR_CODES } from "../examples/schema";
import { profileCounts, mean, sd, type ToolDefinition } from "./shared";
import { finalDmlEvidence, getFactorEvidence } from "../core/evidence/evidence-loader";

const input = z.object({ case_evidence: caseEvidenceSchema }).strict();

export const generateEvidenceReportTool: ToolDefinition<typeof input> = {
  name: "generate_evidence_report",
  description: "Generate a structured evidence packet for professional review; prose remains the LLM's responsibility.",
  inputSchema: input,
  parameters: { type: "object", additionalProperties: false, required: ["case_evidence"], properties: { case_evidence: { type: "object" } } },
  execute: ({ case_evidence }) => {
    const profiles = profileCounts(case_evidence);
    const factorRows = FACTOR_CODES
      .filter((factor) => case_evidence.factor_values?.[factor] !== undefined)
      .map((factor) => ({
        factor,
        observed_standardized_value: case_evidence.factor_values?.[factor],
        dml_outcome: finalDmlEvidence.outcome,
        frozen_association_evidence: getFactorEvidence(factor),
        framing: "Factor warranting further examination; the population-level association with MRLE is distinct from the case value, and the two must not be multiplied.",
      }));
    return {
      report_type: "CASE_SPECIFIC_EVIDENCE_PACKET",
      case_id: case_evidence.case_id,
      mode: case_evidence.mode,
      sections: {
        scope_and_provenance: { evidence_version: case_evidence.evidence_version, system_code: case_evidence.system_code ?? null },
        achievement_across_pvs: case_evidence.achievement_z_by_pv,
        mrle_across_pvs: case_evidence.mrle_by_pv,
        mrle_definition: "Context-adjusted relative mathematics learning efficiency; relative mathematics performance compared with the specified contextual expectation.",
        profile_stability: profiles,
        descriptive_mrle_summary: { mean: mean(case_evidence.mrle_by_pv), sd: sd(case_evidence.mrle_by_pv), label: "descriptive summary across plausible-value-specific MRLE estimates" },
        factors_warranting_examination: factorRows,
        uncertainty: ["Plausible-value-specific results must remain visible.", "Near-zero values may make profile assignments boundary-sensitive."],
        professional_review_questions: ["Which contextual evidence could clarify the observed pattern?", "Does the pattern persist across occasions or data sources?"],
        cautions: ["No causal, diagnostic, risk, protective, or intervention interpretation.", "No factor prioritization from coefficient times case value."],
        required_note: "This report organizes statistical evidence for professional review. It does not constitute a validated individual diagnosis or causal prescription.",
      },
    };
  },
};
