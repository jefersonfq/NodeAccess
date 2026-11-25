# NA-0201 — Sonar local bloqueado

Atualização de 2026-11-25: esta fatia foi integrada à NA-0203. O bloqueio histórico abaixo foi superado na validação pré-commit; ver [resultado integrado](validation-NA-0203.md). Commit local autorizado e nova verificação no SHA resultante prevista; nenhuma publicação inferida.

2026-11-24. Base/HEAD `9d2fc71768a0e7aee34a6495e4ec11eceb338076`, working tree da branch `feature/NA-0201-20261124-extension-personal-items`.

Ran: `npm run validate:sonar` terminou com exit 1 antes da análise. Diagnóstico sem valores de credenciais confirmou Node v24.21.0, `SONAR_TOKEN` e `SONAR_REVIEW_TOKEN` ausentes e URL não configurada no ambiente desta sessão. Não há Quality Gate nem cobertura diferencial aprovados.

Estado: **BLOCKED**. A tabela de achados e a baseline permanecem preservadas porque nenhuma exportação nova foi produzida. Não foi feita dispensa de regra, fonte, threshold ou revisão independente. Após disponibilizar tokens separados no ambiente, executar novamente o gate completo e reconciliar achados/evidências conforme `docs/OPERATIONS-sonarqube.md`.

Testes locais e revisão estática independente constam em [test-results](../changes/2026/11/NA-0201-extension-personal-items/test-results.md); não substituem Sonar ou homologação humana.

2026-11-24T18:30:38-03:00: refinamento UX de validação pré-envio. Nova execução `npm run validate:sonar`: exit 1 no preflight, sem análise/gate. Testes editor/popup 26 PASS e Chromium 46 checks PASS não substituem o bloqueio. Baseline e achados não alterados.
