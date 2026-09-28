"""Final-sample targeted conditional-on-nuisance Fay-BRR sensitivity.

Only the final orthogonal estimating equation receives replicate weights.
MRLE and SFA are never refitted. Cross-fitted nuisance predictions use the
frozen final mutual DML implementation and are generated once under W_FSTUWT.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import math
import os
import subprocess
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow.dataset as ds
from scipy import stats


REPRO_ROOT = Path(os.environ.get("MATHEFF_REPRO_ROOT", Path.cwd()))
OUT = Path(os.environ.get("MATHEFF_BRR_OUTPUT", REPRO_ROOT / "outputs/fay_brr"))
SCRIPT_DIR = OUT / "work"
RESID_DIR = SCRIPT_DIR / "frozen_residuals"
FINAL_DML = Path(os.environ.get("MATHEFF_DML_OUTPUT", REPRO_ROOT / "outputs/t11_dml_full8"))
FINAL_SCRIPT = Path(os.environ.get("MATHEFF_DML_SCRIPT", Path(__file__).with_name("02_dml_analysis.py")))
FINAL_BY_PV = FINAL_DML / "full8_mutual_by_pv.csv"
FINAL_POOLED = FINAL_DML / "full8_mutual_pooled.csv"
REP_SOURCE = Path(os.environ.get("MATHEFF_REPLICATE_WEIGHT_INPUT", REPRO_ROOT / "data/pisa_replicate_weights"))

FACTORS = ["MATHEFF", "ANXMAT", "ICTWKDY"]
PVS = list(range(1, 11))
REPS = list(range(1, 81))
REP_COLS = [f"W_FSTURWT{i}" for i in REPS]
N, SYSTEMS, SCHOOLS = 86_125, 19, 5_058
COUNTRIES = ["ARG", "AUS", "BGR", "BRA", "CHL", "DEU", "DOM", "GBR", "JOR", "MLT",
             "PAN", "ROU", "SAU", "SGP", "SVK", "TAP", "TUR", "URY", "USA"]
FAY_K, R, M = 0.5, 80, 10
VAR_MULTIPLIER = 1.0 / (R * (1.0 - FAY_K) ** 2)  # 1/20 = .05
TOL = 1e-8

def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest().upper()


def load_final_module():
    spec = importlib.util.spec_from_file_location("frozen_final_dml", FINAL_SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def atomic_csv(frame: pd.DataFrame, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    frame.to_csv(temp, index=False, encoding="utf-8-sig")
    os.replace(temp, path)
    check = pd.read_csv(path)
    if len(check) != len(frame):
        raise RuntimeError(f"Output re-read failure: {path}")


def load_data_and_replicates(mod):
    data = mod.load_data()
    actual = sorted(data.CNT.astype(str).unique().tolist())
    if (len(data), data.CNT.nunique(), data.GLOBAL_SCHOOL_ID.nunique()) != (N, SYSTEMS, SCHOOLS):
        raise RuntimeError("FINAL_DML_SAMPLE_LOCK_FAIL")
    if actual != COUNTRIES or data.GLOBAL_STUDENT_ID.astype(str).duplicated().any():
        raise RuntimeError("FINAL_DML_SAMPLE_LOCK_FAIL")
    if (data.groupby("GLOBAL_SCHOOL_ID").DML_FOLD.nunique() > 1).any() or data.DML_FOLD.nunique() != 5:
        raise RuntimeError("FINAL_DML_SAMPLE_LOCK_FAIL")

    schema = ds.dataset(str(REP_SOURCE), format="parquet")
    strict = ["CNT", "CNTSCHID", "CNTSTUID"]
    requested = strict + ["W_FSTUWT"] + REP_COLS
    missing = [name for name in requested if name not in schema.schema.names]
    if missing:
        raise RuntimeError("REPLICATE_WEIGHT_LOCK_FAIL: " + ",".join(missing))
    table = schema.to_table(columns=requested, filter=ds.field("CNT").isin(COUNTRIES))
    reps = table.to_pandas()
    reps["CNT"] = reps.CNT.astype(str)
    for col in ["CNTSCHID", "CNTSTUID"]:
        reps[col] = pd.to_numeric(reps[col], errors="raise").astype("int64")
        data[col] = pd.to_numeric(data[col], errors="raise").astype("int64")
    if reps.duplicated(strict).any():
        raise RuntimeError("REPLICATE_WEIGHT_LOCK_FAIL: duplicate strict keys")
    merged = data.merge(reps, on=strict, how="left", validate="one_to_one", suffixes=("", "_rep"), indicator=True)
    if len(merged) != N or (merged._merge != "both").any() or merged[REP_COLS].isna().any().any():
        raise RuntimeError("REPLICATE_WEIGHT_LOCK_FAIL: alignment/missing failure")
    if np.max(np.abs(merged.W_FSTUWT - merged.W_FSTUWT_rep)) > 1e-8:
        raise RuntimeError("REPLICATE_WEIGHT_LOCK_FAIL: W_FSTUWT mismatch")
    merged.drop(columns=["_merge", "W_FSTUWT_rep"], inplace=True)
    values = merged[REP_COLS].to_numpy(float)
    if not np.isfinite(values).all() or (values < 0).any():
        raise RuntimeError("REPLICATE_WEIGHT_LOCK_FAIL: weights must be finite and >=0")
    return merged


def write_design_and_weight_audit(data, mod) -> None:
    audit = []
    for i, col in enumerate(REP_COLS, 1):
        x = data[col].to_numpy(float)
        audit.append({
            "replicate": i, "actual_variable": col, "N": len(x), "sum": float(x.sum()),
            "mean": float(x.mean()), "min": float(x.min()), "max": float(x.max()),
            "zero_count": int((x == 0).sum()), "missing_count": int(np.isnan(x).sum()),
            "finite_YN": "YES" if np.isfinite(x).all() else "NO", "nonnegative_YN": "YES" if (x >= 0).all() else "NO",
        })
    atomic_csv(pd.DataFrame(audit), OUT / "02_REPLICATE_WEIGHT_AUDIT.csv")

    controls = "\n".join(
        f"- `{factor}`: " + ", ".join(f"`{x}`" for x in mod.controls_for("mutual", factor))
        for factor in FACTORS
    )
    text = f"""# Final targeted Fay-BRR design lock

## Scope

- Sample: {N:,} students, {SCHOOLS:,} schools, {SYSTEMS} systems.
- Systems: {', '.join(COUNTRIES)}.
- Factors: MATHEFF, ANXMAT, ICTWKDY only.
- Specification: final mutually adjusted DML.
    - DML implementation: `analysis/02_dml_analysis.py`.
    - Required full-sample estimates: `full8_mutual_by_pv.csv` and `full8_mutual_pooled.csv`.

## Frozen DML implementation

- Learner: `ExtraTreesRegressor(n_estimators=300, min_samples_leaf=10, max_features=0.8, n_jobs=-1)`.
- Cross-fitting: 5-fold `StratifiedGroupKFold`, stratified by `CNT`, grouped by school, shuffle enabled, fold seed 2026.
- Outcome nuisance seed: 30100 plus fold number.
- Treatment seeds: MATHEFF 20260, ANXMAT 40100, ICTWKDY 40600, each plus fold number.
- Nuisance weights: `W_FSTUWT` normalized by one global constant.
- Treatment scaling: locked-sample unweighted z score with population SD (`ddof=0`).
- Outcome: frozen PV-specific T11 MRLE raw residual divided by its frozen weighted population SD.

## Mutual controls

{controls}

## Replicate-weight design

- Actual local variable names: `W_FSTURWT1` through `W_FSTURWT80`. The prompt shorthand `W_FSTRr` refers to these frozen PISA replicate-weight columns; no variables were renamed.
- Replicates: R = 80; Fay coefficient k = 0.5.
- Per-PV variance: `V_BRR,p = [1 / (R(1-k)^2)] sum_r(theta_pr-theta_p)^2 = (1/20) sum_r(theta_pr-theta_p)^2`.
- PV pooling: `theta_bar = mean(theta_p)`, `Ubar = mean(V_BRR,p)`, `B = var(theta_p, ddof=1)`, `T = Ubar + (1+1/M)B`, M=10.
- Degrees of freedom: `nu=(M-1)[1+Ubar/((1+1/M)B)]^2`, with the same near-zero-B normal-limit guard as the final DML pooling function.

This targeted BRR analysis propagates replicate weights through the final orthogonal estimating equation while holding the full-sample cross-fitted nuisance functions fixed.

Its purpose is to assess design-based sensitivity of the final DML estimating equation rather than to provide full two-stage variance propagation through MRLE construction and nuisance-model estimation.
"""
    (OUT / "01_DESIGN_LOCK.md").write_text(text, encoding="utf-8")


def residual_path(factor: str, pv: int) -> Path:
    return RESID_DIR / f"{factor}_PV{pv:02d}_orthogonal_residuals.parquet"


def generate_residual(factor: str, pv: int) -> None:
    if factor not in FACTORS or pv not in PVS:
        raise ValueError("Unauthorized factor/PV")
    mod = load_final_module()
    data = mod.load_data()
    that, _, controls = mod.ensure_treatment_cache(data, "mutual", factor)
    y, _ = mod.load_outcome(data, pv)
    w_nuisance = data.W_DML_OECD.to_numpy(float)
    yhat, details, _ = mod.cross_fit(data, y, controls, mod.OUTCOME_SEED, w_nuisance, "outcome", factor, pv)
    raw = data[factor].to_numpy(float)
    zt = (raw - raw.mean()) / raw.std(ddof=0)
    yres, tres = y - yhat, zt - that
    theta_check = float(np.sum(data.W_FSTUWT.to_numpy(float) * tres * yres) /
                        np.sum(data.W_FSTUWT.to_numpy(float) * tres ** 2))
    frozen = pd.read_csv(FINAL_BY_PV)
    theta_frozen = float(frozen.loc[(frozen.factor == factor) & (frozen.PV == pv), "theta"].iloc[0])
    if abs(theta_check - theta_frozen) >= TOL:
        raise RuntimeError(f"FROZEN_DML_SCORE_ALIGNMENT_FAIL: {factor}/PV{pv} diff={theta_check-theta_frozen}")
    out = pd.DataFrame({
        "GLOBAL_STUDENT_ID": data.GLOBAL_STUDENT_ID.astype(str), "Y_tilde": yres,
        "D_tilde": tres, "DML_FOLD": data.DML_FOLD.astype(int),
    })
    path = residual_path(factor, pv)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(".tmp.parquet")
    out.to_parquet(temp, index=False)
    os.replace(temp, path)
    check = pd.read_parquet(path)
    if len(check) != N or check.GLOBAL_STUDENT_ID.duplicated().any() or check[["Y_tilde", "D_tilde"]].isna().any().any():
        raise RuntimeError(f"Residual checkpoint validation failed: {factor}/PV{pv}")
    if int(details.school_overlap.max()) != 0:
        raise RuntimeError(f"School leakage: {factor}/PV{pv}")
    print(f"COMPLETE {factor} PV{pv}: theta_check={theta_check:.15g} hash={sha256(path)}", flush=True)


def valid_residual(factor: str, pv: int) -> bool:
    path = residual_path(factor, pv)
    if not path.exists() or path.stat().st_size == 0:
        return False
    try:
        d = pd.read_parquet(path)
        return len(d) == N and not d.GLOBAL_STUDENT_ID.duplicated().any() and not d[["Y_tilde", "D_tilde"]].isna().any().any()
    except Exception:
        return False


def aggregate() -> None:
    mod = load_final_module()
    data = load_data_and_replicates(mod)
    write_design_and_weight_audit(data, mod)
    frozen_by = pd.read_csv(FINAL_BY_PV)
    frozen_pool = pd.read_csv(FINAL_POOLED)
    w_full = data.W_FSTUWT.to_numpy(float)
    ids = data.GLOBAL_STUDENT_ID.astype(str)

    align_rows, rep_rows, pv_rows = [], [], []
    for factor in FACTORS:
        controls = mod.controls_for("mutual", factor)
        for pv in PVS:
            path = residual_path(factor, pv)
            if not valid_residual(factor, pv):
                raise RuntimeError(f"Missing/invalid frozen residual: {factor}/PV{pv}")
            res = pd.read_parquet(path)
            aligned = pd.DataFrame({"GLOBAL_STUDENT_ID": ids}).merge(res, on="GLOBAL_STUDENT_ID", validate="one_to_one")
            if len(aligned) != N or (aligned.DML_FOLD.to_numpy(int) != data.DML_FOLD.to_numpy(int)).any():
                raise RuntimeError(f"Frozen residual alignment failure: {factor}/PV{pv}")
            yres, dres = aligned.Y_tilde.to_numpy(float), aligned.D_tilde.to_numpy(float)
            denom_full = float(np.sum(w_full * dres ** 2))
            theta_check = float(np.sum(w_full * dres * yres) / denom_full)
            theta_frozen = float(frozen_by.loc[(frozen_by.factor == factor) & (frozen_by.PV == pv), "theta"].iloc[0])
            diff = theta_check - theta_frozen
            if not np.isfinite(denom_full) or denom_full <= 0 or abs(diff) >= TOL:
                raise RuntimeError(f"FROZEN_DML_SCORE_ALIGNMENT_FAIL: {factor}/PV{pv}; diff={diff}")
            align_rows.append({
                "source_file": str(path), "factor": factor, "PV": pv, "N": N, "school_count": SCHOOLS,
                "system_count": SYSTEMS, "hash_SHA256": sha256(path), "residual_origin": "REGENERATED_ONCE_FINAL_FULL_WEIGHT",
                "analysis_type": "mutual", "control_count": len(controls), "control_signature": mod.signature("mutual", factor, controls),
                "fold_seed": mod.FOLD_SEED, "treatment_seed": mod.TREATMENT_SEEDS[factor], "outcome_seed": mod.OUTCOME_SEED,
                "school_leakage": 0, "theta_frozen": theta_frozen, "theta_check": theta_check,
                "absolute_difference": abs(diff), "alignment_status": "PASS",
            })
            thetas = []
            for rep, col in zip(REPS, REP_COLS):
                wr = data[col].to_numpy(float)
                denominator = float(np.sum(wr * dres ** 2))
                theta_r = float(np.sum(wr * dres * yres) / denominator) if denominator > 0 else np.nan
                valid = np.isfinite(denominator) and denominator > 0 and np.isfinite(theta_r)
                rep_rows.append({
                    "factor": factor, "PV": pv, "replicate": rep, "full_theta": theta_frozen,
                    "replicate_theta": theta_r, "difference": theta_r - theta_frozen,
                    "replicate_weight_sum": float(wr.sum()), "denominator": denominator,
                    "valid_YN": "YES" if valid else "NO",
                })
                if not valid:
                    raise RuntimeError(f"INVALID_REPLICATE: {factor}/PV{pv}/rep{rep}")
                thetas.append(theta_r)
            thetas = np.asarray(thetas)
            variance = float(VAR_MULTIPLIER * np.sum((thetas - theta_frozen) ** 2))
            pv_rows.append({
                "factor": factor, "PV": pv, "theta_full": theta_frozen, "BRR_variance": variance,
                "BRR_SE": math.sqrt(variance), "replicate_theta_min": float(thetas.min()),
                "replicate_theta_max": float(thetas.max()), "replicate_theta_mean": float(thetas.mean()),
                "n_replicates": len(thetas), "max_abs_rep_shift": float(np.max(np.abs(thetas - theta_frozen))),
            })

    alignment = pd.DataFrame(align_rows)
    replicate = pd.DataFrame(rep_rows)
    by_pv = pd.DataFrame(pv_rows)
    if len(replicate) != 2400 or (replicate.valid_YN != "YES").any() or len(by_pv) != 30:
        raise RuntimeError("Replicate output dimension failure")
    atomic_csv(alignment, OUT / "03_FROZEN_DML_ALIGNMENT.csv")
    atomic_csv(replicate, OUT / "04_BRR_ESTIMATES_BY_PV_REPLICATE.csv")
    atomic_csv(by_pv, OUT / "05_BRR_VARIANCE_BY_PV.csv")

    pooled_rows = []
    for factor in FACTORS:
        g = by_pv.loc[by_pv.factor == factor]
        theta = g.theta_full.to_numpy(float)
        theta_bar = float(theta.mean())
        ubar = float(g.BRR_variance.mean())
        b = float(theta.var(ddof=1))
        added = (1 + 1 / M) * b
        total = ubar + added
        se = math.sqrt(total)
        if added <= np.finfo(float).eps * max(ubar, 1.0):
            df, crit = np.inf, stats.norm.ppf(.975)
        else:
            df = (M - 1) * (1 + ubar / added) ** 2
            crit = stats.t.ppf(.975, df)
        low, high = theta_bar - crit * se, theta_bar + crit * se
        pooled_rows.append({
            "factor": factor, "theta": theta_bar, "Ubar_BRR": ubar, "B_PV": b,
            "total_variance": total, "SE_BRR_PV": se, "df": df, "CI_low": low, "CI_high": high,
            "direction": "positive" if theta_bar > 0 else "negative" if theta_bar < 0 else "zero",
            "CI_excludes_zero_YN": "YES" if low > 0 or high < 0 else "NO",
            "PV_direction_consistency": f"{int(max((theta > 0).sum(), (theta < 0).sum()))}/10",
        })
    pooled = pd.DataFrame(pooled_rows)
    atomic_csv(pooled, OUT / "06_BRR_POOLED_CORE3.csv")

    comp_rows = []
    for row in pooled.itertuples():
        old = frozen_pool.loc[frozen_pool.factor == row.factor].iloc[0]
        theta_final = float(old.pooled_estimate)
        if abs(theta_final - row.theta) >= TOL:
            raise RuntimeError(f"Pooled theta mismatch: {row.factor}")
        cluster_excludes = float(old.CI_low) > 0 or float(old.CI_high) < 0
        brr_excludes = row.CI_low > 0 or row.CI_high < 0
        ratio = row.SE_BRR_PV / float(old.pooled_SE)
        size_word = "larger" if ratio > 1 else "smaller" if ratio < 1 else "equal"
        comp_rows.append({
            "factor": row.factor, "theta_final": theta_final, "SE_cluster_PV": float(old.pooled_SE),
            "CI_cluster_low": float(old.CI_low), "CI_cluster_high": float(old.CI_high),
            "SE_BRR_PV": row.SE_BRR_PV, "CI_BRR_low": row.CI_low, "CI_BRR_high": row.CI_high,
            "SE_ratio_BRR_to_cluster": ratio, "direction_same_YN": "YES",
            "zero_exclusion_same_YN": "YES" if cluster_excludes == brr_excludes else "NO",
            "interpretation": f"Frozen magnitude and direction preserved; targeted BRR+PV SE is {size_word} than cluster+PV SE; CI zero-exclusion {'preserved' if cluster_excludes == brr_excludes else 'changed'}.",
        })
    comp = pd.DataFrame(comp_rows)
    atomic_csv(comp, OUT / "07_CLUSTER_VS_BRR_COMPARISON.csv")

    directions = int((comp.direction_same_YN == "YES").sum())
    ci_same = int((comp.zero_exclusion_same_YN == "YES").sum())
    lines = []
    for row in comp.itertuples():
        lines.append(f"- **{row.factor}:** theta={row.theta_final:+.6f}; cluster+PV SE={row.SE_cluster_PV:.6f}; targeted BRR+PV SE={row.SE_BRR_PV:.6f} (ratio={row.SE_ratio_BRR_to_cluster:.3f}); BRR 95% CI [{row.CI_BRR_low:+.6f}, {row.CI_BRR_high:+.6f}]. Direction and CI zero-exclusion were {'preserved' if row.zero_exclusion_same_YN == 'YES' else 'not both preserved'}.")
    interpretation = f"""# Targeted Fay-BRR interpretation

## Scientific scope

This is a final-sample, conditional-on-cross-fitted-nuisance Fay-BRR sensitivity of the frozen mutual DML orthogonal estimating equation. It is not full two-stage survey variance propagation: MRLE was not refitted, and nuisance functions were not refitted under each replicate weight.

Equal-system sensitivity and Fay-BRR answer different questions. Equal-system weighting changes the cross-system estimand; Fay-BRR examines PISA complex-sampling variance while retaining the population-weighted estimand.

## Results

{chr(10).join(lines)}

Directions were preserved for {directions}/3 factors, and CI zero-exclusion conclusions were preserved for {ci_same}/3. The full-sample magnitudes are unchanged by construction. These findings describe targeted design-based uncertainty and do not establish causal robustness, full survey-design variance propagation, or correctness of the estimates.
"""
    (OUT / "08_BRR_INTERPRETATION.md").write_text(interpretation, encoding="utf-8")

    qa = f"""# QA checks

| Check | Result |
|---|---|
| Final N | {N:,} (PASS) |
| Systems | {SYSTEMS} (PASS) |
| Schools | {SCHOOLS:,} (PASS) |
| System set | {', '.join(COUNTRIES)} (PASS) |
| Factors | 3 (PASS) |
| PVs | 10 (PASS) |
| Replicate weights | 80 actual `W_FSTURWT` columns (PASS) |
| Replicate estimates | 2,400 (PASS) |
| Fay k | 0.5 (PASS) |
| Variance multiplier | 1/20 = 0.05 (PASS) |
| All denominators finite and >0 | PASS |
| All replicate estimates finite | PASS |
| Any invalid replicate | NO |
| Full-estimate score reconstruction | PASS; max abs diff {alignment.absolute_difference.max():.3e} |
| Nuisance residual generation | Once under final full weight; 30/30 |
| Nuisance replicate refit | NO |
| Fold reassignment | NO |
| MRLE refit | NO |
| SFA rerun | NO |
| Frozen DML outputs changed | NO |
| PRIVATE SOURCE changed | NO |
"""
    (OUT / "10_QA_CHECKS.md").write_text(qa, encoding="utf-8")

    print("Targeted Fay-BRR complete: 3 factors x 10 PVs x 80 replicates.")


def prepare() -> None:
    mod = load_final_module()
    data = load_data_and_replicates(mod)
    OUT.mkdir(parents=True, exist_ok=True)
    RESID_DIR.mkdir(parents=True, exist_ok=True)
    write_design_and_weight_audit(data, mod)
    print("PREPARE PASS: final sample and 80 replicate weights locked", flush=True)


def coordinate() -> None:
    prepare()
    for factor in FACTORS:
        for pv in PVS:
            if valid_residual(factor, pv):
                print(f"REUSE {factor} PV{pv}", flush=True)
                continue
            subprocess.run([sys.executable, str(Path(__file__)), "residual", "--factor", factor, "--pv", str(pv)], check=True)
    aggregate()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["prepare", "residual", "aggregate", "coordinate"])
    parser.add_argument("--factor", choices=FACTORS)
    parser.add_argument("--pv", type=int, choices=PVS)
    args = parser.parse_args()
    if args.mode == "prepare":
        prepare()
    elif args.mode == "residual":
        if args.factor is None or args.pv is None:
            parser.error("residual requires --factor and --pv")
        generate_residual(args.factor, args.pv)
    elif args.mode == "aggregate":
        aggregate()
    else:
        coordinate()


if __name__ == "__main__":
    main()

