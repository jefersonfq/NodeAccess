# Git and Pull Request Conventions

## Branch

Use:

```text
<type>/<CHANGE-ID>-<YYYYMMDD>-<keywords>
```

Allowed examples:

```text
feature/NA-0123-20260803-session-recording
fix/NA-0124-20260803-ssh-reconnect
security/NA-0125-20260803-token-validation
performance/NA-0126-20260803-host-list-cache
refactor/NA-0127-20260803-session-service
```

Use lowercase ASCII keywords and keep the branch readable. Put exact time/timezone in the plan, PR, and trailers instead of lengthening the branch unless organization policy explicitly requires `YYYYMMDDThhmm`.

## Commits

### When to commit

Keep edits, tests, and plan updates uncommitted while the conversation remains on the same subject. Internal milestones and passing checks do not authorize a commit.

Commit when the user explicitly requests it, authorizes GitHub/PR publication, or confirms consolidation before the conversation moves to a different subject. If publication authority was already granted for the front, the final validated commit may be created without asking again.

When a new unrelated request arrives and the current front has uncommitted work, first state its status and ask whether to commit unless prior authority already covers that action. Preserve incomplete work honestly; do not label a WIP or failing front as complete.

Use Conventional Commits plus Change ID:

```text
<type>(<scope>): <CHANGE-ID> <imperative description>
```

Examples:

```text
feat(session-recording): NA-0123 capture terminal events
test(session-recording): NA-0123 add interactive harness
fix(session-recording): NA-0123 redact no-echo input
docs(session-recording): NA-0123 record retention and rollback
```

Keep one intention per commit. Avoid `adjustments`, `updates`, `misc`, `changes`, `fixes`, or similar generic subjects.

Use a body and trailers when material:

```text
Why:
Interactive sessions could not be reconstructed.

Plan: docs/changes/2026/08/NA-0123-session-recording/plan.md
Change-Date: 2026-08-03T10:42:00-03:00
Tests: unit, integration, harness/interactive-session
Evidence: github-actions://run/<run-id>
```

Git already records author/committer timestamps. Do not duplicate date/time in every subject.

## Pull request

Title:

```text
<type>(<scope>): <CHANGE-ID> <keywords and outcome>
```

The body records opened timestamp/timezone, branch, plan, issue, before, implemented behavior, why, after, measured comparison, scope, tests, exact SHA, artifacts, risks, rollback, and homologation.

Use `Closes #123`, `Fixes #123`, or `Resolves #123` only when merge should close the issue. Do not fabricate an issue reference.

Say “improved” only with evidence. Otherwise say “changed”, “corrected”, or “now supports”.

## GitHub gates

Prefer a ruleset for the default branch with PR, approvals, stale-review dismissal, conversation resolution, required latest-SHA checks, force-push/deletion block, and CODEOWNERS for critical paths. Ensure required job names are unique across workflows to avoid ambiguous checks.

Rulesets and repository settings are external mutations. Inspect first and obtain authority before changing them.

Before configuring enforcement, verify current repository plan/visibility, existing rules, bypass actors, check names/sources, and the latest official GitHub documentation; ruleset capabilities vary by plan and repository type.
