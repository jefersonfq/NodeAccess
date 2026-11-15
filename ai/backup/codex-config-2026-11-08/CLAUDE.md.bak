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

#Compact instructions
Preserve: arquivos alterados, erros, decisões de arquitetura. Descarte: código colado e saídas de ferramentas longas.

## Registro das implementações assistidas por IA

A partir de NA-0055, manter `implementation.md` junto ao `plan.md` da frente.
Antes de encerrar cada interação relevante, registrar data/hora com timezone,
pedido/decisão, o que foi feito, arquivos/fluxos afetados, validações realmente
executadas, limitações e próximo passo. Perguntas que mudem decisões também entram.
Atualizar o resumo em vez de copiar transcrições; não incluir segredos, dados
pessoais ou saída de terminal do usuário. Não inventar testes, aprovação ou métricas.
Usar o template `codex/skills/nodeaccess-change-lifecycle/assets/implementation.template.md`.
Registrar SHA base no documento; SHA final/merge e checks ficam no PR/tag/evidência,
para não criar commits recursivos só para registrar o próprio hash.
O CI valida presença e estrutura; a IA é responsável pelo conteúdo e veracidade.
Consultar `docs/DEVELOPMENT-recovery.md` para checkpoints e recuperação. Nenhuma
instrução autoriza commit/publicação fora do escopo já autorizado pelo usuário.
