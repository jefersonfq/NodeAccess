---
change_id: NA-0002
title: Revisão e otimização do carregamento da tela de hosts
type: performance
status: ready-for-tests
created_at: 2026-08-03T15:57:24-03:00
base_branch: feature/NA-0001-20260803-change-lifecycle-governance
base_sha: 3e66ffa2bec093a5a9c7f44fddde71aab5da336e
branch: performance/NA-0002-20260803-hosts-loading
owner: codex
planner: codex
risk: medium
---

# NA-0002 — Carregamento da tela de hosts

## Contexto e situação anterior

A tela já usa paginação server-side (24 cards ou 40 linhas), cache de requests, bootstrap lateral e carregamento diferido de dependências. Entretanto, a montagem ainda dispara lista/atalhos/bootstrap/inventário/presença e depois seis recursos diferidos; o componente central é grande e o custo percebido precisa ser separado entre rede, consulta, payload e renderização antes de criar outro layout.

## Problema e objetivo

Medir o caminho crítico da tela de hosts e reduzir tempo até conteúdo útil. Se a API já estiver adequada, melhorar a ordem de carregamento e tornar o card/lista mais leves sem remover informação necessária, permissões, ações ou estados.

## Escopo

- Medir API, quantidade/ordem de requests, payload e renderização no modo de desenvolvimento.
- Revisar paginação, cache, consultas Prisma/MySQL e índices relacionados sem executar DDL sem evidência.
- Priorizar lista de hosts e postergar dados necessários apenas a formulários/painéis.
- Reduzir custo de card/renderização somente quando comprovado.
- Criar ou melhorar testes/harness de carregamento, regressão e estados.

### Fora do escopo

- Redesenho completo da tela, nova biblioteca visual ou gráficos decorativos.
- Mudança de ACL/autorização, migração/DDL ou carga em produção.
- Remoção de funcionalidades administrativas existentes.

## Critérios de aceitação

- [ ] Baseline identifica requests críticos, payload, latência e momento de conteúdo útil.
- [ ] A lista principal não aguarda recursos que só são usados ao abrir formulários ou painéis.
- [ ] Não há duplicação evitável de requests no carregamento inicial.
- [ ] Cards/lista preservam nome, destino, protocolo, estado/permissão e ação principal com menos custo quando aplicável.
- [ ] Loading, vazio, erro, sem permissão e responsividade permanecem corretos.
- [ ] Testes direcionados e harness com comparação antes/depois passam no SHA final.
- [ ] Qualquer mudança de consulta é validada por plano/benchmark e não apenas por intuição.

## Estratégia técnica

1. Executar harness existente e instrumentação do navegador/API.
2. Mapear caminho crítico versus dados sob demanda.
3. Aplicar a menor mudança mensurável: agendamento, deduplicação, payload ou renderização.
4. Validar funcional, visual, acessibilidade básica e performance com o mesmo cenário.

## Riscos e mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| Dados auxiliares ausentes ao abrir formulário | Alto | Lazy load com estado de carregamento e teste do primeiro uso |
| Cache exibir dados obsoletos | Médio | Preservar invalidações e refresh em background |
| Card leve ocultar ação/permissão | Alto | Matriz de informação e validação por perfil |
| Benchmark variar por cache/dev server | Médio | Repetições, mesmo ambiente e cache documentado |
| Otimização SQL degradar escrita | Alto | Não criar índice sem EXPLAIN/benchmark representativo |

## Matriz de testes e evidências

| Validação | Evidência | Obrigatório |
|---|---|---|
| Baseline frontend/API | harness, timings e requests | sim |
| Typecheck/lint/testes direcionados | saída dos comandos | sim |
| Fluxo de hosts em navegador | desktop/mobile, console/rede | sim |
| Loading/vazio/erro/permissão | teste automatizado ou manual registrado | sim |
| Consulta/índice, se alterados | EXPLAIN/benchmark antes/depois | condicional |
| Build | saída do comando | sim |

## Baseline

- Base SHA: `3e66ffa2bec093a5a9c7f44fddde71aab5da336e`.
- Implementação observada: paginação 24/40, cache por query, bootstrap paralelo e dados secundários diferidos em 150 ms.
- Baseline do harness local: navegação normal `2584 ms`; API `/hosts` em `64 ms` para 24 cards (`19.905 bytes`); inventário em `69 ms` (`161.219 bytes`).
- A transição para 24 cards adicionou cerca de `725` nós e `402 ms` de long tasks no cenário aquecido. O custo dominante observado é renderização, não consulta MySQL.
- A tentativa de mover dependências secundárias para `requestIdleCallback` foi retirada após revisão independente: ela misturava duas variáveis no benchmark e ampliava o risco do primeiro uso de formulários. Esta frente mantém somente o lote inicial de cards.
- A/B final isolado em `:5175`, três repetições aquecidas por variante: 24 cards = `725` nós e mediana de `462 ms` de long task; 12 cards = `245` nós e mediana de `213 ms`. Resultado comprovado: `-66%` nós e `-54%` long task. O payload observado caiu de `19.905` para `10.123 bytes` por reduzir o lote, mas os artefatos de 24 usaram cache em parte das rodadas; latência de API é apenas indicativa, não ganho causal aprovado.
- O `navMs` de `20017 ms` da instância isolada foi contaminado pela compilação fria do Vite e não é usado como comparação de navegação.
- O harness recebeu controle determinístico `PERF_CARD_PAGE_SIZE` por hook local, permitindo comparar 12/24 no mesmo código e ambiente sem editar a aplicação entre execuções.
- Trade-off aceito: com 815 hosts, o default passa de aproximadamente 34 para 68 páginas; o usuário continua podendo escolher 24 ou 48 cards por página.

## Rollback ou recuperação

Reverter os commits NA-0002 restaura a ordem e apresentação atuais. Mudanças de carregamento sob demanda devem permanecer isoladas e sem alteração de dados persistidos.

## Aprovação

- Decisão: `GO_WITH_RISKS`
- Aprovado pelo usuário em 2026-08-03, ao solicitar revisão, testes e melhoria do carregamento/card.
