Tarefa: implementar ou ajustar feature de autenticacao.

Leia:
1. `ai/context.md`
2. `ai/patterns.md`
3. `docs/PRD-lite.md`
4. `ai/modules/auth.md`
5. arquivos afetados em `apps/backend/src`, `apps/frontend/src` e `packages/shared/src`

Regras-chave:
- TOTP e obrigatorio
- backend valida antes do frontend
- nao expor segredo, token ou hash
- diferenciar autenticacao de autorizacao

Entrega:
- mudanca pequena, segura e compativel com os fluxos atuais
- explicar impacto em login, sessao e permissao
- informar teste ou lacuna
