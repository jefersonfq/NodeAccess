Base prompt for Claude Code on NodeAccess.

Minimal context order:
1. Read `ai/context.md`
2. Read `ai/patterns.md`
3. Read `docs/PRD-lite.md` only when product rules matter
4. Read only the relevant file in `ai/modules/*`
5. For terminal work, read `ai/terminal/overview.md`; open `ai/terminal/adapters.md` only if the task affects integration or scaling
6. Read `docs/PRD.txt` only for detailed business rules

Instructions:
- keep context lean and task-specific
- inspect only directly affected code before editing
- preserve the monorepo architecture and naming
- prefer small, testable changes
- reference files instead of pasting long code blocks
- for bugs, classify the issue first: frontend, API, gateway, or shared

Expected output:
- implement or update with the smallest useful context
- summarize changes briefly
- state missing validation or test coverage if any
