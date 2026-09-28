import { z } from "zod";
import { caseEvidenceSchema } from "../examples/schema";
import { classifyProfile, type ToolDefinition } from "./shared";

const input = z.object({ case_evidence: caseEvidenceSchema, buffers: z.array(z.number().positive()).default([0.1, 0.2, 0.3]) }).strict();
export const analyzeBoundarySensitivityTool: ToolDefinition<typeof input> = {
  name: "analyze_boundary_sensitivity", description: "Apply strict 10-PV boundary buffers to achievement and MRLE values.", inputSchema: input,
  parameters: { type: "object", additionalProperties: false, required: ["case_evidence"], properties: { case_evidence: { type: "object" }, buffers: { type: "array", items: { type: "number" }, default: [0.1, 0.2, 0.3] } } },
  execute: ({ case_evidence, buffers }) => ({ case_id: case_evidence.case_id, rule: "Retained only when abs(achievement_z) > delta and abs(MRLE) > delta for all 10 plausible values.", results: buffers.map((delta) => { const retained = case_evidence.achievement_z_by_pv.every((a, i) => Math.abs(a) > delta && Math.abs(case_evidence.mrle_by_pv[i]) > delta); const profiles = case_evidence.achievement_z_by_pv.map((a, i) => classifyProfile(a, case_evidence.mrle_by_pv[i])); return { delta, retained, profile_consistent_if_retained: retained ? new Set(profiles).size === 1 : null, interpretation: retained ? "Away from the specified zero-boundary buffer in every PV." : "At least one PV falls on or within the specified buffer; classification is boundary-sensitive at this threshold." }; }) }),
};
