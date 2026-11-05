# NA-0116 — Evidências

Base: `47f06b51e693d91f5ed724b7b86e5362af75bc35`. Execução em `/tmp/nodeaccess-NA-0116`, não no checkout canônico.

| Verificação | Resultado | Evidência |
|---|---|---|
| Node.test ci-* | 42 PASS, nenhum skip | `/tmp/NA0116-all-tests-final.log` |
| ESLint sete arquivos alterados | zero erros/warnings | `/tmp/NA0116-eslint-final.log` |
| Leitor real @sonar/scan5.0.2 | reproduz ausência de sonar.tests antes e igualdade após materialização | `reader-evidence.json` |
| Revisão independente | parser/hash/materialização e guardas de escopo aprovados; compatibilidade real confirmada pelo ensaio | revisão tooling, `/tmp/na0116-scope-independent.log` |
| git diff --check | PASS | worktree da frente |
| Scanner + servidor real | PASS: três contextos iguais, gate100% OK e42,9% ERROR; ignoredConditions=false | `rehearsal-evidence.json` |

Duas invocações anteriores não chegaram à análise: caminho npm inexistente e pacote npm antigo sem semver. Ambas finalizaram cleanup. A terceira usa npm11.12.1 validado antes da execução. Nenhum resultado dessas falhas foi contado como aprovação do scanner.

O contrato de arquivo é intencionalmente restrito às propriedades atuais: mudanças futuras em sintaxe ou escopo exigem ampliar o parser com testes. Contexto bruto da API pode conter segredos; somente propriedades permitidas e hash são exportados. Node_modules HEAD não é compartilhado com a base: os tsconfigs observados usam extends locais e não houve evidência de falha de resolução no ensaio anterior. Fixture real não substitui a análise completa do produto integrado ou homologação humana.
