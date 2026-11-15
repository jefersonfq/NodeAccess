# Commit, PR and completion

Moved verbatim from SKILL.md on 2026-11-08 to reduce always-loaded context.

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
8. Run `npm run status:change -- --branch <branch> --base <base_sha from plan>` and report its delivery states. When GitHub cannot be queried, classify `PR_OPEN` as `Manual` instead of guessing.

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

Close a topic through exactly one explicit outcome:

- **Delivered:** the PR is merged into `origin/master`, local `master` is synchronized, and both `MERGED` and `MASTER_SYNCED` are complete.
- **Abandoned:** the user explicitly abandons it. Preserve its branch and worktree until separately authorized cleanup.

Before starting another topic, report any previous topic that is neither delivered nor abandoned as pending, including its exact next gate.

In final responses classify every check as `Ran`, `Skipped`, `Planned`, or `Manual`. Lead with the six delivery states, visibility in the user's current workspace, gate result, exact branch/SHA/plan, evidence, remaining blockers, and next authorized action.
