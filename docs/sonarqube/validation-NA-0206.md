# NA-0206 — Validação da distribuição da extensão

Estado atual em 2026-11-26T19:19:39-03:00: **PASS no SHA limpo `6f956b2a0768e96c9bc7a07d80ead2bf3543c50b`**, análise `35677a31-e2c0-4f7d-9fdb-d11dd98613e9`, evidência `.sonar-reports/validation-1795725681064-b15dd776-cf91-463a-836f-6af8d8c38f58/validation.json`. Tooling254, Vitest5072, Node1147 e browser/TLS PASS; cobertura diff90,5405%. Resultado consultado na retomada, sem nova execução. Bloqueio atual do deploy é operacional (helper do ensaio de restauração), não Sonar.

O registro abaixo é histórico, anterior à consolidação e à aprovação final.

Atualizado 2026-11-26T14:58:40-03:00. **Testes, cobertura e Quality Gate PASS; validação formal BLOCKED**, exit1 por `REVIEWED_FINDINGS_NOT_VERIFIED` / `REVIEW_CHECKOUT_CHANGED`. Nenhum commit ou deploy realizado.

HEAD `0ff5c1f9a8cf87c2b4715728ef7d91f96c37cf6e` com working tree. Análise `58908000-19ec-431b-b42b-9f8c90be383e`; evidência `.sonar-reports/validation-1795714050133-327ecc98-a337-4c86-8332-fef2bb853cdc/validation.json`. Exit tooling/coverage/scanner: 0/0/0; análise verificada, comparison PASS sem inesperados.

| Critério | Resultado |
|---|---|
| Tooling | 254 PASS, 0 FAIL, 1 skip |
| Vitest | 5072 PASS, 0 FAIL, 200 pending |
| Node | 1060 PASS, 0 FAIL, 12 skips |
| Browser | 17/17 PASS, sem timeout |
| TLS | PASS, cleanup confirmado |
| Diff local | 85,5054036872%; 3558/3910 linhas +3167/3955 condições; mínimo80; missing[] |
| Base local | 9d2fc71768a0e7aee34a6495e4ec11eceb338076 → HEAD +working tree |
| Nova cobertura remota | 84,3%, mínimo80, escopo PREVIOUS_VERSION |
| Duplicação remota | 0,81628%, limite3 |
| Novas violações/hotspots | 0/0 |
| Revisões formais | reviewsVerified=false; checkout alterado, sem contorno |

Nenhum novo achado exige aceite individual no Sonar. Baseline Sonar, regras, exclusões e limites não foram alterados. Gitleaks foi revisado separadamente: somente dois hashes de fixtures de locales atualizados após revisão independente de blocos integralmente iguais ao HEAD. Novo scan 43/43 revisados, Semgrep0/0 em1010 alvos, fontes estáveis e cleanup em `.tmp/NA-0206/security-final-reviewed`.

A primeira execução foi interrompida e preservada: timeout do teste do exportador (duas chegadas HTTP, esperava três; causa não demonstrada) e Chromium sem abrir por TMPDIR/socket longo no ensaio de administração. Caminho temporário corrigido; focais originais passaram e esta segunda execução completa passou. Não houve relaxamento de asserções, deadlines ou thresholds. A falha histórica não é substituída por um resultado fictício.

Aprovação formal continua pendente; pacote local assinado não equivale a release homologada. [Registro completo](../changes/2026/11/NA-0206-extension-distribution-guide/implementation.md).
