---
change_id: NA-0192
title: Extensão VaultNAccess E1.2 — busca enquanto digita, teclado, atalho e idioma do portal
type: feature
status: ready-for-review
created_at: 2026-11-23T13:10:00-03:00
base_branch: master
base_sha: 1bfae8fa5ad59fb8356d69b7a687eb036ba25987
branch: feature/NA-0192-20261123-extension-daily-use
owner: Jeferson Quintana
planner: Claude Code
risk: low
issue: null
---

# NA-0192 — Extensão E1.2: uso diário

## Contexto e situação anterior

Fatia E1.2 do plano de evolução (`docs/changes/2026/11/NA-0189-extension-ui/evolution.md`). Hoje a busca só roda com Enter ou ao trocar o tipo, não há navegação por teclado nem atalho para abrir o popup, e o idioma é fixo em pt-BR.

## Problema e objetivo

Tornar o uso diário mais rápido sem mudar segurança, permissões ou backend.

## Escopo

- Busca enquanto digita (espera de 300 ms; a resposta antiga nunca sobrescreve a nova).
- Teclado: `/` foca a busca; ↑/↓ escolhem o item da lista; Enter abre o item escolhido; Esc limpa a busca. Item ativo destacado e com foco real (leitor de tela).
- Atalho do navegador para abrir o popup: `commands._execute_action` com `Alt+Shift+V` (sem permissão nova; `Ctrl+Shift+V` já é "colar sem formatação" no Chrome). Mostrado no rodapé.
- Idioma: a página de conexão do portal devolve o idioma em uso (`lang=pt-BR|en`) junto com o código; a extensão guarda só esse código de idioma em `storage.session` e usa o idioma do navegador enquanto não houver conexão.
- Testes unitários, do portal e smoke da extensão.

Fora (frente própria): host ligado ao item — o portal só lista hosts de um Secret para quem pode gerenciá-lo e sem filtrar pela ACL de hosts do usuário; exige regra de acesso nova no backend.

## Critérios de aceitação

- [x] Digitar busca sozinho após uma pausa curta; respostas fora de ordem são descartadas.
- [x] `/`, ↑/↓, Enter e Esc funcionam como descrito, com foco visível.
- [x] `Alt+Shift+V` abre o popup; permissões e CSP do manifesto inalteradas.
- [x] A extensão usa o idioma do portal após conectar e o do navegador antes; só `pt-BR` ou `en` são aceitos.
- [x] Nada novo em `storage.local`/`sync`; `storage.session` guarda só a autorização e o código de idioma.

## Estratégia técnica

Popup (`App.vue`): `watch` da busca com temporizador; índice ativo e `ref`s dos botões; textos por idioma reativo. Cliente: lê `lang` do retorno da autorização (validado) e guarda via `SessionStore`. Portal (`ExtensionConnectView.vue`): inclui `lang` no retorno. Manifesto: `commands`.

## Riscos e mitigações

Baixo. O idioma é um código validado; não identifica o usuário. O atalho pode conflitar com outra extensão; o usuário troca em `chrome://extensions/shortcuts`.

## Matriz de testes e evidências

vitest `apps/extension` e testes do portal da página de conexão; `typecheck:extension`; `vue-tsc`; `lint:changed`; `test:extension:web` (teclado, busca ao digitar, idioma, capturas); `security:scan`; `validate:sonar` depende dos tokens do responsável.

## Baseline

2026-11-23, `1bfae8fa5`: vitest `apps/extension` + testes da página de conexão 58 PASS.

## Rollback ou recuperação

Revert da PR e recompilar a extensão.

## Aprovação

Decisão: `GO` — responsável aprovou a E1.2 de ponta a ponta em 2026-11-23.
