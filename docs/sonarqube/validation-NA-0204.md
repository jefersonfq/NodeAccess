# NA-0204 — Validação Sonar

Atualizado 2026-11-25T20:36:40-03:00. Base/HEAD `0ff5c1f9a8cf87c2b4715728ef7d91f96c37cf6e`, alterações locais incluídas; sem commit/publicação desta frente.

**Gate OK; validação formal BLOCKED.** `npm run validate:sonar` executado pelo wrapper privado configurado, de23:04:18Z a23:32:11Z em25/11/2026. Tooling, cobertura e scanner exit0; validação exit1 exclusivamente por `REVIEWED_FINDINGS_NOT_VERIFIED` / `REVIEW_CHECKOUT_CHANGED`. Não considerar PASS integral nem contornar a exigência de checkout limpo.

Análise `ba8bae80-34ac-4404-8e9a-5b94cb3b556e`; evidência privada `.sonar-reports/validation-1795647858259-01d868df-9395-4906-85ab-376b3ccb0a5d/validation.json`. Export privado `.sonar-reports/2026-11-25T23-32-10.577Z-33908e30-8fc6-4252-a77d-edf6966339c4`.

| Critério | Resultado |
|---|---|
| Novos achados | 0; comparison passed, unexpected vazio |
| Hotspots a revisar | 0 |
| Cobertura nova remota | 84,3%, mínimo80%; período PREVIOUS_VERSION desde03/11/2026 |
| Duplicação nova remota | 0,82383%, máximo3% |
| Cobertura nova local | 95,145631%; 111/117 linhas e85/89 condições; diff desta frente, denominador diferente do remoto |
| Testes | Vitest5068PASS/0FAIL/200pending; Node1037PASS/0FAIL/12skip; browser17/17PASS |
| Ferramentas | 254PASS/0FAIL/1skip de plataforma |
| Revisões formais | Não verificadas por checkout alterado; repetir em SHA limpo após commit autorizado |

Nenhum novo achado para catalogar nesta execução. Baseline aceita Sonar preservada: SHA `18f7da99e04529765c24a0623836e70957fdb6663cb117b6b899cd7d98577d83`, sem alteração de regras, fontes, thresholds ou aceites. Os três hashes atualizados em Gitleaks são fixtures independentes, revisadas individualmente; não mudam a baseline Sonar.

Novo scan de segurança após essa atualização:43/43 fixtures revisadas, Semgrep0achados/0erros, fontes estáveis/cleanup; evidência `.tmp/NA-0204/security-final-reviewed/evidence.json`. Alterações posteriores a esta análise limitam-se aos três hashes revisados de fixtures e documentação/roadmap; nenhum código foi editado.

[Plano e registro](../changes/2026/11/NA-0204-users-vault-managers/implementation.md). Sem homologação humana, commit ou publicação inferidos dos testes.
