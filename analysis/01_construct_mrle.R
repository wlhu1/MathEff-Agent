#!/usr/bin/env Rscript

# Public-release extraction of the frozen T11 MRLE implementation used in
# Public reproducibility release. Internal benchmark-comparison branches were
# deliberately removed; the model, weights, residual definition, and 10-PV
# loop are unchanged.

suppressPackageStartupMessages({
  library(arrow)
  library(data.table)
  library(WeMix)
  library(lme4)
})

input_path <- Sys.getenv("MATHEFF_T11_INPUT", "data/natural_t11.parquet")
output_dir <- Sys.getenv("MATHEFF_MRLE_OUTPUT", "outputs/t11_mrle")
dir.create(output_dir, recursive = TRUE, showWarnings = FALSE)

T11 <- c(
  "ST004D01T", "ST001D01T", "ST003D02T", "ST003D03T", "ESCS",
  "ICTRES", "ICTSCH", "ICTHOME", "ICTQUAL", "EXPOFA", "EXPO21ST"
)
PVS <- 1:10

weighted_moments <- function(x, w) {
  mu <- sum(w * x) / sum(w)
  sd_population <- sqrt(sum(w * (x - mu)^2) / sum(w))
  list(mean = mu, sd = sd_population)
}

prepare_data <- function(path) {
  required <- unique(c(
    "GLOBAL_STUDENT_ID", "CNT", "CNTSCHID", "CNTSTUID",
    "GLOBAL_SCHOOL_ID", "W_FSTUWT", paste0("PV", PVS, "MATH"), T11
  ))
  dt <- as.data.table(read_parquet(path, col_select = required))
  stopifnot(all(required %in% names(dt)), !anyNA(dt[, ..required]))
  stopifnot(!anyDuplicated(paste(dt$CNT, dt$CNTSCHID, dt$CNTSTUID, sep = "|")))

  factor_vars <- c("ST004D01T", "ST001D01T", "ST003D02T", "ST003D03T")
  dt[, (factor_vars) := lapply(.SD, factor), .SDcols = factor_vars]
  dt[, CNT := factor(CNT)]
  dt[, GLOBAL_SCHOOL_ID := factor(GLOBAL_SCHOOL_ID)]
  dt[, `:=`(
    SCHOOL_SAMPLE_N = .N,
    SCHOOL_WEIGHT_SUM_OECD = sum(W_FSTUWT)
  ), by = GLOBAL_SCHOOL_ID]
  dt[, W_LEVEL1_OECD := W_FSTUWT * SCHOOL_SAMPLE_N / SCHOOL_WEIGHT_SUM_OECD]
  dt[, W_LEVEL2_OECD := SCHOOL_WEIGHT_SUM_OECD]

  check <- dt[, .(
    n = .N,
    sum_level1 = sum(W_LEVEL1_OECD),
    unique_level2 = uniqueN(W_LEVEL2_OECD)
  ), by = GLOBAL_SCHOOL_ID]
  stopifnot(max(abs(check$sum_level1 - check$n)) < 1e-8)
  stopifnot(all(check$unique_level2 == 1L))
  dt
}

model_formula <- function(pv) {
  rhs <- paste(c(T11, "factor(CNT)", "(1 | GLOBAL_SCHOOL_ID)"), collapse = " + ")
  as.formula(paste0("PV", pv, "MATH ~ ", rhs))
}

fit_one_pv <- function(dt, pv) {
  outcome <- paste0("PV", pv, "MATH")
  warnings_seen <- character()
  started <- Sys.time()
  fit <- withCallingHandlers(
    WeMix::mix(
      model_formula(pv), data = dt,
      weights = c("W_LEVEL1_OECD", "W_LEVEL2_OECD"),
      cWeights = TRUE, verbose = FALSE
    ),
    warning = function(w) {
      warnings_seen <<- c(warnings_seen, conditionMessage(w))
      invokeRestart("muffleWarning")
    }
  )

  fixed_formula <- lme4::nobars(model_formula(pv))
  design <- model.matrix(delete.response(terms(fixed_formula, data = dt)), data = dt)
  stopifnot(identical(colnames(design), names(fit$coef)))
  fixed_prediction <- as.numeric(design %*% fit$coef)
  random_table <- as.data.table(
    fit$ranefMat$GLOBAL_SCHOOL_ID,
    keep.rownames = "GLOBAL_SCHOOL_ID"
  )
  setnames(random_table, "(Intercept)", "school_random_effect")
  school_effect <- random_table$school_random_effect[
    match(as.character(dt$GLOBAL_SCHOOL_ID), random_table$GLOBAL_SCHOOL_ID)
  ]
  stopifnot(!anyNA(school_effect))

  conditional_prediction <- fixed_prediction + school_effect
  residual <- dt[[outcome]] - conditional_prediction
  residual_moments <- weighted_moments(residual, dt$W_FSTUWT)
  mrle_z <- (residual - residual_moments$mean) / residual_moments$sd

  score_reference <- dt[, {
    moments <- weighted_moments(get(outcome), W_FSTUWT)
    .(score_mean = moments$mean, score_sd = moments$sd)
  }, by = CNT]
  score_z <- (
    dt[[outcome]] - score_reference$score_mean[match(dt$CNT, score_reference$CNT)]
  ) / score_reference$score_sd[match(dt$CNT, score_reference$CNT)]

  student <- data.table(
    GLOBAL_STUDENT_ID = as.character(dt$GLOBAL_STUDENT_ID),
    CNT = as.character(dt$CNT),
    CNTSCHID = as.integer(dt$CNTSCHID),
    CNTSTUID = as.integer(dt$CNTSTUID),
    GLOBAL_SCHOOL_ID = as.character(dt$GLOBAL_SCHOOL_ID),
    W_FSTUWT = dt$W_FSTUWT,
    pv = pv,
    math_pv = dt[[outcome]],
    conditional_prediction = conditional_prediction,
    mrle_raw = residual,
    mrle_weighted_z = mrle_z,
    score_within_country_weighted_z = score_z
  )
  write_parquet(student, file.path(output_dir, sprintf("pv%02d_student.parquet", pv)))

  between <- unname(fit$vars[grepl("GLOBAL_SCHOOL_ID", names(fit$vars))][1])
  within <- unname(fit$vars[names(fit$vars) == "Residual"][1])
  diagnostics <- data.table(
    specification = "T11",
    pv = pv,
    outcome = outcome,
    students = nrow(dt),
    schools = uniqueN(dt$GLOBAL_SCHOOL_ID),
    systems = uniqueN(dt$CNT),
    convergence = all(is.finite(c(fit$coef, fit$SE, fit$vars, residual))) &&
      all(c(between, within) > 0),
    residual_weighted_mean = residual_moments$mean,
    residual_weighted_population_sd = residual_moments$sd,
    elapsed_seconds = as.numeric(difftime(Sys.time(), started, units = "secs")),
    warnings = paste(unique(warnings_seen), collapse = " | ")
  )
  fwrite(diagnostics, file.path(output_dir, sprintf("pv%02d_diagnostics.csv", pv)))
}

data <- prepare_data(input_path)
for (pv in PVS) {
  fit_one_pv(data, pv)
  message(sprintf("Completed T11 MRLE for PV%02d", pv))
}

