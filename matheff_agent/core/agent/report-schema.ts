import { z } from "zod";

export const agentResponseSchema = z.object({
  summary: z.string().min(1),
  evidence_interpretation: z.array(z.string()),
  uncertainty: z.array(z.string()),
  follow_up_questions: z.array(z.string()),
  cautions: z.array(z.string()),
  tools_used: z.array(z.string()),
}).strict();
export type AgentResponse = z.infer<typeof agentResponseSchema>;

export function safeStructuredFallback(toolsUsed: string[], detail?: string): AgentResponse {
  return { summary: "The available evidence has been organized for professional review, but a fully structured model response was not available.", evidence_interpretation: [], uncertainty: [detail ?? "Interpretation should retain all plausible-value-specific results and their boundary sensitivity."], follow_up_questions: ["What additional contextual evidence should be reviewed alongside these statistical patterns?"], cautions: ["This is not a validated individual diagnosis or causal prescription."], tools_used: toolsUsed };
}
