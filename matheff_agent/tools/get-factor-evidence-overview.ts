import { z } from "zod";
import { finalDmlEvidence } from "../core/evidence/evidence-loader";
import type { ToolDefinition } from "./shared";
const input = z.object({ domain: z.enum(["ALL", "Psychological", "Classroom", "Digital-learning"]).default("ALL") }).strict();
export const getFactorEvidenceOverviewTool: ToolDefinition<typeof input> = { name: "get_factor_evidence_overview", description: "Return frozen eight-factor association-with-MRLE evidence, optionally filtered by domain.", inputSchema: input, parameters: { type: "object", additionalProperties: false, properties: { domain: { type: "string", enum: ["ALL", "Psychological", "Classroom", "Digital-learning"], default: "ALL" } } }, execute: ({ domain }) => ({ outcome: finalDmlEvidence.outcome, estimand: finalDmlEvidence.estimand, factors: finalDmlEvidence.factors.filter((row) => domain === "ALL" || row.domain === domain), caveat: finalDmlEvidence.caveat }) };
