# NA-0119 — Registro da implementação

## Pedido e objetivo

Corrigir associação real dos rótulos e corte das ações no diagnóstico, reproduzidos por NA0118.

## Implementação

Base SHA fb2eb5c9ea0a9ed878c7b76d65ef7a39abcbd6dd; branch fix/NA-0119-20261103-diagnostic-accessibility, worktree /tmp/nodeaccess-NA-0119. Skill frontend-full-cycle-agent aplicada. Nenhuma edição em NA0118/NA0093.

## Validação

Evidência anterior /tmp/NA0118-review/report.json: sessão id vazio/labels[]. Screenshot mobile390 mostra título comprimido e ações cortadas. Fontes instaladas Naive Input.mjs/Selection.mjs confirmam merge de inputProps no input nativo.

## Recuperação

Correção localizada de atributos/CSS. Sem mudança API, sessão, websocket ou área útil do terminal.

## Pendências

Integração/publicação e homologação humana; checkpoint local autorizado e documentação canônica. Workbook/índice coordenados pelo root.

## Diário de interações

### 2026-11-03T17:52:30-03:00 — Escopo confirmado

Root restringiu ajuste ao diagnóstico e auditoria do lote original44. DiagnosticRunDetail não consta entre44 Web:S6853; não há evidência para atribuir o defeito à correção NA0087. Será registrado como preexistente observado pelo novo teste.

### 2026-11-03T17:59:55-03:00 — Correção, UX e validação real

Único arquivo de produto: DiagnosticRunDetailView.vue. IDs dos três NInput e do NSelect migrados para input-props, propagados ao controle nativo conforme API instalada. detail-actions/report-actions usam flex wrap/gap8; header fica em coluna em640px e ai-summary-header permite quebra local. Mantidos CTA/texto/estados e regras de negócio.

Before reproduzido pelo harness real NA0118: FAIL Native control is missing label: ID da sessão. Depois:6 cenários PASS, IDs/labels dos3inputs corretos e NSelect encontrado pelo rótulo. Teste fortalecido clicou nos4 labels e conferiu label.control===document.activeElement. Sete ações mobile têm left>=0/right<=390; maior right338,42px. Desktop1440/mobile390 sem overflow horizontal e0 pageErrors. Falha/correção/validação de IDs, erro/sucesso de gravação, comparação, resumo, confirmação Jira e navegação dashboard exercitados com API simulada.

Prints desktop/mobile inspecionados: título deixa de ser comprimido, controles ficam visíveis com quebra de linha previsível; sem CSS global e sem impacto na área útil do terminal. O scroll vertical da aplicação é esperado; screenshot de viewport não equivale a toda página. Nenhum teste PTY necessário, pois não houve alteração de terminal/resize/transporte.

Auditoria lote anterior:44 controles Naive reais +10 nativos PASS (nome/foco), source-controls.json mostra0 casos wrapperIdOnly entre44. O harness monta componentes Naive verdadeiros a partir das props/markup selecionadas; é uma auditoria de controles isolados, não prova44 fluxos completos. Nenhum outro arquivo de produto precisou alteração.

ESLint focal inicialmente apontou4 warnings de ordem dos atributos; corrigidos e lint final exit0 sem avisos. Frontend vue-tsc --noEmit PASS. Reviewer frontend reproduziu6cenários/4focos/7limites e revisou screenshot: PASS_WITH_WARNINGS (API simulada não prova backend). Root também reproduziu6cenários/4focos/7limites e revisou prints em /tmp/NA0118-final-review, sem bloqueador.

Evidências executadas contra Vite isolado5196 desta branch, APIreal bloqueada; harness pertence à frente NA0118 e deve ser integrado junto com esta alteração. Manifesto do manual piloto não mapeia DiagnosticRunDetail, e procedimento não mudou. Workbook/índice global continuam coordenados pelo root.
