import { z } from "zod";

export const FACTOR_CODES = ["MATHEFF", "ANXMAT", "GROSAGR", "DISCLIM", "RELATST", "COGACMCO", "ICTWKDY", "ICTEFFIC"] as const;
const tenFiniteNumbers = z.array(z.number().finite()).length(10);
const piiKeyPattern = /(^|_)(name|email|e_mail|phone|mobile|address|birth|dob|student_?id|national_?id|passport|wechat|qq)($|_)/i;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phonePattern = /^(?:\+?\d[\d\s().-]{6,}\d)$/;

export function detectLikelyPii(value: unknown, path = "case_evidence"): string[] {
  const issues: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => issues.push(...detectLikelyPii(item, `${path}.${index}`)));
    return issues;
  }
  if (!value || typeof value !== "object") return issues;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const itemPath = `${path}.${key}`;
    if (piiKeyPattern.test(key)) issues.push(`${itemPath}: identity-bearing field names are not permitted`);
    if (typeof item === "string" && (emailPattern.test(item.trim()) || phonePattern.test(item.trim()))) issues.push(`${itemPath}: email/phone-like values are not permitted`);
    if (item && typeof item === "object") issues.push(...detectLikelyPii(item, itemPath));
  }
  return [...new Set(issues)];
}

const pseudonymousCaseId = z.string().min(1).max(96).refine(
  (value) => !emailPattern.test(value.trim()) && !phonePattern.test(value.trim()) && !/^\d{7,}$/.test(value.trim()),
  "case_id must be pseudonymous and must not contain an email, phone number, or direct numeric student identifier",
);

export const caseEvidenceSchema = z.object({
  case_id: pseudonymousCaseId,
  mode: z.enum(["RESEARCH_EVIDENCE", "SYNTHETIC_DEMO"]),
  system_code: z.string().min(1).optional(),
  achievement_z_by_pv: tenFiniteNumbers,
  mrle_by_pv: tenFiniteNumbers,
  factor_values: z.object({
    MATHEFF: z.number().finite().optional(),
    ANXMAT: z.number().finite().optional(),
    GROSAGR: z.number().finite().optional(),
    DISCLIM: z.number().finite().optional(),
    RELATST: z.number().finite().optional(),
    COGACMCO: z.number().finite().optional(),
    ICTWKDY: z.number().finite().optional(),
    ICTEFFIC: z.number().finite().optional(),
  }).strict().optional(),
  evidence_version: z.string().min(1),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
}).strict().superRefine((value, ctx) => {
  for (const issue of detectLikelyPii(value.metadata, "metadata")) ctx.addIssue({ code: "custom", path: ["metadata"], message: issue });
});

export type CaseEvidence = z.infer<typeof caseEvidenceSchema>;
