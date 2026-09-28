import type { CaseEvidence } from "../../examples/schema";
import { benchmarkSensitivity, getFactorEvidence, targetedWeightingSensitivity } from "../evidence/evidence-loader";
import { profileCounts, sd } from "../../tools/shared";
import { TARGETED_SENSITIVITY_FACTORS } from "./evidence-scope";

export type UncertaintyLabel = "STABLE" | "BOUNDARY_SENSITIVE" | "PV_UNSTABLE" | "ROBUSTNESS_UNAVAILABLE" | "NOT_APPLICABLE";

export function summarizeUncertainty(input: { case_evidence?: CaseEvidence; factor?: string; sensitivity?: "EQUAL_SYSTEM" | "BRR_FAY" | "BENCHMARK" }) {
  const profile = input.case_evidence ? profileCounts(input.case_evidence) : null;
  const factorEvidence = input.factor ? getFactorEvidence(input.factor) : undefined;
  const casePv = input.case_evidence ? {
    available: true,
    mrle_descriptive_sd: sd(input.case_evidence.mrle_by_pv),
    mrle_min: Math.min(...input.case_evidence.mrle_by_pv),
    mrle_max: Math.max(...input.case_evidence.mrle_by_pv),
    sign_consistency: `${Math.max(input.case_evidence.mrle_by_pv.filter((value) => value > 0).length, input.case_evidence.mrle_by_pv.filter((value) => value < 0).length)}/10`,
  } : { available: false, reason: "No CaseEvidence was supplied." };
  const profileDimension = profile ? {
    available: true,
    modal_profile: profile.modal_profile,
    modal_count: profile.modal_count,
    label: (profile.modal_count === 10 ? "STABLE" : profile.modal_count >= 8 ? "BOUNDARY_SENSITIVE" : "PV_UNSTABLE") as UncertaintyLabel,
  } : { available: false, label: "NOT_APPLICABLE" as UncertaintyLabel, reason: "No CaseEvidence was supplied." };
  const ciDimension = factorEvidence ? {
    available: true,
    factor: factorEvidence.factor,
    single: factorEvidence.single,
    mutual: factorEvidence.mutual,
    mutual_ci_excludes_zero: factorEvidence.mutual.ci_low > 0 || factorEvidence.mutual.ci_high < 0,
  } : { available: false, reason: input.factor ? `No frozen DML evidence for ${input.factor}.` : "No factor was requested." };
  const targetedAvailable = input.factor ? TARGETED_SENSITIVITY_FACTORS.includes(input.factor as typeof TARGETED_SENSITIVITY_FACTORS[number]) : false;
  const robustness = !input.sensitivity ? { available: false, label: "NOT_APPLICABLE" as UncertaintyLabel, reason: "No robustness dimension was requested." }
    : input.sensitivity === "BENCHMARK" ? { available: true, label: "STABLE" as UncertaintyLabel, evidence_version: benchmarkSensitivity.evidence_version, results: benchmarkSensitivity.rows }
    : targetedAvailable ? { available: true, label: "STABLE" as UncertaintyLabel, evidence_version: targetedWeightingSensitivity.evidence_version, result: input.sensitivity === "EQUAL_SYSTEM" ? targetedWeightingSensitivity.equal_system.find((row) => row.factor === input.factor) : targetedWeightingSensitivity.brr_fay.find((row) => row.factor === input.factor), caveat: input.sensitivity === "EQUAL_SYSTEM" ? targetedWeightingSensitivity.caveats.equal_system : targetedWeightingSensitivity.caveats.brr_fay }
    : { available: false, label: "ROBUSTNESS_UNAVAILABLE" as UncertaintyLabel, reason: `${input.sensitivity} evidence is unavailable for ${input.factor ?? "an unspecified factor"}; targeted checks cover MATHEFF, ANXMAT, and ICTWKDY only.` };
  return {
    status: "EVIDENCE_BOUNDED_UNCERTAINTY_SUMMARY",
    pv_variability: casePv,
    profile_stability: profileDimension,
    confidence_interval_evidence: ciDimension,
    robustness,
    interpretation_boundary: "Uncertainty dimensions are not interchangeable; unavailable robustness evidence must not be inferred from another factor or analysis.",
  };
}
