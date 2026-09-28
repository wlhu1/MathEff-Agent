import { z } from "zod";
import { caseEvidenceSchema } from "../examples/schema";
import { profileCounts, mean, sd, type ToolDefinition } from "./shared";

const input = z.object({ case_evidence: caseEvidenceSchema }).strict();
export const analyzeProfileStabilityTool: ToolDefinition<typeof input> = {
  name: "analyze_profile_stability", description: "Assign all 10 plausible-value descriptive profile patterns and summarize stability without collapsing them into one true score.", inputSchema: input,
  parameters: { type: "object", additionalProperties: false, required: ["case_evidence"], properties: { case_evidence: { type: "object" } } },
  execute: ({ case_evidence }) => { const result = profileCounts(case_evidence); return { case_id: case_evidence.case_id, profiles_by_pv: result.profiles, counts: result.counts, modal_profile: result.modal_profile, modal_count: result.modal_count, unique_modal: result.unique_modal, ten_of_ten_agreement: result.modal_count === 10, nine_of_ten_or_more: result.modal_count >= 9, mrle_descriptive_mean: mean(case_evidence.mrle_by_pv), mrle_descriptive_sd: sd(case_evidence.mrle_by_pv), mrle_definition: "Context-adjusted relative mathematics learning efficiency; relative mathematics performance compared with the specified contextual expectation.", interpretation: "Descriptive profile assignment across plausible-value-specific achievement and MRLE results; not a fixed student type, true individual MRLE, or precise individual efficiency score." }; },
};
