# NA-0178 — Validação Sonar

Base: bf122f141029244b0687f549353d79b4dcbaa506. Candidato local sem commit; nenhum resultado abaixo constitui aprovação final.

## Diagnóstico executado

`npm run validate:sonar` terminou FAIL. Análise 2d3ec62d-4562-4a44-9728-8c5fa16b84b8; relatório privado `.sonar-reports/validation-1794799458706-7a80ff82-f76b-4400-8f64-1040b86c0f20/validation.json`. Vitest: 3956 PASS, 155 pendentes; Node: 720 PASS, 1 FAIL, 11 skip. Jornadas de terminal passaram; jornada security-center falhou pelo hash editorial desatualizado. Diff coverage 93,04%; cobertura Sonar 79,5% abaixo de 80%. Nenhum limite ou exclusão alterado.

| Achado | Local | Tratamento e evidência |
|---|---|---|
| 4dfe8048-ae53-4f98-9dd7-be3ce02dd4e0 / typescript:S2871 | vault-envelope.ts | Eliminada ordenação implícita na validação de JWK; comparação explícita das três propriedades permitidas. Testes focais passam; reanálise pendente. |
| Hash editorial identity | controls-catalog.json | Revisão independente da correção focal de logout; hash e proveniência atualizados sem ampliar alegações públicas. build.test.cjs: 7 PASS. |
| REVIEW_CHECKOUT_CHANGED | Reconciliação obrigatória | Gate exige SHA commitado e checkout limpo; não foi desativado. Commit depende de autorização explícita conforme lifecycle. |
| new_coverage 79,5% | Gate Sonar | Repetir coleta completa após correções e commit; se persistir, adicionar cobertura pertinente, sem reduzir thresholds. |

Reanálise integral no candidato final: Planned. Nenhuma aprovação de baseline, homologação, publicação ou deploy presumida.
