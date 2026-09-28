import { z } from "zod";
import { caseEvidenceSchema } from "../examples/schema";
import type { ToolDefinition } from "./shared";

const input = z.object({ case_evidence: z.unknown() }).strict();
export const validateCaseEvidenceTool: ToolDefinition<typeof input> = {
  name: "validate_case_evidence", description: "Validate a case evidence packet against the canonical 10-PV schema.", inputSchema: input,
  parameters: { type: "object", additionalProperties: false, required: ["case_evidence"], properties: { case_evidence: { type: "object" } } },
  execute: ({ case_evidence }) => { const result = caseEvidenceSchema.safeParse(case_evidence); return result.success ? { valid: true, case_id: result.data.case_id, mode: result.data.mode, plausible_values: 10 } : { valid: false, errors: result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) }; },
};
