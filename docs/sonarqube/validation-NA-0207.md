# NA-0207 — Validação da descrição do manifesto (extensão 0.1.1)

Estado atual em 2026-11-27T16:45:00-03:00: **PASS no SHA `4c876319b426c3b0dbf0ccab0b1f1240fca3fe2d`**, base `109add8bf3cdbabdb64ca93d11abaca04b3454f9`, análise `f391ab31-62bb-4618-bd8c-106761ebb8d1`, evidência `.sonar-reports/validation-1795806907156-25af2a75-b2ef-4990-b257-6ad0c44fc681/validation.json` (privada). Gate OK, comparação PASS com 0 inesperados, 0 hotspots, revisões verificadas. Cobertura nova 100%. Vitest 5073 PASS/0 FAIL/200 skip; Node 1147 PASS/0 FAIL/12 skip com laboratório TLS verificado; navegador 17/17 PASS.

Para chegar aqui: ACL temporária no socket do Docker para `jeferson` (aprovada pelo usuário, removida em seguida) e reconstrução das imagens locais ausentes `nodeaccess-mysql:8.4.12-1`, `nodeaccess-redis:8.2.10-1` e `nodeaccess-backend:security-local` com os comandos do workflow `stack-compatibility.yml`. Uma rodada intermediária no mesmo SHA (análise `5ee060b2-302b-446d-81e7-eec9d094019c`) falhou só no harness `vault-site-terminal`, por imagem ausente; o teste focal passou (13 verificações, cleanup) antes da repetição completa.

O registro abaixo é histórico.

Estado em 2026-11-27T14:25:00-03:00: **BLOCKED (ambiente)** no SHA `f51b218d0e1f10d0c516783402a105773d24ea63`, base `109add8bf3cdbabdb64ca93d11abaca04b3454f9`. Análise `23ba80d9-c4d7-4fad-a4fd-99d012e87640`; evidência `.sonar-reports/validation-1795799201810-4b27f3ca-d0c4-4f30-8014-a685c8bb5767/validation.json` (privada). Não é aprovação.

| Critério | Resultado |
|---|---|
| Quality Gate | OK; análise verificada; comparação PASS, 0 inesperados; 0 hotspots |
| Cobertura nova | 100% (só string e teste; 0 linhas executáveis novas) |
| Vitest | 5073 PASS / 0 FAIL / 200 skip |
| Node | 1146 PASS / 1 FAIL / 12 skip — `tls-lab.test.mjs`: `TLS_LAB_CLEANUP_FAILED` |
| Navegador | 14/15 PASS; `vault-site-terminal` exit 1 |
| Resultado formal | `TESTS_OR_COVERAGE_FAILED` |

Causa das duas falhas, confirmada nos diagnósticos: `docker: permission denied` em `/var/run/docker.sock` (`root:docker 660`, grupo `docker` sem membros) para o usuário `jeferson`; o socket foi recriado em 2026-11-26T18:58. Ambas falham antes de iniciar MySQL e não executam código alterado. `sourceChanged=false`.

Baseline, exclusões e thresholds preservados. Próximo passo: liberar o socket para `jeferson` (ACL temporária aprovada pelo usuário; `setfacl` ausente na máquina) e repetir `validate:sonar` uma vez no SHA final.
