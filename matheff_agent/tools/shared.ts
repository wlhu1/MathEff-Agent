import { z } from "zod";
import type { CaseEvidence } from "../examples/schema";

export type Profile = "HIGH_SCORE_HIGH_MRLE" | "HIGH_SCORE_LOW_MRLE" | "LOW_SCORE_HIGH_MRLE" | "LOW_SCORE_LOW_MRLE" | "BOUNDARY";

export function classifyProfile(achievement: number, mrle: number): Profile {
  if (achievement === 0 || mrle === 0) return "BOUNDARY";
  if (achievement > 0 && mrle > 0) return "HIGH_SCORE_HIGH_MRLE";
  if (achievement > 0 && mrle < 0) return "HIGH_SCORE_LOW_MRLE";
  if (achievement < 0 && mrle > 0) return "LOW_SCORE_HIGH_MRLE";
  return "LOW_SCORE_LOW_MRLE";
}

export function profileCounts(caseEvidence: CaseEvidence) {
  const profiles = caseEvidence.achievement_z_by_pv.map((a, index) => classifyProfile(a, caseEvidence.mrle_by_pv[index]));
  const counts = profiles.reduce<Record<string, number>>((acc, value) => ({ ...acc, [value]: (acc[value] ?? 0) + 1 }), {});
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return { profiles, counts, modal_profile: sorted[0]?.[0] ?? "BOUNDARY", modal_count: sorted[0]?.[1] ?? 0, unique_modal: sorted.length < 2 || sorted[0][1] > sorted[1][1] };
}

export function mean(values: number[]) { return values.reduce((sum, value) => sum + value, 0) / values.length; }
export function sd(values: number[]) { const m = mean(values); return Math.sqrt(values.reduce((sum, value) => sum + (value - m) ** 2, 0) / (values.length - 1)); }

export type ToolDefinition<T extends z.ZodType = z.ZodType> = {
  name: string;
  description: string;
  inputSchema: T;
  parameters: Record<string, unknown>;
  execute: (input: z.infer<T>) => unknown | Promise<unknown>;
};
