---
change_id: NA-0036
title: Padronizar bastions como hosts cadastrados
type: feature
status: completed
created_at: 2026-08-14T00:35:00-03:00
base_branch: fix/NA-0035-20260814-test-suite-hermeticity
base_sha: 170b6192a4e3020e696199d0e1e4189b12b0b99b
branch: feature/NA-0036-20260814-host-backed-bastions
owner: codex
planner: codex
risk: high
issue: null
---

# NA-0036 — Bastions baseados em hosts

## Contexto e situação anterior

O mesmo servidor era cadastrado separadamente como Host e Bastion, duplicando
IP, porta, usuario e credenciais. A tela de bastions ja calculava uso direto,
por grupo e herdado, mas nao vinculava o recurso ao inventario de hosts.

## Problema e objetivo

Transformar bastion em um papel operacional de um Host SSH existente, mantendo
compatibilidade de leitura e conexao com cadastros legados durante a transicao.

## Escopo

- perfil de bastion referenciando um Host de forma unica;
- criacao pela selecao de Host SSH ativo e direto;
- credenciais e endereco resolvidos sempre do Host de origem;
- lista de bastions com host de origem e consumidores;
- protecao contra auto-referencia, ciclos e multi-hop acidental;
- bloqueio de desativacao/exclusao enquanto estiver em uso;
- manutencao de bastions legados para leitura/migracao;
- migration, contratos, backend, UI, testes e documentacao.

## Estratégia técnica

Adicionar `bastion_hosts.source_host_id` opcional e unico. Perfis novos guardam
o vinculo e mantem colunas legadas apenas para compatibilidade. Repositorios SSH
resolvem endereco e credenciais atuais do Host quando o vinculo existe. A API
cria o perfil por `sourceHostId`; a tela vira uma visao operacional de hosts
habilitados, sem formulario duplicado de credenciais.

## Riscos e mitigações

| Risco | Impacto | Mitigacao | Stop criterion |
|---|---|---|---|
| ciclo ou auto-salto | critico | validacao no servico e teste | grafo ciclico persiste |
| credencial divergente | alto | resolucao live pelo Host | runtime usa snapshot antigo |
| quebrar legado | alto | `sourceHostId` nullable e fallback atual | bastion legado deixa de conectar |
| host grafico/agente como salto | alto | elegibilidade SSH + DIRECT | perfil invalido e criado |
| excluir origem em uso | alto | blocker explicito | referencia fica orfa |

## Critérios de aceitação

- [x] novo bastion e criado selecionando um Host existente;
- [x] alteracao do Host reflete no salto sem duplicar credencial;
- [x] lista mostra host de origem, uso direto, grupos e heranca;
- [x] Host nao usa a si mesmo e ciclos/multi-hop sao bloqueados;
- [x] apenas Host SSH ativo com conexao direta e elegivel;
- [x] cadastros legados continuam listando e conectando;
- [x] testes unitarios, schema, typechecks e Playwright/CDP passam.

## Estratégia de testes

Testar elegibilidade, tenant cruzado, duplicidade, auto-referencia, ciclo,
resolucao live, fallback legado, impacto de exclusao, persistencia e os estados
de UI loading/vazio/erro/sucesso em desktop e viewport menor.

## Matriz de testes e evidências

| Criterio/risco | Teste | Evidencia |
|---|---|---|
| dominio e guardrails | service unitario | combinacoes validas e invalidas |
| contrato e tenant | rota Fastify | payload e escopo autenticado |
| runtime live/legado | repository/SSH | origem Host e fallback |
| UX e persistencia | Playwright + CDP | selecionar, ativar, listar e reler |
| schema | Prisma validate/migration | FK e unique aprovadas |

## Resultado da validacao

- Prisma schema valido e client regenerado;
- backend e frontend sem erros de tipo;
- 625 testes de regressao aprovados;
- 40 testes focados de Host/Bastion/SSH aprovados;
- harness Playwright aprovado em Chromium local e via CDP, incluindo viewport 390x844;
- payload de criacao validado como `{ sourceHostId }`, sem duplicacao de segredo.
- configuracao de conexao do Host agora exibe o estado e as acoes de habilitar/desabilitar o papel de bastion;
- harness valida que o ponto de entrada aparece no cadastro e permanece bloqueado ate o primeiro salvamento.

## Baseline

`BastionHost` armazena servidor e credenciais duplicados; Host/Group apontam
para ele. A lista atual ja fornece consumidores, mas nao a origem no inventario.

## Rollback ou recuperação

Reverter aplicacao mantendo a coluna nullable. Antes de retornar a uma versao
que nao resolve `sourceHostId`, desabilitar os perfis novos; nenhum segredo e
copiado para as colunas legadas.

## Aprovação

- Decisão: GO
- Aprovado por: usuario
- Aprovado em: 2026-08-14
