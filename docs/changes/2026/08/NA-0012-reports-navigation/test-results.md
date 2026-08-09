# Evidências de teste — NA-0012

- Plan: `docs/changes/2026/08/NA-0012-reports-navigation/plan.md`
- Branch: `feature/NA-0012-20260809-reports-navigation`
- Base SHA: `cde7070`
- Tested SHA: `LOCAL_WIP`
- Environment: Chromium/Playwright, frontend isolado em `127.0.0.1:5174`
- Result: `PASS`

## Resultado funcional

- Baseline: o submenu continha Visão geral, Sessões, Logs, Auditoria de sessões e Auditoria SFTP; todos possuíam card equivalente na tela Relatórios.
- Depois: o menu contém uma única entrada Relatórios.
- O clique navegou para `/admin/reports`.
- Os nove cards do catálogo permaneceram presentes.
- Na rota `/admin/reports/sessions`, Relatórios permaneceu selecionado.
- A tela foi exercitada em 1440×900 e 1024×768.

## Configurações e e-mail

- O menu passou a conter uma única entrada Configurações.
- Configuração de e-mail inicia recolhida e não consulta `/email-config` antes da expansão.
- Ao expandir, o formulário reutilizado carrega e mantém as ações de teste, gravação e remoção.
- `/admin/settings/email-config` redireciona para `/admin/settings?section=email` com o painel aberto.
- Configurações permanece selecionado no menu após o redirecionamento.

## Suítes

| Suíte | Estado | Resultado |
|---|---|---|
| Playwright de navegação | Ran | PASS |
| Playwright de configurações/e-mail | Ran | PASS |
| Typecheck frontend | Ran | PASS |
| `git diff --check` | Ran | PASS |

## Observação de ambiente

O Vite preexistente na porta 5173 servia um módulo anterior com `admin-reports-section`. A validação final usou uma instância limpa na porta 5174 criada a partir da branch atual. Reinicie o servidor antigo antes da homologação manual.
