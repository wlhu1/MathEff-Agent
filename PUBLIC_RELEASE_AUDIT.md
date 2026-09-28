# Public release audit

Release type: **public reproducibility package**
Repository: **MathEff-Agent**

Audit date: **2026-09-06**

## 1. Files included

- Four final analysis entry points: T11 MRLE, full-eight DML, profile/PV
  sensitivity, and targeted Fay-BRR.
- One registered DML configuration.
- Final Supplementary Table S2 variable roles recast into four public-facing
  columns without adding student-level information.
- Final Supplementary Table S1 system/sample composition (24 MRLE systems; 19
  DML systems).
- The minimum current Agent dependency closure: orchestration, routing,
  validators, safeguards, reports, ledger, uncertainty/scope logic, 12
  deterministic tools, aggregate evidence schemas, and synthetic cases.
- Documentation, copyright notice, dependency manifests, and offline checks.

The public scripts are release extractions of these frozen source files:

- MRLE source SHA-256: `6931DC188788DA393D3845E87F6B6C18AC59E894542BFD44C541F555818647F1`.
- DML source SHA-256: `A9E33719DC070BBF3691C059273517CDD4094EE35F656ECCB0B2983899FC9B5D`.
- Profile source SHA-256: `194A67D6C7ADC0019671FD437B9D4B1AB23F104B5C348771369B513881077910`.
- Fay-BRR source SHA-256: `510E43BA556801341E66DF9340614ED24C1001AEDD6BDB827E7C44C7F3783047`.

Only workstation paths, obsolete comparison branches, reporting-only code,
student-level output exports not needed for the public analysis, and figure-data
exports were removed. The statistical definitions and registered parameters
retained in the public entry points match the public-release analyses.

## 2. Files deliberately excluded

- Raw and derived student-level PISA records and survey-weight files.
- The complete internal research workspace and complete frozen-results store.
- Exploratory notebooks, model searches, temporary diagnostics, and logs.
- Superseded samples, reference sets, robustness analyses, and old Agent/UI code.
- All plotting, image-processing, layout, slide, and visualization scripts.
- Frontend CSS, deployment functions/configuration, screenshots, and build output.
- non-public project materials.
- Local configuration, credentials, cookies, certificates, and environment files.

## 3. Secret scan result

**PASS.** No credential-shaped value or known key prefix was found. The Agent
provider adapter necessarily names its runtime environment field and HTTP
authorization header, but contains no credential value. Generic credential
words in `.gitignore` and documentation are exclusion instructions only.

## 4. PII scan result

**PASS.** No email address, telephone number, private network address, account
name, personal address, real student name, real school name, or student record
was found. Variable names for public-use identifiers are schema fields only;
there are no identifier values.

## 5. Absolute-path scan result

**PASS.** No workstation or user-home absolute path was found. Analysis inputs
and outputs use relative defaults with optional environment-based configuration.
Web URLs are not filesystem paths.

## 6. Raw-data scan result

**PASS ? NOT INCLUDED.** No Parquet, SPSS, SAS, Stata, R data object, or other
raw/derived PISA data file is present. The ignore rules exclude local data and
generated outputs.

## 7. Historical/deprecated-analysis scan

**PASS ? NOT INCLUDED.** No superseded analysis script or result file is
present. The final public release excludes the old 31,623-student BRR analysis,
old heterogeneity and three-outcome checks, old cross-fitted MRLE validation,
pre-harmonization SFA, single-median-imputation variants, and old 12-system
work. The README's generic statement that historical work is excluded is
documentation, not an included analysis.

## 8. Agent secret scan

**PASS.** No API key, platform token, account credential, local environment
file, deployment configuration, or build artifact is present. No external LLM
was contacted during validation.

## 9. Synthetic-case verification

**PASS.** `SYNTHETIC_A_STABLE_CONCORDANT`,
`SYNTHETIC_B_STABLE_DISCORDANT`, and
`SYNTHETIC_C_BOUNDARY_UNSTABLE` are explicitly marked synthetic, not real
students, and not validation evidence. They contain no names, email addresses,
telephone numbers, student numbers, or real school identifiers.

## 10. Validation record

- Python syntax compilation: **PASS** for all three Python entry points.
- Python dependency import check: **PASS**.
- YAML configuration parse and registered-value assertions: **PASS**.
- Agent TypeScript type check: **PASS**.
- Agent offline tests: **4/4 PASS**, including the 12-tool allowlist, synthetic
  case marking, deterministic case/profile tools, and all evidence-manifest
  hashes.
- R parser: not run because `Rscript` is not installed on the release machine;
  the MRLE entry point was manually derived from the frozen R/WeMix source and
  retains the final T11 implementation.
- Full MRLE/DML/Fay-BRR execution: intentionally not run because raw PISA inputs
  are not redistributed or fabricated.

## 11. Final inventory

- Final repository file count: **57**.
- Total repository size: **188276 bytes** (Git working-tree files only; ignored
  dependency/build directories excluded).

## 12. Release decision

- Secret scan: **PASS**
- PII scan: **PASS**
- Raw PISA data: **NOT INCLUDED**
- API keys: **NOT INCLUDED**
- Environment files: **NOT INCLUDED**
- Visualization code: **NOT INCLUDED**
- Historical analysis: **NOT INCLUDED**
- Synthetic-case privacy: **PASS**

**Decision: APPROVED FOR A CLEAN, NEW PUBLIC GIT HISTORY.**


