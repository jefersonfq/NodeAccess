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

## Merge and closure

Never merge based only on local success. Verify required GitHub checks/reviews apply to the current head SHA. Record human homologation separately from technical validation.

After merge, document PR, merge SHA, deployment/release relationship when applicable, actual before/after, residual risks, follow-ups, and whether the topic branch can be deleted.
