---
name: nodeaccess-change-lifecycle
description: Govern a NodeAccess change from request through plan, isolated branch or worktree, scoped implementation, independent harness validation, traceable commits, pull request, human homologation, merge, and closure. Use when starting, resuming, testing, preparing, publishing, reviewing, or closing a feature, fix, security, performance, refactor, migration, release, or documentation front that must link a Change ID, dated plan, branch, commits, latest tested SHA, evidence, and PR.
---

# NodeAccess Change Lifecycle

Make every change traceable from problem to plan, code, tests, evidence, homologation, and merge.

Use one orchestration entry point with four independent roles. Do not let the implementer approve its own work. Use the smallest applicable test set, but never omit a relevant safety gate.

## Mandatory routing

Read only the references needed for the current state:

- Starting, resuming, transitioning, or closing a change: read [lifecycle-and-gates.md](references/lifecycle-and-gates.md).
- Planning, implementing, independently validating, or publishing: read [roles.md](references/roles.md).
- Naming branches/commits or preparing a PR: read [git-and-pr.md](references/git-and-pr.md).
- Selecting/running tests and recording evidence: read [validation-and-evidence.md](references/validation-and-evidence.md).

Use bundled assets as source templates; copy and adapt them into the project only when starting/configuring a lifecycle:

- [change-plan.template.md](assets/change-plan.template.md)
- [test-results.template.md](assets/test-results.template.md)
- [pull-request.template.md](assets/pull-request.template.md)

## Core invariants

- One branch represents exactly one Change ID and one approved plan.
- A plan is versioned with the code and contains testable acceptance criteria.
- No application edit begins before plan approval, branch verification, and baseline.
- Every diff line is classified as planned, necessary correction, related proposal, or out of scope.
- Related ideas become backlog/another Change ID unless explicitly added and reapproved.
- The implementer may report completion but never approve it.
- The validator attempts to disprove correctness and compares the plan with the diff.
- Harness evidence must identify the exact tested commit SHA.
- Any new commit invalidates prior approval/harness evidence until required checks rerun.
- Human functional homologation is never inferred from automated tests.
- A branch may be left locally; it may not be reused, merged, or closed as complete while gates remain open.
- Do not create a commit merely because an implementation increment, test suite, or lifecycle state finished.
- Keep the current topic uncommitted while the user continues the same subject, unless the user explicitly asks to commit or has authorized publishing/updating GitHub.
- Before switching to a genuinely different subject, summarize the current front and ask whether to commit when commit/publish authority has not already been granted. Never silently commit incomplete or failing work.
- Never merge or push directly to the protected default branch.
- Never use `--no-verify`, force-push the default branch, disable tests to pass, or hide scope changes.

## Change identity

Prefer an existing issue-backed ID. Format NodeAccess IDs as `NA-<number>` with stable zero-padding when the project uses it. If no issue exists, inspect existing `docs/changes` and reserve a collision-free ID before creating artifacts; record the future issue link when available.

Use the ID in plan path, branch, commit subject, PR title/body, evidence summary, homologation, and final report.

Store plan documents under:

```text
docs/changes/YYYY/MM/<CHANGE-ID>-<keywords>/
```

Do not create six mostly empty documents mechanically. Start with `plan.md`; add test results, homologation, or final report only when they contain durable information. Keep large logs, screenshots, recordings, and machine reports in CI artifacts with retention appropriate to their sensitivity.

## Start workflow

1. Inspect current branch, status, remotes, project instructions, relevant code/docs/tests/harnesses, and existing changes.
2. Refuse to mix unrelated dirty changes. Preserve them and use a separate `git worktree` when practical.
3. Assign Change ID, type, concise keywords, ISO 8601 `created_at` with timezone, risk, and owner.
4. Create the isolated branch/worktree from the agreed and updated base branch.
5. Create `plan.md` from the asset with status `draft`; document before, problem, objective, scope/out-of-scope, acceptance, approach, risks, applicable tests, rollback, and evidence.
6. Review plan feasibility and produce `GO`, `GO_WITH_RISKS`, or `NO_GO`.
7. Require explicit plan approval for material changes. Set `planned` and record the plan path; do not commit the plan separately unless the commit policy below authorizes it.
8. Run and record the relevant baseline before application edits; set `ready-for-development` only when the baseline is understood.

Do not create a branch from stale or unknown base state. Fetching, rebasing, pushing, creating issues/PRs, or changing GitHub settings requires user authority when not already granted.

## Implementation workflow

1. Verify Change ID, plan, status, branch/worktree, clean ownership boundaries, and baseline.
2. Set `in-development` and implement small coherent increments.
3. Add/update tests with behavior. Do not weaken assertions, snapshots, coverage, or mocks without recorded justification.
4. Record material decisions and scope classifications in the plan.
5. Validate incrementally; do not wait until the end for basic checks.
6. Compare actual diff with scope and acceptance criteria.
7. Mark `ready-for-tests` only when planned work is implemented, deviations are recorded, and local applicable checks pass.

Incremental validation is not an instruction to create incremental commits. Prefer one coherent commit at the end of the subject unless the user requests a different history or multiple commits are objectively required to separate independent intentions.

## Independent validation workflow

When subagents are available and validation is material, give an independent validator the approved plan, base/head SHAs, diff, relevant raw artifacts, and environment constraints—not the implementer's conclusion.

The validator must verify every criterion, inspect out-of-scope changes, exercise failure/invalid/permission/concurrency/migration/performance cases when applicable, and preserve evidence. It returns only `PASS`, `PASS_WITH_WARNINGS`, `FAIL`, or `BLOCKED`.

Use `FAIL → in-development`; use `BLOCKED` only when required evidence/environment/authority is unavailable. Never convert a failure into a warning merely to publish.

## Commit and PR gate

### Commit timing

Commit only when at least one condition is true:

- the user explicitly asks to commit, push, update GitHub, or prepare/open a PR;
- the user has already granted commit/publish authority for the current front and the front reached its agreed commit gate;
- the user starts a genuinely different subject and, after receiving a concise status of the current front, confirms the commit;
- a repository operation explicitly authorized by the user requires a commit, such as creating or updating a PR.

Do not treat acknowledgements such as "vamos em frente", successful tests, a lifecycle status change, a long-running conversation, context compaction, or the end of an assistant turn as commit authorization.

If the user changes subject while the current front is incomplete or failing, do not manufacture a clean completion. Report the state and offer commit-as-WIP, keep the branch open, or return to the front; commit only after the user chooses or prior authority clearly covers it.

Before committing/publishing:

1. Confirm staged content contains one intention and no secrets/generated junk.
2. Validate Conventional Commit subject, Change ID, keywords, plan trailer, ISO timestamp trailer, and tests/evidence trailer.
3. Never claim “improved” without a measured comparison; say “changed” or “now supports” otherwise.
4. Run the final required harness on the candidate/latest SHA.
5. Push the topic branch and open/update the PR using the template.
6. Attach CI artifact/run links, exact tested SHA, before/after, reason, risks, rollback, and plan.
7. Require latest-SHA checks, scope review, blocking conversation resolution, required review, and human homologation before merge.

Do not commit a generated test report after declaring its prior SHA tested. If durable documentation must change, commit it and rerun the required gates on the new SHA.

## GitHub enforcement recommendation

Recommend rulesets/branch protection for the default branch:

- require pull request and approvals;
- dismiss stale approvals after new commits;
- require conversation resolution;
- require branch up to date when appropriate;
- require uniquely named CI checks from the expected source;
- block force pushes and deletion;
- require CODEOWNERS for sensitive paths when ownership exists;
- optionally require signed commits;
- restrict bypass to explicit emergency roles with audit.

Automation enforces gates; the skill does not pretend repository settings were changed unless it actually changed and verified them with authorization.

## Completion

Complete only when applicable plan criteria, latest-SHA harness, scope review, required checks/reviews, human homologation, rollback, operational docs, and evidence are present. After merge, record merge PR/SHA, final outcome, residual risks, follow-ups, and branch cleanup policy.

In final responses classify every check as `Ran`, `Skipped`, `Planned`, or `Manual`. Lead with current state, gate result, exact branch/SHA/plan, evidence, remaining blockers, and next authorized action.
