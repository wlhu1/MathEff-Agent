# Data access

Raw PISA 2022 data are not redistributed in this repository.
Users should obtain the public-use files directly from the OECD PISA data portal and use the variable mapping provided in this repository.

The analysis scripts expect user-created local inputs under ignored `data/` or
`inputs/` directories, or paths supplied through the documented environment
variables. No student-level records, identifiers, survey-weight files, or
derived student-level outputs are committed here.

The final MRLE analysis requires a complete T11 model input with the ten
mathematics plausible values, T11 reference conditions, school identifiers,
system codes, and `W_FSTUWT`. The DML analysis additionally requires the eight
focal factors. The targeted Fay-BRR sensitivity requires the 80 public-use
replicate-weight columns `W_FSTURWT1` through `W_FSTURWT80`.
