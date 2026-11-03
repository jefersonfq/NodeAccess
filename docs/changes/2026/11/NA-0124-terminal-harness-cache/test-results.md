# NA-0124 — Resultados

Base20b169ed488ad652adad101c5f41a6779ee1a447. Execução em /tmp/nodeaccess-NA-0124.

| Check | Resultado | Evidência |
|---|---|---|
| Contratos Node |4PASS, negativos0/2/semcache|/tmp/NA0124-tests.log|
| ESLint |0erros/warnings|/tmp/NA0124-eslint.log|
| Terminal completo |PASS;alvo/var3→4|browser-evidence.json|
| Layout/autocomplete |desktop/mobile contidos,cursor livre,0anomalias|screenshots/ e browser-evidence.json|
| Revisão independente raiz |PASS_WITH_WARNINGS,4reproduzidos|/tmp/na0124-independent.log|

Falha anterior preservada no log privado integrado coverage/browser/terminal.log. Regressão reproduzida deterministicamente no contrato: lookup órfão + refresh do alvo soma2 e falsamente falhava antes; lookup órfão sem refresh soma1 e falsamente passava antes. Nova asserção distingue os dois. O ensaio completo usa WebSocket/backend simulados, não SSH real. Não altera produto, timeout, gates ou denominador.
