# NA-0123 — Resultados

Base6af97acad7b1c34de86ba4ed77b600607d96a8c7, execução em /tmp/nodeaccess-NA-0123.

| Verificação | Resultado | Evidência |
|---|---|---|
| Vitest SFC SSR real |14PASS,2arquivos|/tmp/NA0123-tests.log|
| ESLint |0erros/warnings|/tmp/NA0123-eslint.log|
| vue-tsc frontend |PASS|/tmp/NA0123-typecheck.log|
| Diff Settings |0/53unidades|coverage-evidence.json|
| Diff Tunnel |48/82unidades|coverage-evidence.json|
| Revisão coordenação |PASS_WITH_WARNINGS|implementation.md|

Sem alteração de produto, configuração, exclusões ou limiares. Settings executa load explícito, não onMounted; Tunnel executa watcher immediate SSR original, sem presença de fundo. Handlers reais são invocados diretamente, Naive/children/serviços simulados. HTML SSR e feedback não provam eventos DOM, CSS, foco, backend ou SSH. Não houve nova captura nem teste PTY porque somente testes foram adicionados. Ganho integrado depende da união posterior; coleta focal não significa gate global aprovado.
