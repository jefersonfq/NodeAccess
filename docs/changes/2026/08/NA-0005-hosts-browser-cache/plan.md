---
change_id: NA-0005
title: Harness de navegação e cache real da tela de Hosts
type: performance
status: ready-for-review
created_at: 2026-08-04T12:20:00-03:00
base_branch: performance/NA-0003-20260803-dev-warmup
base_sha: e100d30f32c9d89a9303b947c9463efa414c16c1
branch: performance/NA-0005-20260804-hosts-browser-cache
owner: codex
planner: codex
risk: low
---

# NA-0005 — Cache real do navegador em Hosts

## Contexto e situação anterior

A NA-0003 mede e aquece Vite/API antes da abertura do navegador. O harness existente de Hosts mede renderização e interações, mas desabilita o cache HTTP e não isola a primeira navegação SPA da segunda navegação com o mesmo navegador.

## Problema e objetivo

Criar evidência reproduzível do custo percebido pelo navegador ao entrar em Hosts pela primeira vez e ao retornar à tela, incluindo lazy import, requests, long tasks, erros e cache HTTP real.

## Escopo

- Harness Playwright somente leitura, executado contra desenvolvimento local.
- Navegar Dashboard → Hosts → Dashboard → Hosts no mesmo contexto.
- Medir duração, recursos, APIs, transferência, long tasks e erros por passagem.
- Gerar JSON opcional e resumo comparável.
- Testar funções puras de classificação/comparação.
- Documentar execução e limitações.

### Fora do escopo

- Alterar a tela, endpoints, cache de produção ou executar carga concorrente.
- Declarar ganho com uma única amostra ou usar credenciais remotas.

## Critérios de aceitação

- [x] Harness usa somente origem loopback e opera sem mutação de dados.
- [x] Primeira e segunda navegações são medidas no mesmo contexto de navegador.
- [x] Relatório separa recursos frontend, APIs, transferência, long tasks e erros.
- [x] Resultado informa diferença absoluta/percentual sem afirmar melhoria indevida.
- [x] Testes puros, execução real e revisão independente passam.

## Estratégia técnica

Reutilizar Playwright e a assinatura JWT local já existentes. Instrumentar `PerformanceObserver` antes da aplicação, limpar medições entre passagens e acionar navegação SPA via History/PopState. Preservar dados brutos no relatório e derivar um resumo pequeno.

## Riscos e mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| Ruído entre execuções | Médio | Relatar amostra, ambiente e recomendar repetições |
| Token exposto | Alto | Token somente no browser; relatório sem headers/storage |
| Alvo remoto acidental | Alto | Restringir frontend a loopback |
| Falso cache hit | Médio | Registrar transferSize e recursos por passagem |

## Matriz de testes e evidências

| Validação | Evidência | Obrigatório |
|---|---|---|
| Funções puras | `node --test` | sim |
| Navegação real | JSON de duas passagens | sim |
| Console/page errors | lista vazia ou justificada | sim |
| Segurança | origem remota rejeitada/token ausente | sim |
| Revisão independente | gate do diff/relatório | sim |
| Governança | SHA final | sim |

## Baseline

- NA-0003: transformação fria do Vite observada em `11.348 ms`; APIs em `70–138 ms`.
- O warm-up não popula a memória JavaScript de um navegador ainda fechado.

## Resultados validados localmente

As primeiras amostras foram invalidadas porque permitiam telemetria mutável, misturavam requests pendentes do Dashboard e validavam apenas o shell. O harness foi corrigido para bloquear toda request que não seja de leitura, aguardar rede quieta e exigir hosts renderizados.

Três novas execuções sequenciais no Chromium local, com viewport `1440x1000` e mesmo contexto por par:

| Métrica (mediana) | Primeira entrada | Segunda entrada | Diferença observada |
|---|---:|---:|---:|
| Duração | 1.987 ms | 1.577 ms | -20,6% na mediana das variações |
| Transferência | 1.783.666 bytes | 2.067 bytes | -1.781.599 bytes |
| Recursos | 33 | 4 | -29 |
| Long tasks | 545 ms | 380 ms | -165 ms |

- Primeira passagem: 23 recursos frontend e 10 APIs.
- Segunda passagem: 1 recurso frontend e 3 APIs.
- 12 hosts e 12 ações de conexão visíveis nas seis passagens; nenhum erro registrado.
- Telemetria `POST` e preferência `PATCH` foram interceptadas com `204`; nenhuma request mutável alcançou a API.
- As respostas sintéticas interceptadas permanecem nos totais brutos de recursos/transferência e são identificadas separadamente; a comparação deve manter a mesma política nas duas passagens.
- Os valores descrevem este ambiente de desenvolvimento e não constituem SLA nem estimativa de produção.
- Revisão independente final: `PASS`; gate real confirmou 12 hosts, 12 ações, erros vazios, token ausente e todas as mutações explicitamente marcadas como bloqueadas.

## Rollback ou recuperação

Reverter NA-0005 remove apenas harness, testes, script npm e documentação; nenhuma informação persistida é alterada.

## Aprovação

- Decisão: `GO`.
- Usuário autorizou seguir em 2026-08-04.
