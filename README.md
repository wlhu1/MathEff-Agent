# MathEff-Agent

Reproducibility materials for:

A public reproducibility package for mathematics-learning efficiency analysis and evidence-governed decision support.
This repository provides a minimal, public-facing reproducibility release:

- core T11 MRLE construction code for all ten mathematics plausible values;
- the final full-eight DML implementation and registered hyperparameters;
- zero-reference profile classification, PV stability, and threshold sensitivity;
- targeted Fay-BRR sensitivity for the final orthogonal score;
- the final PISA variable mapping and system/sample summary; and
- the core MathEff-Agent evidence-governance implementation.

This repository contains a minimal reproducibility release accompanying the
publication. It does not contain the complete internal research workspace,
exploratory analyses, visualization scripts, historical analyses, or raw PISA
data.

## Repository map

- `analysis/01_construct_mrle.R`: final T11 weighted multilevel MRLE construction.
- `analysis/02_dml_analysis.py`: common-sample single-factor and mutually adjusted DML.
- `analysis/03_profile_sensitivity.py`: zero reference, three boundary buffers, and ten-PV profile stability.
- `analysis/04_fay_brr.py`: targeted final-score Fay-BRR sensitivity.
- `analysis/dml_config.yaml`: registered DML configuration.
- `metadata/`: final variable mapping and published system/sample composition.
- `matheff_agent/`: minimal Agent orchestration, evidence tools, safeguards, reports, ledger, and synthetic demonstrations.
- `docs/data_access.md`: data-access and non-redistribution statement.

## Method boundaries

The primary DML estimands are population-level adjusted associations, not
causal or individual intervention effects. All ten plausible values are
estimated separately and then pooled. Cross-fitting uses five system-stratified,
school-grouped folds with seed 2026, and requires zero school leakage.

The Fay-BRR code is a **targeted final orthogonal-score reweighting sensitivity**
using 80 replicate weights and Fay coefficient 0.5. The upstream MRLE and
cross-fitted nuisance functions are held fixed. It is not full-pipeline
replicate-weight propagation.

Synthetic cases are provided for system demonstration only and are not
validation evidence. They contain no real student records.

## Data and execution

PISA 2022 public-use data must be obtained directly from OECD. See
`docs/data_access.md` and `metadata/variable_mapping.csv` before running the
scripts. Python dependencies are listed in `requirements.txt`; MRLE construction
uses R packages `arrow`, `data.table`, `WeMix`, and `lme4`.

Full MRLE and DML execution is intentionally not possible without locally
prepared PISA inputs. No artificial data are supplied to simulate a complete
analysis run.

## Agent

The production research demonstrator is available at
https://matheff-agent.pages.dev. The public code subset can be type-checked and
tested locally without contacting an external language-model provider; see
`matheff_agent/README_AGENT.md`.

## Rights

No permissive open-source license is granted at this pre-publication stage. See
`COPYRIGHT_NOTICE.md`.


