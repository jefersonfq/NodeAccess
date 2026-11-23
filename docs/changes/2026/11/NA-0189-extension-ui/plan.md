---
change_id: NA-0189
title: Visual do popup da extensão VaultNAccess e plano de evolução
type: feature
status: ready-for-review
created_at: 2026-11-23T09:05:00-03:00
base_branch: master
base_sha: 660b080966541814f3d2894e2cf4d0fe62d019f5
branch: feature/NA-0189-20261123-extension-ui
owner: Jeferson Quintana
planner: Claude Code
risk: low
issue: null
---

# NA-0189 — Visual do popup da extensão VaultNAccess e plano de evolução

## Contexto e situação anterior

A E1 (NA-0183) entregou a extensão funcional: conectar pelo portal, buscar itens (só metadados), abrir no portal, recentes, desconectar. O responsável conseguiu usá-la em 2026-11-23 e pediu "uma estilizada" e o plano de evolução. O popup atual é HTML quase sem estilo (fundo branco, azul genérico, `select` nativo, sem ícones, sem identidade do portal, sem tema escuro).

## Problema e objetivo

1. Popup com a identidade visual do NodeAccess (paleta do portal: verde `#63e2b7` no escuro / `#18a058` no claro, superfícies e bordas do tema Naive), tema claro/escuro pelo sistema, hierarquia clara e estados (desconectado, aguardando confirmação, conectado, buscando, vazio, erro).
2. Plano de evolução da extensão (`evolution.md`), revisando as fatias E2–E7 da NA-0182 com o estado atual e a ordem proposta.

## Escopo

- `apps/extension/src/popup/App.vue` (marcação e CSS), `messages.ts` (textos novos pt-BR/en), ícones SVG locais sem dependência nova.
- Sem mudança de lógica de conexão, armazenamento, permissões do manifesto, CSP ou contratos. `data-testid` e textos usados pelos testes preservados.
- Filtro de tipo como grupo de botões (Todos/Secret/Chave PEM), com `aria-pressed`; busca com ícone; resultados com ícone por tipo, nome, descrição (uma linha), etiquetas de tipo e escopo; recentes como lista compacta; carregando com esqueleto; rodapé com a garantia "nenhum valor secreto vem para a extensão"; impressão digital do dispositivo destacada em fonte monoespaçada.
- Teste de fumaça (`test:extension:web`) passa a salvar capturas claro/escuro dos estados para revisão.

Fora: novas funções (E2+), ícones PNG do manifesto (entram na E6 de distribuição), atalho genérico para o portal (o `portalUrl` aceita só caminhos de item, por segurança).

## Critérios de aceitação

- [x] Popup segue a paleta do portal, com tema claro e escuro conforme o sistema.
- [x] Todos os estados têm aparência própria e legível; foco visível por teclado; contraste AA nos textos.
- [x] Testes unitários do popup e `test:extension:web` passam sem mudar a lógica; capturas revisadas sem corte nem rolagem horizontal em 360 px.
- [x] `evolution.md` com fatias, dependências, critérios de segurança e ordem recomendada.

## Estratégia técnica

Só marcação e CSS do popup (`App.vue`), um componente de ícones SVG local e textos novos; variáveis CSS com a paleta do tema Naive do portal e `prefers-color-scheme`; `data-testid` e textos usados pelos testes preservados; o teste de fumaça passa a salvar capturas para revisão visual.

## Riscos e mitigações

Baixo: só visual. CSP `script-src 'self'` mantida (CSS empacotado pelo Vite, SVG inline sem script).

## Matriz de testes e evidências

vitest `apps/extension`; `typecheck:extension`; `lint`; `build:extension`; `test:extension:web` com capturas; `validate:sonar` depende dos tokens do responsável.

## Baseline

2026-11-23, `518e88aa5` (branch refeita depois sobre `660b08096`, sem mudar o resultado): vitest `apps/extension` 27 PASS; `typecheck:extension` PASS; `test:extension:web` PASS.

## Rollback ou recuperação

Revert da PR; recompilar a extensão.

## Aprovação

Decisão: `GO` — pedido do responsável em 2026-11-23 ("Pode dar uma estilizada nela e traçar o plano de evolução?"). Risco baixo, sem lógica nova.
