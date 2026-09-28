import { z } from "zod";

export const provenanceSchema = z.object({
  source_file: z.string().min(1),
  sha256: z.string().regex(/^[A-F0-9]{64}$/),
});

export const dmlEstimateSchema = z.object({
  estimate: z.number(),
  ci_low: z.number(),
  ci_high: z.number(),
  pv_sign_consistency: z.string(),
});

export const factorEvidenceSchema = z.object({
  factor: z.enum(["MATHEFF", "ANXMAT", "GROSAGR", "DISCLIM", "RELATST", "COGACMCO", "ICTWKDY", "ICTEFFIC"]),
  domain: z.enum(["Psychological", "Classroom", "Digital-learning"]),
  label: z.string(),
  single: dmlEstimateSchema,
  mutual: dmlEstimateSchema,
});

export const evidenceBundleSchema = z.object({
  evidence_version: z.string(),
  generated_at: z.string(),
  provenance: z.array(provenanceSchema).min(1),
});

export type FactorEvidence = z.infer<typeof factorEvidenceSchema>;
