# NA-0202 — Sonar local

Atualização de 2026-11-25: esta fatia foi integrada à NA-0203. O bloqueio histórico abaixo foi superado na validação pré-commit; ver [resultado integrado](validation-NA-0203.md). Commit local autorizado e nova verificação no SHA resultante prevista; nenhuma publicação inferida.

Base: `9d2fc71768a0e7aee34a6495e4ec11eceb338076`. Execução em `.tmp/NA-0202-mobile-worktree`, branch `fix/NA-0202-20261124-vault-mobile-reasons`.

`npm run validate:sonar`: **BLOCKED**, exit 1 no preflight, ausência de `SONAR_TOKEN` e `SONAR_REVIEW_TOKEN`. Nenhum gate ou cobertura Sonar aprovado. Não houve alteração de baseline, exclusões ou redução de thresholds. Retomar com credenciais locais separadas sem registrar valores nos documentos.

Validação complementar: 12 testes de views, tipos Vue e lint dos dois arquivos passaram. Navegador Chromium validou três motivos a 390px, apresentação desktop e ausência de motivo em item liberado. Esses resultados não substituem Sonar.
