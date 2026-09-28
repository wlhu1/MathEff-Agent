"""Final T11 profile and threshold-sensitivity analysis.

This public-release extraction implements the declared zero reference,
the +/-0.10, +/-0.20, and +/-0.30 boundary buffers, and ten-PV profile
stability. It writes aggregate outputs only; student-level files remain local.
"""

from __future__ import annotations

import os
from pathlib import Path

import numpy as np
import pandas as pd


ROOT = Path(os.environ.get("MATHEFF_REPRO_ROOT", Path.cwd()))
CHECKPOINTS = Path(
    os.environ.get("MATHEFF_MRLE_CHECKPOINTS", ROOT / "outputs/t11_mrle")
)
OUT = Path(os.environ.get("MATHEFF_PROFILE_OUTPUT", ROOT / "outputs/profile_sensitivity"))
OUT.mkdir(parents=True, exist_ok=True)

N_EXPECTED, SYSTEMS_EXPECTED, SCHOOLS_EXPECTED = 123_949, 24, 6_108
PVS = tuple(range(1, 11))
DELTAS = (0.10, 0.20, 0.30)
PROFILE_LABELS = np.array(
    [
        "High Score - High MRLE",
        "High Score - Low MRLE",
        "Low Score - High MRLE",
        "Low Score - Low MRLE",
    ],
    dtype=object,
)


def weighted_proportion(mask: np.ndarray, weights: np.ndarray) -> float:
    return float(np.sum(weights * mask) / np.sum(weights))


achievement = np.empty((N_EXPECTED, 10), dtype=float)
mrle = np.empty((N_EXPECTED, 10), dtype=float)
profiles = np.empty((N_EXPECTED, 10), dtype=np.int8)
reference_ids = reference_systems = reference_schools = reference_weights = None
distribution_rows: list[dict[str, object]] = []

for column, pv in enumerate(PVS):
    student_path = CHECKPOINTS / f"pv{pv:02d}_student.parquet"
    diagnostic_path = CHECKPOINTS / f"pv{pv:02d}_diagnostics.csv"
    diagnostics = pd.read_csv(diagnostic_path)
    data = pd.read_parquet(
        student_path,
        columns=[
            "GLOBAL_STUDENT_ID",
            "CNT",
            "GLOBAL_SCHOOL_ID",
            "W_FSTUWT",
            "mrle_raw",
            "score_within_country_weighted_z",
        ],
    )
    ids = data["GLOBAL_STUDENT_ID"].astype(str).to_numpy()
    systems = data["CNT"].astype(str).to_numpy()
    schools = data["GLOBAL_SCHOOL_ID"].astype(str).to_numpy()
    weights = data["W_FSTUWT"].to_numpy(float)

    if pv == 1:
        reference_ids = ids.copy()
        reference_systems = systems.copy()
        reference_schools = schools.copy()
        reference_weights = weights.copy()
    elif not np.array_equal(ids, reference_ids):
        positions = pd.Series(np.arange(len(data)), index=ids)
        if len(positions) != N_EXPECTED or set(ids) != set(reference_ids):
            raise RuntimeError(f"PV{pv}: student identifiers cannot be aligned")
        data = data.iloc[positions.loc[reference_ids].to_numpy()].reset_index(drop=True)
        ids = data["GLOBAL_STUDENT_ID"].astype(str).to_numpy()
        systems = data["CNT"].astype(str).to_numpy()
        schools = data["GLOBAL_SCHOOL_ID"].astype(str).to_numpy()
        weights = data["W_FSTUWT"].to_numpy(float)

    if (len(data), len(np.unique(systems)), len(np.unique(schools))) != (
        N_EXPECTED,
        SYSTEMS_EXPECTED,
        SCHOOLS_EXPECTED,
    ):
        raise RuntimeError(f"PV{pv}: final T11 sample lock failed")
    if not (
        np.array_equal(ids, reference_ids)
        and np.array_equal(systems, reference_systems)
        and np.array_equal(schools, reference_schools)
        and np.allclose(weights, reference_weights, rtol=0, atol=1e-10)
    ):
        raise RuntimeError(f"PV{pv}: aligned design fields differ")
    if len(diagnostics) != 1 or not bool(diagnostics["convergence"].iloc[0]):
        raise RuntimeError(f"PV{pv}: invalid MRLE diagnostics")

    residual_sd = float(diagnostics["residual_weighted_population_sd"].iloc[0])
    if not np.isfinite(residual_sd) or residual_sd <= 0:
        raise RuntimeError(f"PV{pv}: invalid MRLE scale")

    achievement[:, column] = data["score_within_country_weighted_z"].to_numpy(float)
    # Zero-preserving standardization: scale the conditional residual without
    # recentering it, so zero retains its substantive reference meaning.
    mrle[:, column] = data["mrle_raw"].to_numpy(float) / residual_sd
    high_score = achievement[:, column] >= 0
    high_mrle = mrle[:, column] >= 0
    profiles[:, column] = np.select(
        [
            high_score & high_mrle,
            high_score & ~high_mrle,
            ~high_score & high_mrle,
            ~high_score & ~high_mrle,
        ],
        [0, 1, 2, 3],
    ).astype(np.int8)

    for code, label in enumerate(PROFILE_LABELS):
        mask = profiles[:, column] == code
        distribution_rows.append(
            {
                "PV": pv,
                "profile": label,
                "N": int(mask.sum()),
                "unweighted_proportion": float(mask.mean()),
                "W_FSTUWT_weighted_proportion": weighted_proportion(mask, weights),
            }
        )

pd.DataFrame(distribution_rows).to_csv(
    OUT / "profile_distribution_by_pv.csv", index=False
)

counts = np.stack([(profiles == code).sum(axis=1) for code in range(4)], axis=1)
majority_count = counts.max(axis=1)
all_ten_same = majority_count == 10
at_least_nine = majority_count >= 9
achievement_sign_stable = (achievement >= 0).all(axis=1) | (achievement < 0).all(axis=1)
mrle_sign_stable = (mrle >= 0).all(axis=1) | (mrle < 0).all(axis=1)

stability_rows = []
for metric, mask in (
    ("10/10 achievement sign agreement", achievement_sign_stable),
    ("10/10 MRLE sign agreement", mrle_sign_stable),
    ("10/10 full-profile agreement", all_ten_same),
    (">=9/10 same profile", at_least_nine),
):
    stability_rows.append(
        {
            "metric": metric,
            "N": int(mask.sum()),
            "unweighted_proportion": float(mask.mean()),
            "W_FSTUWT_weighted_proportion": weighted_proportion(mask, reference_weights),
        }
    )
pd.DataFrame(stability_rows).to_csv(OUT / "profile_10pv_stability.csv", index=False)

boundary_rows = []
for delta in DELTAS:
    clear_all_pvs = ((np.abs(achievement) > delta) & (np.abs(mrle) > delta)).all(axis=1)
    boundary_rows.append(
        {
            "delta": delta,
            "N_total": N_EXPECTED,
            "N_retained_clear_in_both_dimensions_all_PVs": int(clear_all_pvs.sum()),
            "unweighted_retained_proportion": float(clear_all_pvs.mean()),
            "W_FSTUWT_weighted_retained_proportion": weighted_proportion(
                clear_all_pvs, reference_weights
            ),
            "profile_10of10_agreement_among_retained": float(
                all_ten_same[clear_all_pvs].mean()
            ),
            "retention_definition": (
                "absolute achievement and MRLE exceed delta for every one of 10 PVs"
            ),
        }
    )
pd.DataFrame(boundary_rows).to_csv(OUT / "profile_boundary_sensitivity.csv", index=False)

print("Profile sensitivity complete: zero reference, three buffers, and 10-PV stability.")

