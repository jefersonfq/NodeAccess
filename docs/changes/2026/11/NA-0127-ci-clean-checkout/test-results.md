# NA-0127 — Resultados

Execução no worktree /tmp/nodeaccess-NA-0127 e clone privado /tmp/NA0127-ci-repro; checkoutNA0093 não alterado.

| Check | Resultado | Evidência |
|---|---|---|
| npmci antes |Sóbinmode100644→100755;bytesiguais|reproduction-evidence.json|
| Guarda real antes |Rejeição antesDocker|implementation.md|
| npmci após |PASS;trackedstatusvazio,filemode=true|/tmp/NA0127-npm-ci-after.log|
| Prisma generate |PASS|/tmp/NA0127-prisma.log|
| Buildshared |PASS|/tmp/NA0127-shared-build.log|
| Sonartests clone original |135PASS|/tmp/NA0127-repro-sonar-tests.log|
| Sonartests comregressão |136PASS|/tmp/NA0127-sonar-tests.log|
| ESLint teste |0erros/warnings|/tmp/NA0127-eslint.log|
| Revisão independente |PASS,negativo1/1|implementation.md|

Correção somente modoGit executável do bin; conteúdoSHAigual. Guarda limpa e todas comparações base/head preservadas. Reprodução local Node24.21.0/npm11.12.1; runnerGitHub usou npm11.19.0. Jobhosted ainda precisa reexecução após publicação. Nenhum pipelinePASS final inferido a partir destes checks.
