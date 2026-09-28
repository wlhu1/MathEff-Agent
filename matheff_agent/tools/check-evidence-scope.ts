import { z } from "zod";
import { FACTOR_CODES } from "../examples/schema";
import { checkEvidenceScope } from "../core/agent/evidence-scope";
import type { ToolDefinition } from "./shared";

const input = z.object({
  request_type: z.string().min(1),
  factor: z.enum(FACTOR_CODES).optional(),
  sensitivity: z.enum(["EQUAL_SYSTEM", "BRR_FAY", "BENCHMARK"]).optional(),
}).strict();

export const checkEvidenceScopeTool: ToolDefinition<typeof input> = {
  name: "check_evidence_scope",
  description: "Determine whether a requested interpretation or sensitivity claim is supported, unavailable, or exceeds the frozen evidence scope.",
  inputSchema: input,
  parameters: { type: "object", additionalProperties: false, required: ["request_type"], properties: { request_type: { type: "string" }, factor: { type: "string", enum: FACTOR_CODES }, sensitivity: { type: "string", enum: ["EQUAL_SYSTEM", "BRR_FAY", "BENCHMARK"] } } },
  execute: checkEvidenceScope,
};
