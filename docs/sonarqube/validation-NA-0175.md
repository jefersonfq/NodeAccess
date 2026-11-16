# NA-0175 — Correções e validação do catálogo

Base: ae188983d061a7bb5e6aaf855fd9d2f92416f3b8. Candidato 4eb6e4cb3 reprovado: contrato CI não admitia tsconfigPaths, seis achados e cinco autorizações históricas obsoletas. Análise completa sem OOM, três projetos TypeScript, cobertura Sonar 81,9% e diff local 87,12%; esses resultados não aprovam o candidato.

| Achado | Local | Correção / evidência |
|---|---|---|
| SQ-0570 / 977969d0-0128-4784-bbc3-4cc5845df3d2 | apps/frontend/src/components/vault/PemKeyActions.vue:176 | Nome acessível adicionado ao input auxiliar; comportamento hidden/autocomplete preservado. Reanálise pendente. |
| SQ-0571 / 531986b2-99f2-4c52-9bc0-a08d68f10aed | apps/frontend/src/components/vault/SecretActions.vue:382 | Nome acessível adicionado ao input auxiliar; comportamento hidden/autocomplete preservado. Reanálise pendente. |
| SQ-0572 / dce9b48d-d5f7-4339-a431-88d2757acb1f | apps/frontend/src/components/vault/SecretActions.vue:389 | Nome acessível adicionado ao input auxiliar; comportamento hidden/autocomplete preservado. Reanálise pendente. |
| SQ-0573 / 7a6ccd22-6e34-404f-8448-40763e5a02ad | apps/frontend/src/components/vault/SecretActions.vue:484 | Nome acessível adicionado ao input auxiliar; comportamento hidden/autocomplete preservado. Reanálise pendente. |
| SQ-0574 / 3b55d668-d574-4ec2-b531-98a43669716b | apps/frontend/src/components/vault/SecretActions.vue:491 | Nome acessível adicionado ao input auxiliar; comportamento hidden/autocomplete preservado. Reanálise pendente. |
| SQ-0575 / bc8eaa0e-51ac-4976-8884-e3be4c7116bd | tools/frontend/vault-catalog-playwright.cjs:153 | Helper exportado separado do executável CLI; removida comparação require.main/module. Reanálise pendente. |

Retiradas revisadas independentemente: SQ-0247, SQ-0249, SQ-0250, SQ-0251, SQ-0252. As cinco linhas históricas permanecem no inventário; outras 201 autorizações preservadas. accepted-findings.json, regras e thresholds não alterados. Novos achados não receberam exceções.

Contrato CI agora aceita tsconfigPaths e testa rejeição de ausência, divergência e duplicidade divergente; materialização conserva os mesmos bytes da configuração base. Ferramentas Sonar: 231 testes passaram, 1 skip; catálogo/componentes/telas: 50 passaram. Evidências privadas em .tmp/NA-0175/sonar-tooling-fix.log e fix-tests.log. Helper Chromium separado mantém coleta e encerramento de contexto/browser.

Gate integral obrigatório no próximo SHA; resultado final será vinculado na PR e evidência sanitizada, sem presumir aprovação desta correção.

## Reanálise do candidato 451e1ccbe

Gate integral PASS em 2026-11-15 23:57:13 UTC, análise f241f9ef-7340-4c41-856a-f7e9a0203f43. Cobertura Sonar 81,8%, diff 86,71%; zero violações novas, zero hotspots, nenhuma condição ignorada. Reconciliação verificada, 201 revisões inalteradas e zero inesperados. Os seis achados desta frente estão ausentes das violações abertas. Revisão técnica independente PASS_WITH_WARNINGS. PR66 registra a evidência sanitizada. Correção documental posterior exige nova execução no SHA correspondente; este resultado não é transferido automaticamente.
