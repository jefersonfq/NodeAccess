# NA-0184 — Validação

Base: 8ef8188a6af1ee0b8180a9707ad54b54b8fd4002. Candidato: 44d1c6ab6 (branch security/NA-0184-20261119-vault-stepup-methods).

Ran: Vitest completo dentro do gate 4164 PASS/0 FAIL; `npm run test:vault:real` (MySQL/Redis reais) 32 PASS; `npm run test:vault:frontend` (Chromium HTTPS + backend real) PASS; `npm run test:oidc:keycloak` PASS com os cenários de confirmação. Revisão independente estática PASS_WITH_WARNINGS; avisos corrigidos ou aceitos no implementation.md.

Ran: `npm run validate:sonar` no candidato: PASS, análise verificada, 0 achados inesperados, gate do servidor OK (0 violações novas), cobertura diferencial local 80,52%. Evidência privada `.sonar-reports/validation-1795122186719-641a2049-0d84-46ee-b528-a57fe6df45bd/validation.json`. Execuções anteriores FAIL corrigidas: fixture do cofre desatualizada, S2871 no harness Keycloak, cobertura diferencial 63,7% e depois 74%, e uma falha intermitente sob carga em `tools/sonarqube/export.test.mjs` (sem relação; passou 3/3 isolado e no gate final).

Sem exclusões de arquivos/regras, redução de thresholds ou mudança da baseline Sonar.
