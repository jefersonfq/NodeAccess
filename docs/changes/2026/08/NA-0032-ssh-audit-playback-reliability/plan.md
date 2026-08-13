---
change_id: NA-0032
title: Confiabilidade da auditoria e playback SSH
type: feature
status: passed
created_at: 2026-08-13T18:10:00-03:00
base_branch: feature/NA-0031-20260813-identity-provisioning-governance
base_sha: 981a168d181dda963f5cb308d31473c8f4acb99f
branch: feature/NA-0032-20260813-ssh-audit-playback-reliability
owner: codex
planner: codex
risk: high
issue: null
---

# NA-0032 — Confiabilidade da auditoria e playback SSH

## Contexto e situação anterior

A auditoria já persiste eventos ordenados, reconstrói comandos e oferece detalhe
com playback híbrido. Existe um fluxo CDP inicial, mas ainda não há uma suíte
fechada que prove controles, seek, temporização, lista de comandos, estados,
responsividade e ausência de regressões visuais/console/rede.

## Problema e objetivo

Tornar a revisão de sessões SSH previsível para investigação e compliance,
separando limitações reais da captura de defeitos da interface. Fechar uma suíte
reproduzível com Playwright para comportamento e Chromium CDP para diagnóstico.

## Escopo

- baseline da tela de lista e detalhe da auditoria;
- playback read-only, play/pause/restart/seek/fim/velocidade/instantâneo;
- correlação de comandos, outputs, confiança e marcadores;
- estados loading, vazio, erro, sessão parcial e stream truncado;
- responsividade, teclado e foco básico;
- harness Playwright determinístico e harness CDP com relatório JSON;
- testes direcionados de normalização, contagem, storage, API e frontend.

## Critérios de aceitação

- [x] Playback nunca envia input e preserva ordem por `seq`.
- [x] Play/pause/restart/seek/fim e velocidades são determinísticos.
- [x] Clique em comando posiciona o replay no ponto correlacionado.
- [x] Lista informa confiança, categoria, ator, horário e output com clareza.
- [x] Loading, vazio, erro, truncamento e sessão interativa são explícitos.
- [x] Desktop e mobile não apresentam overflow funcional ou CTA inacessível.
- [x] Playwright cobre o fluxo funcional; CDP cobre console, rede e layout.
- [x] Relatórios não contêm tokens, comandos sensíveis ou stream integral.
- [x] Typecheck frontend, testes direcionados e governança da frente passam.

## Estratégia técnica

Reutilizar a fonte JSONL e os endpoints atuais. Isolar regras puras de playback
para testes determinísticos, adicionar seletores semânticos estáveis e usar
fixtures de API no Playwright. Manter o CDP para aferir navegador real, requests,
erros, dimensões e custo, sem duplicar as asserções funcionais do Playwright.

## Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Teste flakey por temporizadores | relógio controlado e fixtures pequenas |
| Vazamento de conteúdo no relatório | somente contagens, hashes e métricas |
| Prometer fidelidade de TUI | badge de limitação e stream bruto como fonte |
| Refatoração ampla da tela | extrair apenas regras necessárias ao teste |

## Matriz de testes e evidências

- Vitest: normalização, comandos, timeline e seek;
- Playwright: lista → detalhe → playback, comandos, erro/vazio e mobile;
- CDP: console, requests duplicadas/falhas, overflow, controles e métricas;
- typecheck backend/frontend/shared e lint dos arquivos alterados.

## Baseline

- branch-base: `feature/NA-0031-20260813-identity-provisioning-governance`;
- SHA-base: `981a168d181dda963f5cb308d31473c8f4acb99f`;
- harness inicial: `tools/frontend/session-playback-cdp-flow.cjs`.

## Evidências finais

- Playwright: desktop `1440x1000`, mobile `390x844`, erro e vazio aprovados;
- cobertura de interface ampliada para timeline, clean/raw, timestamps, velocidade
  `4x`, confiança/categoria, busca, CSV filtrado e limite de 5.000 eventos;
- sessão sintética de 5 minutos lógicos: 29 comandos, 105 eventos, 56 passos
  e 30 marcadores, cobrindo fragmentação, ANSI/TUI, resize, UTF-8, erro e pausa;
- certificação visual opcional gera vídeo WebM, trace Playwright e screenshots
  estabilizados das abas Playback e Commands;
- métricas CDP da sessão longa registram heap, DOM, layouts, estilos e task time;
- inspeção visual encontrou e corrigiu traduções inglesas ausentes na lista;
- CDP real: sessão com 537 eventos, 1 comando, zero comandos/outputs ausentes,
  zero overflow e zero achados nos dois viewports;
- Vitest: 138 testes de normalização e publicação aprovados;
- frontend `vue-tsc --noEmit` e `git diff --check` aprovados;
- relatório CDP reduz conteýo textual a tamanho e SHA-256 truncado;
- typecheck global do backend permanece bloqueado por cinco erros preexistentes
  de `exactOptionalPropertyTypes` em `auth/scim.service.ts`, fora deste escopo.

## Rollback ou recuperação

Reverter componentes e harnesses desta frente. A captura e os eventos de
auditoria permanecem inalterados; a tela anterior continua consumindo os mesmos
endpoints, sem migration destrutiva.

## Aprovação

- Decisão: `GO_WITH_RISKS`
- Aprovado por: usuário
- Aprovado em: 2026-08-13
