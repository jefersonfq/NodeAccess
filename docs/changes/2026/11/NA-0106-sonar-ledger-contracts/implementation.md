# NA-0106 — Registro de implementação

## Pedido e objetivo

Validar CLI e integridade do catálogo na cobertura do código novo autorizada.

## Implementação

SHA base: 4a77f7139600e70aa612e753418978d9b31b10ae. Branch `test/NA-0106-20261103-sonar-ledger-contracts`. Somente novo arquivo `tools/sonarqube/ledger-contracts.test.mjs`.

Testes executam CLI original em subprocesso Node e diretório descartável; verificam formato de baseline, rejeição de decisões duplicadas, estabilidade de IDs, classificação por domínio, escrita de JSON/CSV/HTML, ausência versus não reanalisado, omissão de mensagens brutas e escape de HTML/fórmulas CSV. Não alteram catálogo real ou baseline aceito.

## Validação

Ran: 22 testes aprovados (16 novos e 6 existentes). Revisão independente leu contratos e reproduziu os 22: PASS. Node --test coleta automaticamente os novos casos e subprocessos herdam NODE_V8_COVERAGE na rotina de cobertura.

Limite: HTML é validado como string, não prova DOM/navegador. O ensaio table-review é complementar na frente de coleta browser. Não foi importado crédito externo nem alterado código para melhorar nota.

## Recuperação

Reverter novo teste. Diretórios temporários são removidos em finally; catálogo real permanece intacto.

## Pendências

Integrar NA-0093 e medir contribuição real no LCOV consolidado.

## Diário de interações

### 2026-11-03T19:50:00+00:00 — Lacuna do catálogo

Coleta integrada identificou 65 unidades descobertas no diff do ledger. Criados testes de comportamento das validações e CLI.

### 2026-11-03T19:52:11+00:00 — Revisão concluída

22 casos aprovados e revisão independente reproduzida. Próximo passo: integração e medição real, mantendo limites e baseline.
