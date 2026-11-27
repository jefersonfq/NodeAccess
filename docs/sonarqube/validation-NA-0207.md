# NA-0207 — Validação da descrição do manifesto (extensão 0.1.1)

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
