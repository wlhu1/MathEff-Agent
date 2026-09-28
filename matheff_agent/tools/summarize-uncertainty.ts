import { z } from "zod";
import { caseEvidenceSchema, FACTOR_CODES } from "../examples/schema";
import { summarizeUncertainty } from "../core/agent/uncertainty-summary";
import type { ToolDefinition } from "./shared";

const input = z.object({
  case_evidence: caseEvidenceSchema.optional(),
  factor: z.enum(FACTOR_CODES).optional(),
  sensitivity: z.enum(["EQUAL_SYSTEM", "BRR_FAY", "BENCHMARK"]).optional(),
}).strict();

export const summarizeUncertaintyTool: ToolDefinition<typeof input> = {
  name: "summarize_uncertainty",
  description: "Unify available PV variability, profile stability, DML confidence intervals, and requested robustness evidence while explicitly labeling unavailable dimensions.",
  inputSchema: input,
  parameters: { type: "object", additionalProperties: false, properties: { case_evidence: { type: "object" }, factor: { type: "string", enum: FACTOR_CODES }, sensitivity: { type: "string", enum: ["EQUAL_SYSTEM", "BRR_FAY", "BENCHMARK"] } } },
  execute: summarizeUncertainty,
};
