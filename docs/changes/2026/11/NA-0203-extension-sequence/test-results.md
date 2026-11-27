# NA-0203 — Evidências locais

Esta página preserva a rodada anterior. A rodada subsequente, incluindo geração persistente que substitui a limitação histórica de off/on descrita abaixo, está em [hardening-results.md](hardening-results.md). Usar esse documento para o estado atual, resultados e pendências; não somar execuções repetidas.

2026-11-24, branch `feature/NA-0203-20261124-vault-diagnostics`, base/HEAD `9d2fc71768a0e7aee34a6495e4ec11eceb338076`, working tree sem commit. Fingerprints abaixo identificam conjuntos declarados nos artefatos; não representam um commit final nem homologação humana.

| Verificação | Resultado | Evidência |
|---|---|---|
| Regressão backend/extensão/portal/hosts | 809 PASS, 71 opt-in não executados nessa chamada | `.tmp/NA-0203/program-tests-final.log` |
| MySQL/Redis descartáveis | 69 PASS, zero falhas/skips; migrações e concorrência de consumo/revogação/auditoria | `.tmp/NA-0203/mysql-1795560414-74d6da/execution.json` |
| Cobertura dirigida de seis módulos novos | 159 testes PASS; statements97,38%, branches95,58%, funções96,61%, linhas99,49% | `.tmp/NA-0203/program-coverage/`, `program-coverage.log` |
| Chromium extensão regressão | 52 checks PASS | `.tmp/NA-0203/program-browser/result.json` |
| Chromium sites/E7/host | 28 checks PASS; popup real por XTest/Alt+Shift+V, manifesto inalterado | `.tmp/NA-0203/sites-browser/run-Li1SdN/result.json` |
| Portal sites HTTPS desktop/mobile | 20 checks em tema claro +20 em escuro; contraste e layout revistos | `.tmp/NA-0203/portal-visual-{light,dark}/result.json` |
| Administração HTTPS | 14 cenários PASS, 23 capturas, 8 propostas/aplicações; limpeza concluída | `.tmp/NA-0188/administration-8JHGFO/execution.json` |
| Cofre HTTPS e terminal | 19 cenários + fronteira HTTP +14 catálogo + terminal PASS; fontes estáveis, limpeza concluída | `.tmp/NA-0179/frontend-VfWaeW/execution.json` |
| Tipos | backend/frontend/extensão PASS; shared build PASS | `.tmp/NA-0203/program-*-types.log`, `program-shared.log` |
| Lint alterados | PASS, zero avisos | `.tmp/NA-0203/program-lint-final.log` |
| Manual | captura5 PASS, imagens revistas, 2 testes Node +18 Vitest PASS; cinco hashes atuais | `.tmp/NA-0203/program-manual-*.log` |
| Build local | `0.1.0`, build `88d56405f6f8`, `apps/extension/dist-local` | `.tmp/NA-0203/program-local-build.log` |
| Security scan | 42 fixtures revisadas, zero achados novos; Semgrep zero findings/erros | `.tmp/NA-0203/program-security-final/scan-summary.json` |
| Sonar | **BLOCKED**, exit1 no preflight; sem análise ou Quality Gate | `.tmp/NA-0203/program-sonar.log` |

Fingerprint final SQL: `c16bfe7d2b7a786cfb5ae292ce4a1105dd4f82b2b1993479932673e4d8a4f769`; fontes backend/shared/migrações/harness estáveis durante a execução, containers removidos. As primeiras rodadas SQL identificaram a CHECK de grants e tiveram alterações concorrentes de fonte; não são a evidência final.

Fingerprint final do ensaio E7: `0cb4940fc3af12d0d0d9a7cb1433aff8bbf0d8a933db325269cd70460e7e1a35`, estável. Verifica negação da origem externa antes do gesto e acesso ao documento após gesto, cadastro/edição, abertura JWE no worker e preenchimento real, nenhum submit, campos ocultos/iframe intactos, navegação antes do consumo recusada, host registrado sem login e URL `connect=1`. O backend HTTP desse ensaio é sintético; DPoP/autorização reais são cobertos pelos testes de serviço, e persistência/concorrência pelo MySQL. A página de destino do host é sintética: não é uma sessão SSH real.

Os 71 opt-in da chamada unitária correspondem aos 69 casos SQL executados separadamente e dois cenários HTTPS dos harnesses dedicados. Não somar execuções repetidas como testes novos. Cobertura dirigida não é cobertura de todo o repositório nem substitui Sonar. Nenhuma redução de threshold, exclusão de regra ou relaxamento de teste.

Fingerprint do harness frontend: `c33abeb6e3065780563fcb40ff3bee6aae353fdf0f7713067ca2051a310f6d15`, antes/depois iguais. Usa guards/serviço/bcrypt/TOTP/JWE reais com autoridade transacional sintética e transporte terminal simulado. Administração usa rotas/serviços reais, regras em memória e API portal simulada; o WebAuthn desse ensaio não homologa Windows Hello físico. Após ambos, apenas documentação e metadados editoriais do manual foram atualizados; test:manual e manual:check-reviewed repetidos PASS às 20:07 -03. O fingerprint não é apresentado como hash desses metadados posteriores.

Revisão independente estática: PASS_WITH_WARNINGS, sem novos bloqueios locais; ressalvas de escala de links/hosts, toggle off/on, Sonar e gates humanos. Ajustes finais de fillBusy/tema/input-props/artifactPath revisados; seletores de motivo mantêm texto exato e exigem elemento visível nas variantes responsivas (PASS). Revisor não executou os testes. Security scan acima precede os últimos ajustes de acessibilidade/harness; não representa novo scan posterior a esses ajustes. Baseline Gitleaks alterada somente por hashes de três fixtures revisadas individualmente, sem exclusão nova.

Limites de entrega: E7 desligado por padrão; pentest antes de senhas reais; Windows Hello físico requer homologação do usuário; Sonar depende do ambiente e tokens separados. Toggle off bloqueia enquanto desligado, mas off/on rápido não invalida definitivamente a operação: para invalidação imediata, revogar grant; usando apenas configuração, aguardar mais de 30 segundos após desligamento efetivo em todas as instâncias. Sem commit/push/PR/deploy/publicação.
