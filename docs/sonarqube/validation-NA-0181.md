# NA-0181 — Validação

Base: 16588b7ed83c3b4da671eeb8e718c07dc10c3864. Candidato: 660d940558121fbf8e3d78bab255ee5d9905877e (branch security/NA-0181-20261118-image-vulnerability-gate).

Ran: `node --test scripts/security/*policy.test.mjs` 159 PASS/0 FAIL; replay local das políticas sobre os relatórios brutos do CI (run 44414763526) 7/7 imagens PASS. Revisão independente estática PASS_WITH_WARNINGS (avisos de baixo risco registrados no implementation.md).

Ran: `npm run validate:sonar` no candidato. Primeira execução FAIL apenas por ambiente: `TLS_LAB_CLEANUP_FAILED` porque o usuário local não tinha acesso ao socket Docker (sem relação com o diff). Repetida com o grupo `docker` só para o processo: PASS, análise e revisões verificadas, 0 achados inesperados, cobertura diferencial 90,32%. Evidência privada `.sonar-reports/validation-1795089405134-777f1ec8-4a3b-4033-9d6f-2208bae252a4/validation.json`.

Sem exclusões de arquivos/regras, redução de thresholds ou mudança da baseline Sonar.
