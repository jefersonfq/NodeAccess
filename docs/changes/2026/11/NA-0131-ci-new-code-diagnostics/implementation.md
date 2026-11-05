# NA-0131 — Registro da implementação

## Pedido e objetivo

Diagnosticar ocorrência nova do CI real antes de cleanup.

## Implementação

Base8dae9b49a8dab89b9c0a7c4fcb4a29a1d401662d; plano antes de código. Contrato oficial API confirmado via raiz.

## Validação

Planned: contratos e ensaio real isolado ou integração da raiz.

## Recuperação

Reverter frente isolada; sem persistência de raw export.

## Pendências

Testes, revisão, publicação/gates integrados; planilha e índices coordenados pela raiz.

## Diário de interações

### 2026-11-03T22:21:40+00:00 — Plano aprovado

Raiz autorizou diagnóstico sanitizado para new_violations=1 do ensaio8dae. Não aceitar baseline como exceção de gate. Nova branch isolada, sem alterar checkout da integração.

### 2026-11-03T22:26:21+00:00 — Contratos e reprodução

Implementada paginação com validação e projeção sanitizada; guards e gates preservados. Ran:154 testes antes da separação natural de responsabilidades;40focais e lint após separação PASS. Raiz revisou lógica e reproduziu40contratos. Ensaio real8dae em curso com helperWIP identificado por SHA256; não declarar SHA final validado por ele. Próximo: capturar ocorrência e cleanup, revisão final e checkpoint.

### 2026-11-03T22:34:33+00:00 — Diagnóstico real e revisão

Ran: duas análises reais basef4/candidato8dae, configuração efetiva idêntica verificada, cobertura80.1 e gateERROR/new_violations1. Identificada S4036 em analyze.mjs:46, assinatura já revisada; não usada como waiver. Cleanup completo dos containers/worktree/logs. Helper do ensaio era snapshot anterior à separação por responsabilidade; hashes e limite explícitos em rehearsal.json. Root reviu delta final PASS_WITH_WARNINGS. Próximo: checkpoint local, integração e correção da chamada PATH em frente separada; publicação e planilha coordenadas pela raiz.
