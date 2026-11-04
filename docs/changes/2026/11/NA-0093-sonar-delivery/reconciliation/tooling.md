# Reconciliação individual dos78 FP tooling restantes

Somente leitura; nenhuma transição no servidor ou alteração da baseline. Fonte integrada WIP, hash por arquivo no JSON. Resultado: {'technical_fp_supported': 72, 'needs_reassessment': 6}.

## Critério

FP técnico exige inaplicabilidade concreta da regra à ocorrência: dado simulado sem endpoint, placeholder sem conta, controle deliberado de protocolo, loop explicitamente limitado ou igualdade alcançável. Ausência de exploração não torna uma recomendação válida falsa. Os seis casos pendentes não autorizam aceite de risco.

## Reavaliação necessária

| ID | Regra | Razão |
|---|---|---|
| SQ-0293 | javascript:S8786 | Regex de remoção de padding tem repetição não ancorada ao início: sufixo inválido provoca tentativas repetidas. Fingerprint esperado pequeno limita exposição atual, mas a recomendação de complexidade é válida; não sustentar FP apenas por ser harness. |
| SQ-0306 | secrets:S6697 | Literal configura credencial efetivamente utilizável de MySQL que recebe backup real. Rede dedicada sem porta publicada reduz exposição, mas não elimina natureza de segredo hardcoded nem acesso por host/participantes da rede. Propor geração efêmera ou decisão explícita de risco, não FP automático. |
| SQ-0398 | javascript:S8786 | Regex não ancorada com dígitos e .* tem repetição quadrática no negativo de dígitos longos. Tooltip formatado é pequeno e controlado, portanto não há DoS demonstrado no produto, mas regra de complexidade continua aplicável; buscar expressão limitada/contrato explícito. |
| SQ-0456 | typescript:S8786 | Regex original não existe mais após NA0149 (handshake extraído para boundary helper). Requer análise nova/remapeamento e eventual resolução automática por código; não transicionar ocorrência antiga como FP. |
| SQ-0460 | typescript:S1313 | IP literal anterior do destino proibido foi substituído por boundary.forbiddenHost. Não há igualdade de fonte atual com o range antigo; preferir resolução automática por nova análise, sem FP manual do código removido. |
| SQ-0520 | javascript:S2612 | Trecho antigo de chmod foi substituído por createChallengeFile com validação de ancestrais. Nonce público tem justificativa técnica, mas ocorrência antiga precisa remapeamento/análise nova; não fechar como FP uma linha removida. |

## Evidência executada

Definições locais de14 regras lidas por GET com token mantido em memória, sem imprimir credenciais. `/tmp/NA0093-tooling-fp-rule-definitions.json`. Fontes78 remapeadas e hash comparado novamente ao gerarrelatório. Probe `/tmp/NA0093-tooling-fp-probes.cjs/json`: regexes reais extraídas por AST, adversariais em subprocesso com limite3s; controles de terminal5positivos+1negativo; quatro loops limitados conferidos pela AST. TemporaryDirectory real0700 e cleanup confirmado em `/tmp/NA0093-tooling-fp-temporary-mode.json`. Nenhum serviço/cluster/SSH/browser foi acionado nesta rodada.

## Limites e próximos passos

72 propostas sustentadas tecnicamente não são autorização de fechamento coletivo: precisam análise final com assinatura/range e decisão individual. Três entre os seis pendentes são trechos removidos/substituídos (SQ0456/0460/0520), que devem ser resolvidos pela análise do código, não convertidos em FP. SQ0306 é credencial real de laboratório e exige geração efêmera ou decisão operacional explícita. As duas regexes são recomendações válidas de complexidade com exposição atual limitada, sem evidência de DoS remoto. Dados/riscos de outros trechos no mesmo harness não estão aprovados.

## Índice por ocorrência

| ID | Resultado | Fonte |
|---|---|---|
| SQ-0281 | technical_fp_supported | `scripts/release/release-provenance.mjs:56` |
| SQ-0284 | technical_fp_supported | `scripts/trial-lab/provider.mjs:44` |
| SQ-0291 | technical_fp_supported | `tools/deploy/backup-user-avatars-harness.sh:19` |
| SQ-0293 | needs_reassessment | `tools/deploy/container-stack-real.mjs:206` |
| SQ-0294 | technical_fp_supported | `tools/deploy/doctor-nodeaccess-harness.cjs:27` |
| SQ-0295 | technical_fp_supported | `tools/deploy/doctor-nodeaccess-harness.cjs:105` |
| SQ-0297 | technical_fp_supported | `tools/deploy/engineering-security-headers-harness.py:7` |
| SQ-0301 | technical_fp_supported | `tools/deploy/ha-state-readiness-harness.sh:20` |
| SQ-0303 | technical_fp_supported | `tools/deploy/helm-migration-recovery-harness.sh:13` |
| SQ-0306 | needs_reassessment | `tools/deploy/restore-mysql-isolated-harness.sh:66` |
| SQ-0307 | technical_fp_supported | `tools/deploy/restore-session-audit-isolated-harness.sh:50` |
| SQ-0310 | technical_fp_supported | `tools/deploy/stack-upgrade-real.mjs:18` |
| SQ-0315 | technical_fp_supported | `tools/frontend/agents-experience-playwright.cjs:16` |
| SQ-0316 | technical_fp_supported | `tools/frontend/agents-experience-playwright.cjs:16` |
| SQ-0317 | technical_fp_supported | `tools/frontend/agents-experience-playwright.cjs:20` |
| SQ-0318 | technical_fp_supported | `tools/frontend/agents-experience-playwright.cjs:62` |
| SQ-0328 | technical_fp_supported | `tools/frontend/forwardings-resilience-playwright.cjs:14` |
| SQ-0329 | technical_fp_supported | `tools/frontend/forwardings-resilience-playwright.cjs:34` |
| SQ-0339 | technical_fp_supported | `tools/frontend/ha-playwright-smoke.cjs:54` |
| SQ-0340 | technical_fp_supported | `tools/frontend/ha-playwright-smoke.cjs:58` |
| SQ-0341 | technical_fp_supported | `tools/frontend/ha-playwright-smoke.cjs:93` |
| SQ-0342 | technical_fp_supported | `tools/frontend/ha-playwright-smoke.cjs:97` |
| SQ-0344 | technical_fp_supported | `tools/frontend/host-backed-bastions-playwright.cjs:14` |
| SQ-0347 | technical_fp_supported | `tools/frontend/host-duplicate-playwright.cjs:67` |
| SQ-0356 | technical_fp_supported | `tools/frontend/host-secret-credentials-playwright.cjs:6` |
| SQ-0357 | technical_fp_supported | `tools/frontend/host-shortcut-navigation-playwright.cjs:4` |
| SQ-0358 | technical_fp_supported | `tools/frontend/hosts-acl-resilience-playwright.cjs:16` |
| SQ-0359 | technical_fp_supported | `tools/frontend/hosts-acl-resilience-playwright.cjs:168` |
| SQ-0360 | technical_fp_supported | `tools/frontend/hosts-acl-resilience-playwright.cjs:204` |
| SQ-0361 | technical_fp_supported | `tools/frontend/hosts-acl-resilience-playwright.cjs:245` |
| SQ-0363 | technical_fp_supported | `tools/frontend/hosts-corporate-folders-playwright.cjs:13` |
| SQ-0364 | technical_fp_supported | `tools/frontend/hosts-feedback-ux-playwright.cjs:34` |
| SQ-0370 | technical_fp_supported | `tools/frontend/hosts-personal-folders-playwright.cjs:26` |
| SQ-0372 | technical_fp_supported | `tools/frontend/hosts-presence-resilience-playwright.cjs:15` |
| SQ-0375 | technical_fp_supported | `tools/frontend/jira-integration-playwright.cjs:23` |
| SQ-0376 | technical_fp_supported | `tools/frontend/jira-integration-playwright.cjs:83` |
| SQ-0378 | technical_fp_supported | `tools/frontend/local-ai-playwright.cjs:87` |
| SQ-0379 | technical_fp_supported | `tools/frontend/local-ai-playwright.cjs:94` |
| SQ-0385 | technical_fp_supported | `tools/frontend/mobaxterm-import-playwright.cjs:53` |
| SQ-0386 | technical_fp_supported | `tools/frontend/mobaxterm-import-playwright.cjs:70` |
| SQ-0388 | technical_fp_supported | `tools/frontend/observability-cdp-harness.cjs:627` |
| SQ-0390 | technical_fp_supported | `tools/frontend/observability-resilience-playwright.cjs:26` |
| SQ-0396 | technical_fp_supported | `tools/frontend/recent-host-access-playwright.cjs:13` |
| SQ-0397 | technical_fp_supported | `tools/frontend/recent-host-access-playwright.cjs:14` |
| SQ-0398 | needs_reassessment | `tools/frontend/recent-host-access-playwright.cjs:98` |
| SQ-0403 | technical_fp_supported | `tools/frontend/session-command-policies-playwright.cjs:29` |
| SQ-0408 | technical_fp_supported | `tools/frontend/session-playback-playwright.cjs:23` |
| SQ-0409 | technical_fp_supported | `tools/frontend/session-playback-playwright.cjs:497` |
| SQ-0415 | technical_fp_supported | `tools/frontend/sharing-flows-playwright.cjs:164` |
| SQ-0431 | technical_fp_supported | `tools/frontend/terminal-cdp-simulated-flow.cjs:29` |
| SQ-0437 | technical_fp_supported | `tools/frontend/terminal-experience-playwright.cjs:22` |
| SQ-0438 | technical_fp_supported | `tools/frontend/terminal-experience-playwright.cjs:39` |
| SQ-0439 | technical_fp_supported | `tools/frontend/terminal-experience-playwright.cjs:40` |
| SQ-0456 | needs_reassessment | `tools/frontend/trial-live-playwright.mts (range removido)` |
| SQ-0459 | technical_fp_supported | `tools/frontend/trial-live-playwright.mts:140` |
| SQ-0460 | needs_reassessment | `tools/frontend/trial-live-playwright.mts (range removido)` |
| SQ-0461 | technical_fp_supported | `tools/frontend/trial-live-playwright.mts:151` |
| SQ-0462 | technical_fp_supported | `tools/frontend/trial-live-playwright.mts:156` |
| SQ-0464 | technical_fp_supported | `tools/frontend/trial-onboarding-playwright.cjs:40` |
| SQ-0469 | technical_fp_supported | `tools/frontend/trial-resources-playwright.cjs:72` |
| SQ-0470 | technical_fp_supported | `tools/frontend/user-dashboard-playwright.cjs:35` |
| SQ-0471 | technical_fp_supported | `tools/frontend/user-dashboard-playwright.cjs:36` |
| SQ-0472 | technical_fp_supported | `tools/frontend/user-dashboard-playwright.cjs:40` |
| SQ-0473 | technical_fp_supported | `tools/frontend/user-dashboard-playwright.cjs:41` |
| SQ-0476 | technical_fp_supported | `tools/load-tests/k6/baseline-api.js:131` |
| SQ-0480 | technical_fp_supported | `tools/load-tests/ws/baseline-gateway.js:93` |
| SQ-0481 | technical_fp_supported | `tools/manual/build.cjs:48` |
| SQ-0490 | technical_fp_supported | `tools/network-access/ux.cjs:65` |
| SQ-0500 | technical_fp_supported | `tools/session-audit/reconstruction-fidelity.ts:265` |
| SQ-0501 | technical_fp_supported | `tools/session-audit/reconstruction-fidelity.ts:292` |
| SQ-0502 | technical_fp_supported | `tools/session-audit/reconstruction-fidelity.ts:302` |
| SQ-0510 | technical_fp_supported | `tools/session-audit/review-recorded-sessions.ts:32` |
| SQ-0511 | technical_fp_supported | `tools/session-audit/review-recorded-sessions.ts:32` |
| SQ-0512 | technical_fp_supported | `tools/session-audit/review-recorded-sessions.ts:32` |
| SQ-0513 | technical_fp_supported | `tools/session-audit/review-recorded-sessions.ts:32` |
| SQ-0514 | technical_fp_supported | `tools/session-audit/review-recorded-sessions.ts:32` |
| SQ-0520 | needs_reassessment | `tools/tls/adapter.mjs (range removido)` |
| SQ-0531 | technical_fp_supported | `tools/tls/manager.mjs:28` |
