---
change_id: NA-0014
title: Confiabilidade e experiência do terminal
type: feature
status: passed
created_at: 2026-08-09T20:15:00-03:00
base_branch: feature/NA-0013-20260809-session-command-policies-ux
base_sha: 93553ef
branch: feature/NA-0014-20260809-terminal-experience-reliability
owner: codex
planner: codex
risk: high
issue: null
---

# NA-0014 — Confiabilidade e experiência do terminal

## Contexto e situação anterior

O terminal possui atalhos de fonte por teclado e resize dinâmico, mas não oferece Ctrl+scroll. Sessões simultâneas tentam iniciar os mesmos forwardings sem explicar reutilização/conflito. Aplicações de tela alternativa, como HTOP, dependem de sincronização rigorosa entre dimensões do xterm e PTY. A presença em `/hosts` pode permanecer visível durante a janela entre encerramento, cache e nova consulta.

## Problema e objetivo

Melhorar zoom, feedback de túneis concorrentes, tempo/ocupação visual de aplicações interativas e remoção imediata de presença encerrada, com testes de navegador e regressão backend.

## Escopo

- Included:
  - Ctrl+scroll para zoom persistido com limites e resize do PTY;
  - diagnóstico e feedback de auto-start em múltiplas sessões do mesmo host;
  - teste Playwright de ANSI/tela alternativa, dimensões e latência de renderização;
  - sincronização adicional de fit/resize após fontes/layout;
  - atualização otimista e reconciliação da presença encerrada em `/hosts`;
  - testes direcionados de frontend, túnel e presença.
  - passphrase cifrada para chaves privadas, com detecção e validação no cadastro;
  - edição rápida de nome/endereço/porta/usuário no terminal, condicionada à ACL de edição;
- Excluded:
  - alterar protocolo SSH ou formato da auditoria;
  - compartilhar sockets SSH entre sessões;
  - redesenhar toda a tela do terminal.

## Critérios de aceitação

- [x] Ctrl+scroll altera fonte somente sobre o terminal, respeita 10–24 px e envia resize.
- [x] Três sessões do mesmo usuário e host reutilizam túneis, informam o compartilhamento e preservam isolamento entre usuários.
- [x] Tela alternativa ANSI ocupa a área útil e mantém PTY alinhado após resize/zoom.
- [x] Teste Playwright mede primeira renderização interativa e não encontra corte relevante.
- [x] Encerramento remove imediatamente a presença local e reconcilia com a API.
- [x] Estados de erro e concorrência não são comunicados apenas por cor.
- [x] Typecheck, testes direcionados e `git diff --check` passam.
- [x] Chave criptografada exige passphrase, armazena-a cifrada e funciona em todos os consumidores SSH.
- [x] Edição pelo terminal respeita ACL; mudança de endpoint reconecta e mudança apenas de nome não interrompe a sessão.

## Estratégia técnica

Manter zoom no adaptador/UI, resize no composable, concorrência de túneis no serviço existente e presença na projeção local de `/hosts`. Instrumentar navegador real sem alterar contratos de auditoria.

## Riscos e mitigações

| Risco | Impacto | Mitigação | Stop criterion |
|---|---|---|---|
| PTY e xterm divergirem | Alto | assert de cols/rows e resize após zoom | tela alternativa continua cortada |
| Túnel de outra sessão ser encerrado | Alto | manter ownership por sessionId | fechamento cruzado |
| Presença real ser removida | Alto | remover somente sessionId encerrado e reconciliar API | outras sessões somem |
| Evento de wheel afetar scroll normal | Médio | exigir Ctrl e terminal visível | scroll sem Ctrl bloqueado |

## Matriz de testes e evidências

| Critério/risco | Teste | Evidência |
|---|---|---|
| Zoom e resize | unitário + Playwright | fonte, wheel e frame resize |
| HTOP/tela alternativa | Playwright WebSocket simulado | dimensões, screenshot, latência |
| Túneis concorrentes | teste de TunnelService/gateway | estado e mensagem por sessão |
| Presença encerrada | teste de projeção + Playwright `/hosts` | sessão removida e refetch |

## Rollback ou recuperação

Reverter arquivos da NA-0014. A migration adiciona somente colunas opcionais à tabela `pem_keys`; em rollback, removê-las apenas depois de confirmar que nenhuma passphrase salva precisa ser preservada.

## Aprovação

- Decisão: `GO`
- Aprovado por: usuário
- Aprovado em: 2026-08-09T20:15:00-03:00
