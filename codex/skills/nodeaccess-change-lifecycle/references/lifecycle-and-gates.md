# Lifecycle and Gates

## States

| State | Owner | Exit gate |
|---|---|---|
| `draft` | Planner | Context and initial plan recorded |
| `planned` | Planner/human | Scope, acceptance, tests, risks, rollback approved |
| `ready-for-development` | Orchestrator | Correct branch/worktree and baseline recorded |
| `in-development` | Implementer | Planned implementation and local applicable checks complete |
| `ready-for-tests` | Orchestrator | Diff/plan alignment reviewed |
| `tests-failed` | Validator | Return to development with evidence |
| `tests-passed` | Validator | Latest candidate SHA passed applicable gates |
| `ready-for-review` | Git/PR role | Commits, PR, plan, and artifacts conform |
| `in-homologation` | Human/reviewers | Functional approval and required checks on latest SHA |
| `approved` | Orchestrator | Merge authorized by repository policy |
| `merged` | Git/PR role | Merge SHA and PR recorded |
| `closed` | Orchestrator | Final outcome, residual risks, follow-ups, cleanup recorded |
| `blocked` | Any gate | Missing authority, environment, decision, or external state identified |

Never skip a state silently. For small documentation-only changes, combine compatible gates but record why tests/states are not applicable.

## User-facing delivery states

Lifecycle states describe engineering gates. Always report these simpler delivery states as well:

| State | Meaning | Minimum evidence |
|---|---|---|
| `LOCAL_WIP` | The topic worktree has uncommitted changes | `git status --short` |
| `COMMITTED` | The topic branch has commits beyond its base | Local branch SHA |
| `PUSHED` | The remote topic branch matches the local SHA | Local and remote topic SHAs |
| `PR_OPEN` | A pull request exists for the topic branch | PR URL/API result; otherwise `Manual` |
| `MERGED` | The topic SHA is contained in the remote default branch | Ancestry check and merge SHA/PR |
| `MASTER_SYNCED` | The local default branch matches the remote default branch after merge | Local and remote default SHAs |

Never collapse these into a single “published” or “complete” status. A pushed branch without a PR or merge is not visible in the default branch.

## Scope classification

- `IN_PLAN`: implement.
- `NECESSARY_CORRECTION`: implement only when required for the planned outcome; document reason, impact, and tests.
- `RELATED_IMPROVEMENT`: propose a new plan/issue; do not implement automatically.
- `OUT_OF_SCOPE`: leave untouched and record only when useful.

If a necessary correction materially changes risk, architecture, schedule, authorization, or acceptance, return the plan to `draft` and reapprove.

## Resume audit

When resuming, inspect current branch, base/head, worktree, plan state, uncommitted/staged changes, open PR/checks, last tested SHA, and unresolved findings. Do not trust status text that conflicts with Git/CI evidence.

## Worktree isolation

Use a dedicated worktree when another front is dirty or concurrent work is expected:

```bash
git worktree add ../nodeaccess-NA-0123 \
  -b feature/NA-0123-20260803-session-recording \
  origin/main
```

Resolve exact target paths and branch names first. Do not remove worktrees or branches without confirming merged/abandoned status and recoverability.

VS Code shows files from the worktree it opened. If a topic uses another worktree, provide its exact path; the main workspace will show the change only after merge and default-branch synchronization. When original untracked files were copied into a worktree, preserve them until the merged copies and checksums are verified, then perform cleanup only with explicit authorization.

## Merge and closure

Never merge based only on local success. Verify required GitHub checks/reviews apply to the current head SHA. Record human homologation separately from technical validation.

After merge, document PR, merge SHA, deployment/release relationship when applicable, actual before/after, residual risks, follow-ups, and whether the topic branch can be deleted.
