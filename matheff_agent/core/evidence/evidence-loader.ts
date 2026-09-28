import metadata from "./analysis-metadata.json";
import dml from "./final-dml-evidence.json";
import benchmark from "./benchmark-sensitivity.json";
import weighting from "./targeted-weighting-sensitivity.json";
import labels from "./canonical-factor-labels.json";
import { factorEvidenceSchema } from "./evidence-schema";

export const analysisMetadata = metadata;
export const finalDmlEvidence = {
  ...dml,
  factors: dml.factors.map((row) => factorEvidenceSchema.parse(row)),
};
export const benchmarkSensitivity = benchmark;
export const targetedWeightingSensitivity = weighting;
export const canonicalFactorLabels = labels;

export const canonicalFactors = finalDmlEvidence.factors.map((row) => row.factor);

export function getFactorEvidence(factor: string) {
  return finalDmlEvidence.factors.find((row) => row.factor === factor);
}
