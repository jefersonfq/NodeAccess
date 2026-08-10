---
change_id: NA-0012
title: Consolidar navegação de relatórios e configurações
type: feature
status: ready-for-tests
created_at: 2026-08-09T18:35:00-03:00
base_branch: process/NA-0011-20260807-git-delivery-alignment
base_sha: cde7070
branch: feature/NA-0012-20260809-reports-navigation
owner: codex
planner: codex
risk: low
issue: null
---

# NA-0012 — Navegação consolidada de relatórios e configurações

## Contexto e situação anterior

O menu lateral apresenta um grupo expansível de Relatórios com Visão geral, Sessões, Logs, Auditoria de sessões e Auditoria SFTP. A tela Visão geral já contém cards para esses mesmos destinos e outros relatórios, duplicando escolhas e deixando parte do catálogo escondida em outra camada.

Configurações repete o mesmo padrão: o menu possui Configuração de e-mail como filho, enquanto a tela principal já apresenta um card para esse destino.

## Problema e objetivo

Validar a duplicidade no navegador e tornar Relatórios uma entrada única no menu. O clique deve abrir o catálogo completo de relatórios, preservando rotas diretas, permissões e atalhos existentes.

## Escopo

- Included:
  - comparar os itens do submenu com os cards da tela de relatórios;
  - validar o fluxo real com Playwright em desktop e viewport menor;
  - substituir o submenu por uma entrada direta para `admin-reports` se a duplicidade for confirmada;
  - validar foco, navegação e destaque do menu.
  - tornar Configurações uma entrada direta no menu;
  - incorporar Configuração de e-mail em painel expansível, recolhido por padrão;
  - preservar a rota antiga com redirecionamento para o painel aberto.
- Excluded:
  - alterar conteúdo ou APIs dos relatórios;
  - remover rotas diretas ou atalhos da paleta de comandos;
  - redesenhar os cards do catálogo.

## Critérios de aceitação

- [x] Cada item atual do submenu possui destino equivalente na tela Relatórios.
- [x] O menu exibe uma única entrada Relatórios, sem drilldown duplicado.
- [x] Clicar em Relatórios abre `/admin/reports`.
- [x] Rotas individuais continuam acessíveis pelos cards e links existentes.
- [x] O item Relatórios permanece destacado nas rotas filhas.
- [x] Validação direcionada, typecheck e Playwright passam.
- [x] O menu exibe uma única entrada Configurações, sem drilldown.
- [x] A tela Configurações mostra o painel de e-mail recolhido por padrão.
- [x] O painel permite configurar, testar, salvar e remover sem trocar de tela.
- [x] A rota antiga abre Configurações com o painel de e-mail expandido.

## Estratégia técnica

Manter `ReportsIndexView.vue` como fonte visual do catálogo e reduzir somente a estrutura `adminItems` em `AppLayout.vue`. Preservar o mapeamento de rotas filhas para a chave ativa `admin-reports`.

## Riscos e mitigações

| Risco | Impacto | Mitigação | Stop criterion |
|---|---|---|---|
| Perder acesso rápido a relatório | Baixo | cards e rotas diretas preservados | destino ausente no catálogo |
| Destaque incorreto do menu | Baixo | Playwright em rota raiz e filha | item não ativo |
| Regressão responsiva | Baixo | viewport desktop e menor | menu ou cards inacessíveis |

## Matriz de testes e evidências

| Critério/risco | Teste/harness | Ambiente | Evidência | Obrigatório |
|---|---|---|---|---|
| Duplicidade atual | Playwright/DOM | frontend local | inventário de links | sim |
| Entrada única e navegação | Playwright | Chromium | assertivas e screenshot | sim |
| Tipos | typecheck frontend | local | saída do comando | sim |
| Formatação | `git diff --check` | NA-0012 | saída Git | sim |

## Baseline

- A tela `admin-reports` lista nove destinos.
- O submenu lista cinco destinos; todos aparecem também como cards no catálogo.
- O frontend local está disponível em `http://127.0.0.1:5173`.

## Rollback ou recuperação

Restaurar o grupo `admin-reports-section` e seus cinco filhos em `AppLayout.vue`. Nenhuma rota ou API será removida.

## Aprovação

- Decisão: `GO`
- Aprovado por: usuário
- Aprovado em: 2026-08-09T18:35:00-03:00
