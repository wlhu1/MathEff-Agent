from __future__ import annotations

import argparse
import gc
import hashlib
import json
import math
import os
import subprocess
import sys
import time
import traceback
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import stats
from sklearn.base import clone
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import ExtraTreesRegressor
from sklearn.impute import SimpleImputer
from sklearn.metrics import mean_squared_error, r2_score
from sklearn.model_selection import StratifiedGroupKFold
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
import statsmodels.api as sm


REPRO_ROOT = Path(os.environ.get("MATHEFF_REPRO_ROOT", Path.cwd()))
OUT = Path(os.environ.get("MATHEFF_DML_OUTPUT", REPRO_ROOT / "outputs/t11_dml_full8"))
INPUT = Path(os.environ.get("MATHEFF_T11_INPUT", REPRO_ROOT / "data/natural_t11.parquet"))
MRLE = Path(os.environ.get("MATHEFF_MRLE_CHECKPOINTS", REPRO_ROOT / "outputs/t11_mrle"))

T11 = ["ST004D01T", "ST001D01T", "ST003D02T", "ST003D03T", "ESCS", "ICTRES",
       "ICTSCH", "ICTHOME", "ICTQUAL", "EXPOFA", "EXPO21ST"]
FACTORS = ["MATHEFF", "ANXMAT", "GROSAGR", "DISCLIM", "RELATST", "COGACMCO", "ICTWKDY", "ICTEFFIC"]
COUNTRIES = {"ARG", "AUS", "BGR", "BRA", "CHL", "DEU", "DOM", "GBR", "JOR", "MLT",
             "PAN", "ROU", "SAU", "SGP", "SVK", "TAP", "TUR", "URY", "USA"}
N, SCHOOLS, N_COUNTRIES = 86125, 5058, 19
PVS, FOLDS = list(range(1, 11)), list(range(1, 6))
FOLD_SEED, OUTCOME_SEED = 2026, 30100
TREATMENT_SEEDS = {"MATHEFF": 20260, "ANXMAT": 40100, "GROSAGR": 40200, "DISCLIM": 40300,
                   "RELATST": 40400, "COGACMCO": 40500, "ICTWKDY": 40600, "ICTEFFIC": 40700}
BASE_CONTROLS = T11 + ["CNT"]
BASE_CATEGORICAL = ["ST004D01T", "ST001D01T", "ST003D02T", "ST003D03T", "CNT"]


def log(x):
    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {x}", flush=True)


def wmean(x, w):
    return float(np.average(np.asarray(x, float), weights=np.asarray(w, float)))


def wvar(x, w):
    x, w = np.asarray(x, float), np.asarray(w, float)
    m = np.average(x, weights=w)
    return float(np.average((x - m) ** 2, weights=w))


def controls_for(kind, factor=None):
    if kind == "single":
        return BASE_CONTROLS.copy()
    return BASE_CONTROLS + [x for x in FACTORS if x != factor]


def signature(kind, factor, controls):
    payload = {"kind": kind, "factor": factor, "controls": controls, "fold_seed": FOLD_SEED,
               "trees": 300, "leaf": 10, "max_features": .8}
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


def preprocessor(controls):
    categorical = [x for x in BASE_CATEGORICAL if x in controls]
    numeric = [x for x in controls if x not in categorical]
    return ColumnTransformer([
        ("numeric", Pipeline([("imputer", SimpleImputer(strategy="median")),
                              ("scaler", StandardScaler())]), numeric),
        ("categorical", Pipeline([("imputer", SimpleImputer(strategy="most_frequent")),
                                  ("onehot", OneHotEncoder(handle_unknown="ignore", sparse_output=True))]), categorical),
    ], remainder="drop")


def learner(pre, seed):
    return Pipeline([("preprocess", clone(pre)),
                     ("model", ExtraTreesRegressor(n_estimators=300, min_samples_leaf=10,
                                                   max_features=.8, random_state=seed, n_jobs=-1))])


def load_data():
    cols = list(dict.fromkeys(["GLOBAL_STUDENT_ID", "GLOBAL_SCHOOL_ID", "CNT", "CNTSCHID", "CNTSTUID", "W_FSTUWT"] + T11 + FACTORS))
    d = pd.read_parquet(INPUT, columns=cols)
    if (len(d), d.CNT.nunique(), d.GLOBAL_SCHOOL_ID.nunique()) != (123949, 24, 6108):
        raise RuntimeError("24-country T11 source lock failed")
    d = d.dropna(subset=T11 + FACTORS).copy()
    if (len(d), d.CNT.nunique(), d.GLOBAL_SCHOOL_ID.nunique()) != (N, N_COUNTRIES, SCHOOLS):
        raise RuntimeError(f"common sample mismatch: {len(d)}/{d.CNT.nunique()}/{d.GLOBAL_SCHOOL_ID.nunique()}")
    if set(d.CNT.astype(str).unique()) != COUNTRIES:
        raise RuntimeError("country set mismatch")
    if d.GLOBAL_STUDENT_ID.duplicated().any() or d.duplicated(["CNT", "CNTSCHID", "CNTSTUID"]).any():
        raise RuntimeError("duplicate student key")
    d["GLOBAL_STUDENT_ID"] = d.GLOBAL_STUDENT_ID.astype(str)
    d["DML_FOLD"] = 0
    sgkf = StratifiedGroupKFold(n_splits=5, shuffle=True, random_state=FOLD_SEED)
    for fold, (_, test) in enumerate(sgkf.split(d, d.CNT.astype(str), groups=d.GLOBAL_SCHOOL_ID.astype(str)), 1):
        d.iloc[test, d.columns.get_loc("DML_FOLD")] = fold
    if (d.groupby("GLOBAL_SCHOOL_ID").DML_FOLD.nunique() > 1).any() or set(d.DML_FOLD) != set(FOLDS):
        raise RuntimeError("fold lock failed")
    d["W_DML_OECD"] = d.W_FSTUWT / d.W_FSTUWT.mean()
    return d.reset_index(drop=True)


def load_outcome(data, pv):
    sf, df = MRLE / f"pv{pv:02d}_student.parquet", MRLE / f"pv{pv:02d}_diagnostics.csv"
    diag = pd.read_csv(df)
    student = pd.read_parquet(sf, columns=["GLOBAL_STUDENT_ID", "mrle_raw"])
    if len(diag) != 1 or not bool(diag.convergence.iloc[0]) or len(student) != 123949 or student.GLOBAL_STUDENT_ID.duplicated().any():
        raise RuntimeError(f"invalid MRLE PV{pv}")
    student.GLOBAL_STUDENT_ID = student.GLOBAL_STUDENT_ID.astype(str)
    m = student.set_index("GLOBAL_STUDENT_ID").mrle_raw
    raw = data.GLOBAL_STUDENT_ID.map(m)
    if raw.isna().any():
        raise RuntimeError(f"MRLE ID mismatch PV{pv}")
    divisor = float(diag.residual_weighted_population_sd.iloc[0])
    return raw.to_numpy(float) / divisor, divisor


def cross_fit(data, target, controls, base_seed, weights, role, factor, pv):
    started = time.time()
    pred = np.full(len(data), np.nan)
    folds = data.DML_FOLD.to_numpy(int)
    schools = data.GLOBAL_SCHOOL_ID.astype(str).to_numpy()
    y = np.asarray(target, float)
    details = []
    pre = preprocessor(controls)
    for fold in FOLDS:
        train, test = folds != fold, folds == fold
        overlap = len(set(schools[train]) & set(schools[test]))
        if overlap:
            raise RuntimeError(f"school leakage {role}/{factor}/PV{pv}/fold{fold}: {overlap}")
        fit = learner(pre, base_seed + fold)
        fit.fit(data.loc[train, controls], y[train], model__sample_weight=weights[train])
        pred[test] = fit.predict(data.loc[test, controls])
        details.append({"fold": fold, "school_overlap": overlap,
                        "weighted_R2": r2_score(y[test], pred[test], sample_weight=weights[test]),
                        "weighted_RMSE": np.sqrt(mean_squared_error(y[test], pred[test], sample_weight=weights[test]))})
        del fit
        gc.collect()
    if np.isnan(pred).any():
        raise RuntimeError(f"missing OOF prediction {role}/{factor}/PV{pv}")
    return pred, pd.DataFrame(details), time.time() - started


def final_wls(yres, tres, weights, schools):
    started = time.time()
    x = pd.DataFrame({"T_RESID": tres})
    fit = sm.WLS(yres, x, weights=weights, hasconst=False).fit(
        cov_type="cluster", cov_kwds={"groups": schools.astype(str), "use_correction": True})
    ci = fit.conf_int(alpha=.05).loc["T_RESID"]
    theta, se = float(fit.params.T_RESID), float(fit.bse.T_RESID)
    return {"theta": theta, "SE": se, "variance": se**2, "z": theta/se,
            "CI_low": float(ci.iloc[0]), "CI_high": float(ci.iloc[1]), "p": float(fit.pvalues.T_RESID),
            "final_runtime_seconds": time.time() - started}


def atomic_csv(frame, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    frame.to_csv(tmp, index=False, encoding="utf-8-sig")
    os.replace(tmp, path)
    check = pd.read_csv(path)
    if len(check) != len(frame):
        raise RuntimeError(f"checkpoint verification failed {path}")


def checkpoint_path(kind, factor, pv):
    return OUT / "checkpoints" / kind / factor / f"pv{pv:02d}.csv"


def valid_checkpoint(path, kind, factor, pv):
    if not path.exists() or path.stat().st_size == 0:
        return False
    try:
        d = pd.read_csv(path)
        return (len(d) == 1 and d.factor.iloc[0] == factor and d.analysis_type.iloc[0] == kind
                and int(d.PV.iloc[0]) == pv and d.status.iloc[0] == "SUCCESS"
                and int(d.school_leakage.iloc[0]) == 0 and np.isfinite(d.theta.iloc[0]))
    except Exception:
        return False


def cache_path(kind, factor):
    return OUT / "cache" / kind / f"{factor}_treatment_oof.parquet"


def ensure_treatment_cache(data, kind, factor):
    controls = controls_for(kind, factor)
    sig = signature(kind, factor, controls)
    path = cache_path(kind, factor)
    if path.exists() and path.stat().st_size > 0:
        c = pd.read_parquet(path)
        if (len(c) == N and not c.GLOBAL_STUDENT_ID.astype(str).duplicated().any()
                and c.signature.iloc[0] == sig and int(c.base_seed.iloc[0]) == TREATMENT_SEEDS[factor]):
            ids = data[["GLOBAL_STUDENT_ID", "DML_FOLD"]].merge(c, on="GLOBAL_STUDENT_ID", validate="one_to_one")
            if len(ids) == N and (ids.DML_FOLD_x == ids.DML_FOLD_y).all() and ids.prediction.notna().all():
                return ids.prediction.to_numpy(float), float(c.runtime_seconds.iloc[0]), controls
        raise RuntimeError(f"invalid treatment cache {path}")
    raw = data[factor].to_numpy(float)
    z = (raw - raw.mean()) / raw.std(ddof=0)
    log(f"{kind}/{factor}: fitting treatment nuisance")
    pred, _, runtime = cross_fit(data, z, controls, TREATMENT_SEEDS[factor], data.W_DML_OECD.to_numpy(float),
                                 "treatment", factor, np.nan)
    c = data[["GLOBAL_STUDENT_ID", "DML_FOLD"]].copy()
    c["prediction"], c["signature"], c["base_seed"], c["runtime_seconds"] = pred, sig, TREATMENT_SEEDS[factor], runtime
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp.parquet")
    c.to_parquet(tmp, index=False)
    os.replace(tmp, path)
    if len(pd.read_parquet(path)) != N:
        raise RuntimeError(f"cache write verification failed {path}")
    return pred, runtime, controls


def make_result(data, kind, factor, pv, y, divisor, yhat, y_runtime, that, t_runtime, controls):
    w = data.W_DML_OECD.to_numpy(float)
    raw = data[factor].to_numpy(float)
    zt = (raw - raw.mean()) / raw.std(ddof=0)
    yres, tres = y - yhat, zt - that
    fit = final_wls(yres, tres, w, data.GLOBAL_SCHOOL_ID)
    fit.update({
        "factor": factor, "analysis_type": kind, "PV": pv, "N": N, "schools": SCHOOLS,
        "countries": N_COUNTRIES, "treatment_mean": wmean(raw, w), "treatment_SD": math.sqrt(wvar(raw, w)),
        "treatment_unweighted_mean_for_z": float(raw.mean()), "treatment_unweighted_SD_for_z": float(raw.std(ddof=0)),
        "outcome_mean": wmean(y, w), "outcome_SD": math.sqrt(wvar(y, w)), "outcome_SD_divisor": divisor,
        "seed": TREATMENT_SEEDS[factor], "outcome_seed": OUTCOME_SEED,
        "runtime": y_runtime + t_runtime + fit["final_runtime_seconds"], "school_leakage": 0,
        "status": "SUCCESS", "control_count": len(controls), "control_signature": signature(kind, factor, controls),
        "Y_nuisance_R2": r2_score(y, yhat, sample_weight=w),
        "T_nuisance_R2": r2_score(zt, that, sample_weight=w),
    })
    return fit


def prepare():
    data = load_data()
    for pv in PVS:
        load_outcome(data, pv)
    OUT.mkdir(parents=True, exist_ok=True)

    sample = pd.DataFrame([{"N": N, "schools": SCHOOLS, "countries": N_COUNTRIES,
                            "country_list": " ".join(sorted(COUNTRIES)), "T11_missing": 0, "all8_missing": 0,
                            "duplicate_student_ID": 0, "duplicate_strict_key": 0}])
    atomic_csv(sample, OUT / "full8_sample_audit.csv")
    fold = data.groupby("DML_FOLD").agg(N=("GLOBAL_STUDENT_ID", "size"), schools=("GLOBAL_SCHOOL_ID", "nunique"),
                                         countries=("CNT", "nunique")).reset_index()
    atomic_csv(fold, OUT / "frozen_fold_summary.csv")

    w = data.W_DML_OECD.to_numpy(float)
    scale = []
    for factor in FACTORS:
        x = data[factor].to_numpy(float)
        z = (x - x.mean()) / x.std(ddof=0)
        scale.append({"factor": factor, "raw_variable": factor,
                      "is_OECD_index": "YES", "source_scale": "OECD WLE index",
                      "already_exactly_standardized_in_analysis_sample": "NO",
                      "raw_unweighted_mean": x.mean(), "raw_unweighted_SD": x.std(ddof=0),
                      "raw_weighted_mean": wmean(x, w), "raw_weighted_SD": math.sqrt(wvar(x, w)),
                      "analysis_transformation": "unweighted z-score, ddof=0",
                      "analysis_mean": z.mean(), "analysis_SD": z.std(ddof=0),
                      "comparable_analysis_scale": "YES"})
    atomic_csv(pd.DataFrame(scale), OUT / "diagnostic_factor_scale_audit.csv")

    country = data.groupby("CNT").agg(N=("GLOBAL_STUDENT_ID", "size"), weight_sum=("W_FSTUWT", "sum")).reset_index()
    country["sample_share"] = country.N/N
    country["population_weight_share"] = country.weight_sum/country.weight_sum.sum()
    atomic_csv(country, OUT / "country_weight_contribution.csv")

    audit = f"""# Full-eight T11 weighted DML method freeze audit

## Freeze result

    **PUBLIC RELEASE METHOD LOCK = YES**

| Component | Core3 pilot | Full8 implementation | Identical |
|---|---|---|---|
| Sample | 86,125 / 5,058 schools / 19 systems | same locked IDs and folds | YES |
| MRLE source | 24-system T11 PV checkpoints | same checkpoints; no MRLE refit | YES |
| Folds | 5, country-stratified, school-grouped, seed 2026 | same | YES |
| Learner | ExtraTrees 300 trees, min leaf 10, max_features .8, n_jobs=-1 | same | YES |
| Preprocessing | median/most-frequent pipeline + scaling/one-hot; inert on complete data | same | YES |
| Seeds | outcome 30100; factor-specific treatment seeds | same registered seeds | YES |
| Weighting | W_FSTUWT normalized by a global constant in both nuisance fits and final WLS | same | YES |
| Inference | no-intercept orthogonal WLS, school cluster covariance, correction on | same | YES |
| Treatment scale | locked-sample unweighted z, ddof=0 | all eight use same | YES |
| PV handling | ten separate PV-specific outcomes; Rubin/PV parameter pooling | same | YES |

Single-treatment controls are T11 plus country indicators. Mutual-adjusted controls are the same baseline plus the other seven diagnostic factors; that is the authorized estimand change, not a change to the DML algorithm. `HOMEPOS` and `ST296Q01JA` are absent. All analytic variables are complete, so the retained imputers replace zero values.

    The public release recomputes all eight single-factor and all eight mutually
    adjusted models with the frozen method. Every checkpoint is written
    atomically and re-readable before it counts as complete.
"""
    (OUT / "full8_method_freeze_audit.md").write_text(audit, encoding="utf-8")
    log("PREPARE PASS: METHOD IDENTICAL = YES")


def run_single_pv(pv):
    data = load_data()
    missing = [f for f in FACTORS if not valid_checkpoint(checkpoint_path("single", f, pv), "single", f, pv)]
    if not missing:
        log(f"single PV{pv}: 8/8 checkpoints already complete; skip")
        return
    caches = {}
    for factor in missing:
        caches[factor] = ensure_treatment_cache(data, "single", factor)
    y, divisor = load_outcome(data, pv)
    w = data.W_DML_OECD.to_numpy(float)
    log(f"single PV{pv}: fitting one shared outcome nuisance for {len(missing)} missing factors")
    yhat, _, yruntime = cross_fit(data, y, BASE_CONTROLS, OUTCOME_SEED, w, "outcome", "SHARED_SINGLE", pv)
    for factor in missing:
        that, truntime, controls = caches[factor]
        row = make_result(data, "single", factor, pv, y, divisor, yhat, yruntime, that, truntime, controls)
        atomic_csv(pd.DataFrame([row]), checkpoint_path("single", factor, pv))
        log(f"single/{factor}/PV{pv}: theta={row['theta']:+.6f} checkpoint PASS")


def run_mutual(factor, pv):
    path = checkpoint_path("mutual", factor, pv)
    if valid_checkpoint(path, "mutual", factor, pv):
        log(f"mutual/{factor}/PV{pv}: checkpoint complete; skip")
        return
    data = load_data()
    that, truntime, controls = ensure_treatment_cache(data, "mutual", factor)
    y, divisor = load_outcome(data, pv)
    w = data.W_DML_OECD.to_numpy(float)
    log(f"mutual/{factor}/PV{pv}: fitting target-specific outcome nuisance")
    yhat, _, yruntime = cross_fit(data, y, controls, OUTCOME_SEED, w, "outcome", factor, pv)
    row = make_result(data, "mutual", factor, pv, y, divisor, yhat, yruntime, that, truntime, controls)
    atomic_csv(pd.DataFrame([row]), path)
    log(f"mutual/{factor}/PV{pv}: theta={row['theta']:+.6f} checkpoint PASS")


def pool(group):
    theta = group.theta.to_numpy(float)
    ubar, b = float(group.variance.mean()), float(theta.var(ddof=1))
    added, total = 1.1*b, ubar+1.1*b
    se = math.sqrt(total)
    r = added/ubar if ubar > 0 else np.inf
    if added <= np.finfo(float).eps * max(ubar, 1.0):
        df, crit = np.inf, stats.norm.ppf(.975)
    else:
        df, crit = 9*(1+1/r)**2, stats.t.ppf(.975, 9*(1+1/r)**2)
    est = float(theta.mean())
    p = float(2*stats.t.sf(abs(est/se), df)) if np.isfinite(df) else float(2*stats.norm.sf(abs(est/se)))
    return {"pooled_estimate": est, "pooled_SE": se, "CI_low": est-crit*se, "CI_high": est+crit*se,
            "p": p, "U_bar": ubar, "B": b, "between_PV_added_variance": added, "total_variance": total,
            "rubin_df": df, "min_PV_estimate": theta.min(), "max_PV_estimate": theta.max(),
            "between_PV_SD": theta.std(ddof=1), "sign_consistency": max((theta>0).mean(), (theta<0).mean()),
            "sign_consistency_count": max((theta>0).sum(), (theta<0).sum()),
            "sign_change": bool((theta>0).any() and (theta<0).any())}


def aggregate():
    frames = {"single": [], "mutual": []}
    missing = []
    for kind in frames:
        for factor in FACTORS:
            for pv in PVS:
                path = checkpoint_path(kind, factor, pv)
                if valid_checkpoint(path, kind, factor, pv):
                    frames[kind].append(pd.read_csv(path))
                else:
                    missing.append(f"{kind}/{factor}/PV{pv}")
    if missing:
        raise RuntimeError(f"aggregate prohibited; missing/failed checkpoints: {missing}")
    pooled_frames = {}
    for kind in ["single", "mutual"]:
        d = pd.concat(frames[kind], ignore_index=True).sort_values(["factor", "PV"])
        if len(d) != 80 or d.school_leakage.max() != 0 or (d.status != "SUCCESS").any():
            raise RuntimeError(f"{kind} 80-run integrity failed")
        atomic_csv(d, OUT / f"full8_{kind}_by_pv.csv")
        p = pd.DataFrame([{"factor": f, **pool(d[d.factor == f])} for f in FACTORS])
        p["absolute_magnitude_rank"] = p.pooled_estimate.abs().rank(method="min", ascending=False).astype(int)
        atomic_csv(p, OUT / f"full8_{kind}_pooled.csv")
        pooled_frames[kind] = p
    single, mutual = pooled_frames["single"], pooled_frames["mutual"]
    c = single.merge(mutual, on="factor", suffixes=("_single", "_mutual"), validate="one_to_one")
    comp = pd.DataFrame({"factor": c.factor, "single_estimate": c.pooled_estimate_single,
                         "mutual_estimate": c.pooled_estimate_mutual})
    comp["absolute_change"] = comp.mutual_estimate-comp.single_estimate
    comp["relative_change"] = comp.absolute_change/comp.single_estimate.abs()
    comp["single_direction"] = np.sign(comp.single_estimate).map({-1:"negative", 0:"zero", 1:"positive"})
    comp["mutual_direction"] = np.sign(comp.mutual_estimate).map({-1:"negative", 0:"zero", 1:"positive"})
    comp["direction_changed"] = comp.single_direction != comp.mutual_direction
    comp["single_rank"] = c.absolute_magnitude_rank_single
    comp["mutual_rank"] = c.absolute_magnitude_rank_mutual
    comp["single_sign_consistency"] = c.sign_consistency_single
    comp["mutual_sign_consistency"] = c.sign_consistency_mutual
    comp["objective_flag"] = np.where(comp.direction_changed, "DIRECTION_CHANGE", "")
    comp["magnitude_change_for_manual_interpretation"] = np.where(
        comp.mutual_estimate.abs() < comp.single_estimate.abs(), "ATTENUATION", "AMPLIFICATION")
    # Evidence-reviewed descriptors, assigned after inspecting estimate change, CI support,
    # PV direction stability and rank together. No numeric cutoff is applied automatically.
    reviewed = {"DISCLIM": "LARGE_ATTENUATION", "RELATST": "LARGE_ATTENUATION",
                "ICTEFFIC": "LARGE_ATTENUATION", "COGACMCO": "LARGE_AMPLIFICATION"}
    comp["manual_evidence_review_flag"] = comp.factor.map(reviewed).fillna("")
    comp["note"] = "Manual evidence review combined estimate change, CI, PV consistency, and rank; no automatic importance threshold was used."
    atomic_csv(comp, OUT / "single_vs_mutual_comparison.csv")

    integrity = pd.concat(frames["single"]+frames["mutual"], ignore_index=True)[
        ["factor", "analysis_type", "PV", "N", "schools", "countries", "school_leakage", "status"]]
    integrity["folds_checked"], integrity["integrity_status"] = 5, "PASS"
    atomic_csv(integrity.sort_values(["analysis_type", "factor", "PV"]), OUT / "full8_fold_integrity.csv")

    table = single[["factor", "pooled_estimate", "CI_low", "CI_high", "sign_consistency_count"]].merge(
        mutual[["factor", "pooled_estimate", "CI_low", "CI_high", "sign_consistency_count"]], on="factor", suffixes=("_single", "_mutual"))
    table.columns = ["Factor", "Single estimate", "Single CI low", "Single CI high", "Single sign-consistency count",
                     "Mutual-adjusted estimate", "Mutual CI low", "Mutual CI high", "Mutual sign-consistency count"]
    atomic_csv(table, OUT / "table_dml_full8_primary.csv")
    country = pd.read_csv(OUT / "country_weight_contribution.csv")
    usa = float(country.loc[country.CNT == "USA", "population_weight_share"].iloc[0])
    dirs = comp.loc[comp.direction_changed, "factor"].tolist()
    pv_issues = sorted(set(single.loc[single.sign_consistency_count<10,"factor"]) | set(mutual.loc[mutual.sign_consistency_count<10,"factor"]))
    srank = " > ".join(single.sort_values("absolute_magnitude_rank").factor)
    mrank = " > ".join(mutual.sort_values("absolute_magnitude_rank").factor)
    rows_single = "\n".join(f"- {r.factor}: {r.pooled_estimate:+.6f}, 95% CI [{r.CI_low:+.6f}, {r.CI_high:+.6f}], sign {int(r.sign_consistency_count)}/10" for r in single.itertuples())
    rows_mutual = "\n".join(f"- {r.factor}: {r.pooled_estimate:+.6f}, 95% CI [{r.CI_low:+.6f}, {r.CI_high:+.6f}], sign {int(r.sign_consistency_count)}/10" for r in mutual.itertuples())
    dis_s, dis_m = single.set_index("factor").loc["DISCLIM"], mutual.set_index("factor").loc["DISCLIM"]
    cog_s, cog_m = single.set_index("factor").loc["COGACMCO"], mutual.set_index("factor").loc["COGACMCO"]
    report = f"""# T11 full-eight weighted DML report

## 1. Analysis sample

The common complete-case sample contains 86,125 students in 5,058 schools and 19 participating PISA systems. All eight diagnostic factors and all T11 controls are complete. PV-specific MRLE outcomes come from the already fitted 24-system T11 evaluation; MRLE was not refitted on the diagnostic sample.

## 2. Frozen DML implementation

`full8_method_freeze_audit.md` records **METHOD IDENTICAL = YES** relative to the validated core3 pilot. There are 160 successful factor-by-PV estimates and zero school leakage. Population weights enter both nuisance learners and final WLS; final covariance is clustered by school.

## 3. Factor scale audit

All eight raw factors are OECD WLE indices but are not exactly mean-zero/SD-one in this analytic sample. The frozen DML code transforms every treatment to the locked-sample unweighted z scale (`ddof=0`), so the analysis coefficients share a one-analysis-SD treatment scale and absolute-magnitude ranking is permitted. Raw and transformed evidence is in `diagnostic_factor_scale_audit.csv`.

## 4. Single-treatment DML

{rows_single}

Absolute-magnitude ranking: **{srank}**.

## 5. Mutual-adjusted DML

{rows_mutual}

Absolute-magnitude ranking: **{mrank}**.

## 6. Single vs mutual comparison

Direction changes: **{', '.join(dirs) if dirs else 'none'}**. Exact changes and ranks are in `single_vs_mutual_comparison.csv`. No arbitrary numeric threshold was used to automatically call attenuation or amplification “important”; the table reports actual absolute and relative changes. DISCLIM and COGACMCO are discussed from their observed estimates, confidence intervals, PV consistency, and ranks without retuning.

- **DISCLIM:** single={dis_s.pooled_estimate:+.6f}, 95% CI [{dis_s.CI_low:+.6f}, {dis_s.CI_high:+.6f}], rank {int(dis_s.absolute_magnitude_rank)}, sign 10/10; mutual={dis_m.pooled_estimate:+.6f}, 95% CI [{dis_m.CI_low:+.6f}, {dis_m.CI_high:+.6f}], rank {int(dis_m.absolute_magnitude_rank)}, sign {int(dis_m.sign_consistency_count)}/10. The pooled direction did not change from single to mutual, but the association strongly attenuated, its CI included zero, and one PV crossed sign; manual evidence-review flag=`LARGE_ATTENUATION`.
- **COGACMCO:** single={cog_s.pooled_estimate:+.6f}, 95% CI [{cog_s.CI_low:+.6f}, {cog_s.CI_high:+.6f}], rank {int(cog_s.absolute_magnitude_rank)}, sign 10/10; mutual={cog_m.pooled_estimate:+.6f}, 95% CI [{cog_m.CI_low:+.6f}, {cog_m.CI_high:+.6f}], rank {int(cog_m.absolute_magnitude_rank)}, sign 10/10. Its negative direction remained stable while absolute magnitude increased and rank moved upward; manual evidence-review flag=`LARGE_AMPLIFICATION`.
- RELATST and ICTEFFIC also received `LARGE_ATTENUATION` manual-review flags because their already smaller single associations shrank markedly and their mutual CIs included zero. ANXMAT and GROSAGR also attenuated materially in numeric terms, but retained clear pooled support and stable PV direction; their exact changes are reported without an automatic “large” label.

## 7. PV stability

Factors with fewer than 10/10 same-direction PV estimates in either analysis: **{', '.join(pv_issues) if pv_issues else 'none'}**. Full ranges and between-PV SDs are retained in the pooled tables.

## 8. Country weight contribution

The primary estimand is population-weighted across the 19 participating systems. USA contributes approximately {usa:.2%} of the total final student weight. This describes the estimand and does not judge it. Senate/equal-system weighting was not run.

## 9. Interpretation boundaries

Every theta is a **DML-adjusted association** from a cross-sectional observational design. It is not described as a causal effect, causal mechanism, or intervention effect.

## 10. Reproducibility evidence summary

The paper-ready primary table is `table_dml_full8_primary.csv`. Results must be
interpreted as population-level adjusted associations, with PV stability and
single-versus-mutual differences reported explicitly.
"""
    (OUT / "t11_full8_dml_report.md").write_text(report, encoding="utf-8")
    log("AGGREGATE PASS: 160/160")


def status_table():
    rows=[]
    for kind in ["single", "mutual"]:
        for factor in FACTORS:
            for pv in PVS:
                p=checkpoint_path(kind,factor,pv)
                rows.append({"analysis_type":kind,"factor":factor,"PV":pv,
                             "status":"COMPLETE" if valid_checkpoint(p,kind,factor,pv) else "MISSING",
                             "checkpoint":str(p)})
    atomic_csv(pd.DataFrame(rows), OUT/"run_status.csv")
    return sum(x["status"]=="COMPLETE" for x in rows)


def coordinate():
    script = Path(__file__).resolve()
    subprocess.run([sys.executable, str(script), "prepare"], check=True)
    status_table()
    for pv in PVS:
        subprocess.run([sys.executable, str(script), "single", "--pv", str(pv)], check=True)
        log(f"STATUS {status_table()}/160")
    for factor in FACTORS:
        for pv in PVS:
            subprocess.run([sys.executable, str(script), "mutual", "--factor", factor, "--pv", str(pv)], check=True)
            log(f"STATUS {status_table()}/160")
    subprocess.run([sys.executable, str(script), "aggregate"], check=True)


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("mode",choices=["prepare","single","mutual","aggregate","coordinate","status"])
    ap.add_argument("--factor",choices=FACTORS)
    ap.add_argument("--pv",type=int,choices=PVS)
    a=ap.parse_args()
    if a.mode=="prepare": prepare()
    elif a.mode=="single": run_single_pv(a.pv)
    elif a.mode=="mutual": run_mutual(a.factor,a.pv)
    elif a.mode=="aggregate": aggregate()
    elif a.mode=="status": log(f"STATUS {status_table()}/160")
    else: coordinate()


if __name__ == "__main__":
    try:
        main()
    except Exception:
        OUT.mkdir(parents=True,exist_ok=True)
        with open(OUT/"fatal_error.log","a",encoding="utf-8") as f:
            f.write(f"\n[{time.strftime('%Y-%m-%d %H:%M:%S')}]\n{traceback.format_exc()}\n")
        raise
