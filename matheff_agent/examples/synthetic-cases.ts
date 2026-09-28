import type { CaseEvidence } from "./schema";

const factors = {
  MATHEFF: 0.45, ANXMAT: -0.2, GROSAGR: 0.25, DISCLIM: 0.1,
  RELATST: 0.15, COGACMCO: 0.05, ICTWKDY: -0.3, ICTEFFIC: 0.2,
};

export const SYNTHETIC_CASES: CaseEvidence[] = [
  {
    case_id: "SYNTHETIC_A_STABLE_CONCORDANT", mode: "SYNTHETIC_DEMO", system_code: "DEMO",
    achievement_z_by_pv: [0.62, 0.58, 0.71, 0.66, 0.55, 0.69, 0.61, 0.64, 0.59, 0.67],
    mrle_by_pv: [0.42, 0.36, 0.51, 0.45, 0.32, 0.48, 0.39, 0.43, 0.35, 0.46],
    factor_values: factors, evidence_version: "SYNTHETIC_DEMO_V1",
    metadata: { synthetic: true, real_student: false, validation_evidence: false, description: "Stable high-score/high-MRLE illustration" },
  },
  {
    case_id: "SYNTHETIC_B_STABLE_DISCORDANT", mode: "SYNTHETIC_DEMO", system_code: "DEMO",
    achievement_z_by_pv: [0.48, 0.52, 0.44, 0.57, 0.41, 0.55, 0.46, 0.5, 0.43, 0.54],
    mrle_by_pv: [-0.46, -0.39, -0.51, -0.42, -0.35, -0.48, -0.4, -0.44, -0.37, -0.49],
    factor_values: { ...factors, ANXMAT: 0.7, MATHEFF: -0.25 }, evidence_version: "SYNTHETIC_DEMO_V1",
    metadata: { synthetic: true, real_student: false, validation_evidence: false, description: "Stable high-score/low-MRLE illustration" },
  },
  {
    case_id: "SYNTHETIC_C_BOUNDARY_UNSTABLE", mode: "SYNTHETIC_DEMO", system_code: "DEMO",
    achievement_z_by_pv: [0.05, -0.03, 0, 0.12, -0.15, 0.08, -0.09, 0.02, 0.11, -0.04],
    mrle_by_pv: [0.04, 0.02, -0.01, 0, 0.12, -0.08, 0.03, -0.02, -0.11, 0.01],
    factor_values: { ...factors, DISCLIM: -0.05, RELATST: 0.04 }, evidence_version: "SYNTHETIC_DEMO_V1",
    metadata: { synthetic: true, real_student: false, validation_evidence: false, description: "Boundary-sensitive illustration" },
  },
];

export const SYNTHETIC_NOTICE = "Synthetic demonstration only. These are not real students and do not constitute validation evidence.";
