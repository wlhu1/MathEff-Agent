import { z } from "zod";
import { canonicalFactors, getFactorEvidence, finalDmlEvidence } from "../core/evidence/evidence-loader";
import { FACTOR_CODES } from "../examples/schema";
import type { ToolDefinition } from "./shared";

const input = z.object({ factor: z.enum(FACTOR_CODES) }).strict();
export const getDmlEvidenceTool: ToolDefinition<typeof input> = {
  name: "get_dml_evidence", description: "Retrieve frozen single-factor and mutually adjusted DML association-with-MRLE evidence for one canonical factor.", inputSchema: input,
  parameters: { type: "object", additionalProperties: false, required: ["factor"], properties: { factor: { type: "string", enum: canonicalFactors } } },
  execute: ({ factor }) => { const row = getFactorEvidence(factor); if (!row) return { found: false, allowed_factors: canonicalFactors }; return { found: true, ...row, outcome: finalDmlEvidence.outcome, analysis_sample: finalDmlEvidence.sample, estimand: finalDmlEvidence.estimand, allowed_interpretation: `Population-level adjusted association between ${row.label} and ${finalDmlEvidence.outcome}.`, caveat: finalDmlEvidence.caveat, mutual_ci_excludes_zero: row.mutual.ci_low > 0 || row.mutual.ci_high < 0 }; },
};
