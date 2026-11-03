# NA-0135 — Registro da implementação

## Pedido e objetivo

Corrigir uso de Chromium de sistema pelo coletor em GitHubCI.

## Implementação

Base b76faaec6031f3ebed1372a65dcede08f930cde0; plano antes das alterações.

## Validação

Planned: contratos antes/depois e cinco harnesses com Chromium1234 local explícito.

## Recuperação

Branch isolada; reversão sem produto ou baseline.

## Pendências

Prova CI final requer integração; local não possui Chromium1248. Planilha/índices coordenados pela raiz.

## Diário de interações

### 2026-11-03T22:56:58+00:00 — Diagnóstico e plano

Confirmada ausência de propagação default no coletor e fallbacks /usr/bin nos harnesses terminal/platform. Não alterar harnesses ou timeouts. Instalação local1248 ausente, systembin existe; registrar limites honestamente e validar override1234 real.

### 2026-11-03T22:59:12+00:00 — Regressão e correção mínima

Ran: antes2defaultFAIL/1overridePASS; após17contratosPASS, lint0 e negativoPlaywrightreal com caminho ausente. Correção resolve Chromiumuma vez e propaga ambas variáveis para cincofilhos. RootreviewfontePASS_WITH_WARNINGS; reproduçãoindependente e cincoharnessesreais emcurso. Causa específica do incidenteCI inferida: rawlogausente impede confirmação retroativa. Nenhum produto ou gate tocado.

### 2026-11-03T23:00:42+00:00 — Ensaio real e revisão independente

Ran: cincoharnesses reais PASS, todos exit0 e semtimeout, servidor encerrado (browser-summary.json). Chromium1234 explícito; não afirmar execução1248. Root reproduziu17/17contratos e revisou delta mínimo PASS_WITH_WARNINGS (/tmp/na0135-root-review.log). Scanners/gates/denominadores intactos. Próximo: checkpoint, integração com diagnósticoNA0134 e rerunCI real; planilha e publicação pela raiz.
