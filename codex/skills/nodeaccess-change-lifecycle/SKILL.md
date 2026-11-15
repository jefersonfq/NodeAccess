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
- Committing, publishing, merging or closing: read [commit-and-completion.md](references/commit-and-completion.md).

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
- Report `LOCAL_WIP`, `COMMITTED`, `PUSHED`, `PR_OPEN`, `MERGED`, and `MASTER_SYNCED` separately after every commit, push, PR, merge, or default-branch synchronization.
- Never use “sent”, “published”, or “complete” without naming the exact delivery state and any later pending gate.
- For sequential work, switch the main VS Code workspace to the topic branch so new files remain immediately visible. Use a separate worktree only for genuine concurrency or to preserve unrelated dirty work.
- Files in a separate worktree are visible only when that worktree is open; otherwise wait for merge and default-branch synchronization before expecting them in the main VS Code workspace.
- The default branch is `master`; verify that it tracks `origin/master` before creating or closing a topic.
- A topic is delivered only when both `MERGED` and `MASTER_SYNCED` are complete. `COMMITTED` or `PUSHED` never closes delivery.
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
2. Refuse to mix unrelated dirty changes. For sequential work, require a clean transition and switch the main workspace to the topic branch; use a separate `git worktree` only for concurrency or preservation of unrelated dirty work.
3. Assign Change ID, type, concise keywords, ISO 8601 `created_at` with timezone, risk, and owner.
4. Create the topic branch from the agreed and updated base branch and switch the main workspace to it. Create a separate worktree only when the exception above applies.
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

## Commit, PR and completion

Before any commit, push, PR, merge or closure, read [commit-and-completion.md](references/commit-and-completion.md). Summary: commit only with explicit user authority (acknowledgements, green tests or compaction are not authority); run the final harness on the latest SHA; report the six delivery states; close only as Delivered (`MERGED` + `MASTER_SYNCED`) or Abandoned; classify checks as `Ran`, `Skipped`, `Planned` or `Manual`.

## AI implementation journal (NA-0055 onward)

Maintain `implementation.md` beside the plan using `assets/implementation.template.md`.
Record every material user interaction, decision, action, actual checks, limitations
and recovery steps before ending a turn. No transcripts, credentials or invented results.
The journal is versioned with the implementation; the final SHA is attached to PR/checkpoint
and external evidence after commit. Update it during work, not with recursive evidence commits.
See `docs/DEVELOPMENT-recovery.md`; code checkpoints never imply safe database downgrade.
