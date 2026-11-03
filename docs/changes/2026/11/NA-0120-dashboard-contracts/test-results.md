# NA-0120 — Resultados

Base fb2eb5c9ea0a9ed878c7b76d65ef7a39abcbd6dd. Testes executados no worktree /tmp/nodeaccess-NA-0120.

| Verificação | Resultado | Evidência |
|---|---|---|
| Contratos SSR Vue |15PASS|/tmp/NA0120-tests.log|
| ESLint teste novo |0erros/warnings|/tmp/NA0120-eslint.log|
| vue-tsc frontend |PASS|/tmp/NA0120-typecheck-final.log|
| Cobertura oficial focal |236/410statements,141/231funções|/tmp/NA0120-coverage-final/coverage-final.json|
| Diff original apenas Dashboard |124/210unidades cobertas;86restantes|coverage-evidence.json|
| Revisão independente tooling |PASS_WITH_WARNINGS;15reproduzidos|/tmp/na0120-independent.log|

Sem alteração de produto, configuração de instrumentação, denominador, limiares ou baseline. A carga é explicitamente chamada no setup wrapper: SSR não executa onMounted. Stubs Naive renderizam slots sem reproduzir visibilidade/foco reais; asserções do modal verificam show e título. Contratos de cartões nativos invocam handlers reais de setup; não equivalem a eventos DOM. Browser complementar NA0118/NA0119 foi executado separadamente, com API simulada,6cenários/4labels/7açõesmobile/0pageerrors, e não demonstra backend real. Nenhuma captura nova necessária para mudança exclusiva de testes.
