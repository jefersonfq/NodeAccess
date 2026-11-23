# NA-0192 — Registro da implementação

Base: `1bfae8fa5` (ver `plan.md`). Branch: feature/NA-0192-20261123-extension-daily-use.

## Pedido e objetivo

Fatia E1.2 do plano de evolução da extensão, aprovada de ponta a ponta pelo responsável em 2026-11-23.

## Implementação

- Popup (`App.vue`): busca ao digitar (300 ms; respostas antigas descartadas pela geração); teclado (`/` busca, ↑/↓ itens com foco real e destaque, Enter abre, Esc limpa); textos no idioma do navegador até conectar e no do portal depois; placeholder "Buscar itens (/)".
- Cliente/sessão: `lang` devolvido pela página de conexão (só `pt-BR`/`en`) guardado em `storage.session` e apagado com a sessão.
- Portal (`ExtensionConnectView.vue`): devolve `lang` junto com o código ou a negação.
- Manifesto: `commands._execute_action` com `Alt+Shift+V` (sem permissão nova).
- Smoke: busca ao digitar, `/`, ↓ e Enter abrindo o item, idioma após conectar, atalho no manifesto (21 checks).
- Docs: manual `hosts.md` (atalhos e idioma), `OPERATIONS-vault-extension.md`, `evolution.md` (E1.2 entregue; host do item em frente própria). Encerramento da NA-0190.
- Decisão: host do item fica para frente própria (o portal só lista hosts de um Secret para quem pode gerenciá-lo, sem filtrar pela ACL de hosts do usuário).

## Validação

- Ran: vitest `apps/extension` 40 PASS; testes da página de conexão e do cofre no portal 95 PASS; `typecheck:extension`, `vue-tsc`, eslint, `lint:changed` PASS; `test:extension:web` 21 checks PASS (captura revisada); `manual:check-reviewed` PASS; `security:scan` PASS; cobertura local das linhas alteradas 81/83 = 97,6%.
- Skipped: `validate:sonar` local (tokens do responsável).

## Recuperação

Revert da PR e recompilar a extensão.

## Pendências

- Homologação: recarregar a extensão (botão **Atualizar** após `npm run dev`), conectar de novo para o idioma, usar `Alt+Shift+V`, `/`, ↑/↓, Enter e Esc.

## Diário de interações

### 2026-11-23T13:50:00-03:00 — Implementação

Implementação e validação acima.

### 2026-11-23T15:55:00-03:00 — Merge e encerramento

PR83 mergeada em `master` (`b8d99fd8e`, 2026-11-23) com todos os checks remotos verdes. `master` local sincronizado. Status `closed`. Segue: `validate:sonar` local (tokens do responsável). Encerramento registrado na branch da NA-0193.
