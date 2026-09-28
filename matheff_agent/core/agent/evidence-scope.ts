import { FACTOR_CODES } from "../../examples/schema";

export type ScopeStatus = "SUPPORTED" | "UNAVAILABLE" | "EXCEEDS_SCOPE";
export const TARGETED_SENSITIVITY_FACTORS = ["MATHEFF", "ANXMAT", "ICTWKDY"] as const;

export function checkEvidenceScope(input: { request_type: string; factor?: string; sensitivity?: string }) {
  if (input.factor && !FACTOR_CODES.includes(input.factor as typeof FACTOR_CODES[number])) {
    return { status: "UNAVAILABLE" as ScopeStatus, reason: `No frozen evidence is available for factor ${input.factor}.`, permitted_claim: null };
  }
  if ((input.sensitivity === "EQUAL_SYSTEM" || input.sensitivity === "BRR_FAY") && input.factor && !TARGETED_SENSITIVITY_FACTORS.includes(input.factor as typeof TARGETED_SENSITIVITY_FACTORS[number])) {
    return { status: "UNAVAILABLE" as ScopeStatus, reason: `${input.sensitivity} sensitivity evidence is available only for MATHEFF, ANXMAT, and ICTWKDY.`, permitted_claim: "The requested robustness check is unavailable for this factor." };
  }
  if (/CAUSAL|DIAGNOS|INTERVENT|RISK|PROTECT/i.test(input.request_type)) {
    return { status: "EXCEEDS_SCOPE" as ScopeStatus, reason: "The frozen observational evidence cannot support individual causation, diagnosis, risk/protective classification, or intervention prescription.", permitted_claim: "Population-level adjusted associations and descriptive case evidence may be organized separately." };
  }
  if (input.request_type === "PROFILE_QUERY" && !input.factor) {
    return { status: "SUPPORTED" as ScopeStatus, reason: "PV-specific profile and boundary evidence are supported when valid CaseEvidence is supplied.", permitted_claim: "Descriptive profile stability and uncertainty." };
  }
  return { status: "SUPPORTED" as ScopeStatus, reason: "The requested evidence exists within the frozen application scope.", permitted_claim: "Evidence-bounded descriptive or adjusted-association interpretation." };
}
