# MathEff-Agent core

This directory is the minimal evidence-governance subset used by the final
MathEff-Agent implementation. It excludes the web interface, deployment
configuration, Cloudflare Functions, screenshots, build products, and local
configuration.

Included modules cover:

- orchestration and conversation policy;
- deterministic evidence routing and the 12-tool allowlist;
- claim-evidence validation and language safeguards;
- scope, sufficiency, and uncertainty checks;
- structured `EvidenceReport` and `EvidenceLedger` generation;
- frozen aggregate evidence with integrity checks; and
- three explicitly synthetic demonstration cases.

Synthetic cases are provided for system demonstration only and are not
validation evidence. They contain no names, contact details, school identifiers,
or real student records.

## Local validation

From this directory, use Node.js 20 or later:

```bash
npm install
npm run typecheck
npm test
```

These checks are offline and do not contact DeepSeek or any other external
language-model service. No credential is needed. The provider adapter is
included only to show the interface used by the orchestrator; runtime
configuration remains outside this repository.

The aggregate JSON evidence is included because it is required by the
deterministic evidence tools. It contains no student-level rows.
