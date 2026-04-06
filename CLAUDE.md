# NodeAccess

Load the smallest useful context first.

Read order:
1. `ai/context.md`
2. `ai/patterns.md`
3. `docs/PRD-lite.md` when product rules matter
4. Only the relevant file in `ai/modules/*` for the task
5. `ai/debug.md` only when debugging
6. `docs/PRD.txt` only for specific business rules

Rules:
- do not load the full PRD by default
- prefer `docs/PRD-lite.md` over `docs/PRD.txt`
- do not restate the whole product context in replies
- prefer file references over pasted code blocks
- for small tasks, inspect only directly affected files
