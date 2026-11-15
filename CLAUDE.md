# NodeAccess

Fonte única de regras compartilhada com o Codex (não duplicar aqui):

@AGENTS.md

## Específico do Claude Code

- Uma sessão por assunto/Change ID; ao trocar de assunto use `/clear` e retome por `plan.md` + resumo do `implementation.md`.
- Permissões do projeto em `.claude/settings.json` (espelham `/root/.codex/rules/default.rules`): leitura e testes liberados; `git push`, `gh pr merge` e `rm -rf` sempre perguntam.
- Skill de lifecycle: `.claude/skills/nodeaccess-change-lifecycle` (link para `codex/skills/…`, mesma fonte do Codex).
- Subagentes só para buscas amplas ou validação independente; não delegar o que cabe em poucas leituras.
- Reversão: `ai/backup/codex-config-2026-11-08/ROLLBACK.md`.

# Compact instructions

Preservar: arquivos alterados, erros, decisões de arquitetura, Change ID e próximo passo. Descartar: código colado e saídas longas de ferramentas.
