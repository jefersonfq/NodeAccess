# Validation and Evidence

## Select proportional suites

Map every acceptance criterion and affected risk to a test. Run applicable checks, not a mechanical universal list:

- static formatting/lint and typecheck;
- build/package generation;
- unit/component tests;
- integration/API/database tests;
- E2E/browser tests;
- regression of adjacent critical paths;
- authorization, security, secret handling, and invalid inputs;
- migration status/rehearsal/rollback or forward-fix;
- concurrency/load/performance with baseline;
- deployment/HA/failure harnesses where affected.

Never run destructive or load tests in production without explicit authorization and safety criteria.

## Harness contract

The harness is a standardized executor and evidence producer. It must record:

- Change ID, branch, base SHA, tested head SHA;
- started/finished ISO timestamps and environment;
- suite status/count/failures/duration;
- commands/tool versions;
- acceptance-criterion mapping;
- resource, security, migration, and performance results when applicable;
- limitations, skipped/manual checks, cleanup, and artifact references.

Use statuses `passed`, `passed_with_warnings`, `failed`, or `blocked`. Classify individual checks `Ran`, `Skipped`, `Planned`, or `Manual`; planned checks are not evidence.

## Latest SHA rule

Evidence is valid only for the identified SHA. After any commit, rerun required checks. GitHub Actions artifacts should include the SHA in metadata/name. Do not commit generated evidence after testing and then claim the previous run validates the new documentation commit.

## Before and after

Capture previous behavior before implementation when reproducible. Report:

- before and limitation;
- implemented change;
- reason;
- after behavior;
- metric baseline/result/variance when asserting improvement;
- unchanged guarantees and residual risks;
- evidence links.

Do not invent percentages, coverage, latency, throughput, or reliability. If no metric exists, describe capability or correction factually.

## Artifacts and sensitive data

Store logs, machine reports, screenshots, recordings, and performance data as GitHub Actions artifacts when appropriate. Configure retention and access based on sensitivity. Redact credentials, tokens, host secrets, personal data, terminal input, and production identifiers before upload.

Artifacts disappear according to retention and workflow deletion. Keep durable decisions and concise summaries in versioned docs; keep bulky/raw evidence in CI.

## Gate output

Report result, tested SHA, plan path, suites, acceptance mapping, before/after, regressions, security/performance/migration effects, artifacts, warnings, limitations, and next state. Never hide a failing relevant suite behind an overall pass.
