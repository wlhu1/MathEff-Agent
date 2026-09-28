import { z } from "zod";
import { canonicalFactors, getFactorEvidence, finalDmlEvidence } from "../core/evidence/evidence-loader";
import type { ToolDefinition } from "./shared";

const input = z.object({ factor: z.string() }).strict();
export const compareDmlSpecificationsTool: ToolDefinition<typeof input> = {
  name: "compare_dml_specifications", description: "Compare frozen single-factor and mutually adjusted associations with MRLE using noncausal language.", inputSchema: input,
  parameters: { type: "object", additionalProperties: false, required: ["factor"], properties: { factor: { type: "string", enum: canonicalFactors } } },
  execute: ({ factor }) => { const row = getFactorEvidence(factor); if (!row) return { found: false, allowed_factors: canonicalFactors }; const absolute_change = Math.abs(row.mutual.estimate) - Math.abs(row.single.estimate); return { found: true, factor, outcome: finalDmlEvidence.outcome, single: row.single, mutual: row.mutual, absolute_magnitude_change: absolute_change, absolute_magnitude_percent_change: Math.abs(row.single.estimate) === 0 ? null : 100 * absolute_change / Math.abs(row.single.estimate), direction_changed: Math.sign(row.single.estimate) !== Math.sign(row.mutual.estimate), interpretation_boundary: "This is a specification comparison of adjusted associations with MRLE, not evidence of mediation, mechanism, or causality." }; },
};
