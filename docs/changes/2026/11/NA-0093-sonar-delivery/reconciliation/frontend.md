# Reconciliação técnica frontend — 80 propostas FP

Data UTC: 2026-11-04T14:06:13.276298+00:00. Checkout: `/tmp/nodeaccess-NA-0093`; HEAD Git registrado: `ee436402db8bcce7fab4378d6ba28c1673b282b5`. Fontes integradas possuem deltas de trabalho: a identidade efetiva é o SHA-256 de cada arquivo no JSON, não a alegação de que HEAD contém esses deltas.

**Resultado: 63 technical_fp_supported; 17 needs_reassessment.** Destes 17, seis exigem correção/reconsideração da classificação e onze tiveram o trecho removido por NA0148, devendo ser reconciliados pelo scanner. Cinco S2871 tratados em NA0150 estão fora destes 80. Nenhuma transição Sonar, mudança de baseline, produto ou limiar foi efetuada.

Foram consultadas as dez definições reais instaladas por GET autenticado, com conteúdo descriptionSections preservado em `/tmp/NA0093-frontend-rule-definitions.json`; nenhuma credencial foi persistida. Reutilizada evidência DOM individual anterior somente para fragmentos preservados; não realizada nova homologação humana, leitor de tela ou bateria browser.

## Critérios e limites

- Labels: controles CSS hidden não participam da árvore de acessibilidade; tabindex=-1 sozinho não seria justificativa. Dez labels Naive possuem evidência DOM individual de nome/foco/associação.
- Tabindex: região de importação possui altura máxima/rolagem real; separadores possuem papel e setas operantes. Quatro pre MCP não demonstram essa função. [Critério W3C de rolagem por teclado](https://www.w3.org/WAI/standards-guidelines/act/rules/0ssw9k/).
- S6324: dezesseis controles restantes são bytes deliberados do protocolo terminal; onze ocorrências removidas não devem receber transição FP por conveniência.
- S1313: seis literais são exemplos editáveis/exportáveis, não endpoints operacionais. IP privado não é exceção automática; RFC5737 pode melhorar exemplos futuramente.
- Secrets: quatro exemplos contêm placeholder não resolvido, não senha. S2245: dois IDs de correlação não autorizam acesso. S7767: wrap int32 é operação intencional, diferente de truncamento decimal.
- S2310 e S8786: finalidade funcional correta/entrada curta não invalida regra de clareza ou estrutura matemática. São propostas de correção, não FP.

## Proposta NA0152 — aguardando GO

Base indicada pela raiz: `02e7521`; conferir SHA completo ao criar a branch. Escopo mínimo: quatro tabindex estáticos em McpAgentSetup (SQ0115–0118), atribuição simples de índice no parser (SQ0158), formatação ISO sem regex não linear (SQ0161). Nenhuma edição autorizada por este relatório.

1. Remover apenas tabindex dos quatro pre estáticos, preservando conteúdo, nomes, Copy, details, estilos e regiões realmente roláveis. Verificar Tab/Shift+Tab/Copy/details em desktop/mobile; capturas antes/depois e comparação de geometria.
2. Expressar o avanço lexical com incremento permitido ou cursor equivalente mínimo. Reproduzir suíte de autocomplete e casos diferenciais de separadores simples/duplos, aspas, escapes, Unicode e cursor parcial; sem modificar contratos de shell.
3. Remover fração do timestamp com operação de string determinística, preservando exatamente formato/UTC/sufixo Z. Testes diferenciais de datas/milissegundos e export/nome gerado; não alterar entradas/limiares.
4. Lint/tipos/testes focais, revisão independente e scanner integrado depois do checkpoint. Sem alteração da área útil/transporte terminal; confirmar impacto antes de decidir necessidade de bateria terminal. Manual somente se procedimento mapeado mudar. Homologação humana não inferida.

## Ocorrências

| ID | Regra | Linha atual | Decisão | Categoria |
|---|---|---|---|---|
| SQ-0100 | Web:InputWithoutLabelCheck | apps/frontend/src/components/FileManager.vue:685 | technical_fp_supported | rule_intent_not_violated |
| SQ-0103 | typescript:S1313 | apps/frontend/src/components/ImportHostsModal.vue:665 | technical_fp_supported | rule_intent_not_violated |
| SQ-0104 | Web:InputWithoutLabelCheck | apps/frontend/src/components/ImportHostsModal.vue:1924 | technical_fp_supported | rule_intent_not_violated |
| SQ-0106 | Web:InputWithoutLabelCheck | apps/frontend/src/components/ImportHostsModal.vue:2078 | technical_fp_supported | rule_intent_not_violated |
| SQ-0107 | Web:InputWithoutLabelCheck | apps/frontend/src/components/ImportHostsModal.vue:2111 | technical_fp_supported | rule_intent_not_violated |
| SQ-0108 | Web:InputWithoutLabelCheck | apps/frontend/src/components/ImportHostsModal.vue:2260 | technical_fp_supported | rule_intent_not_violated |
| SQ-0109 | Web:S6845 | apps/frontend/src/components/ImportHostsModal.vue:2401 | technical_fp_supported | rule_intent_not_violated |
| SQ-0111 | Web:S6853 | apps/frontend/src/components/integrations/TenantAuthPolicyCard.vue:310 | technical_fp_supported | rule_intent_not_violated |
| SQ-0112 | Web:S6853 | apps/frontend/src/components/integrations/TenantAuthPolicyCard.vue:315 | technical_fp_supported | rule_intent_not_violated |
| SQ-0113 | Web:S6853 | apps/frontend/src/components/integrations/TenantAuthPolicyCard.vue:320 | technical_fp_supported | rule_intent_not_violated |
| SQ-0114 | Web:S6853 | apps/frontend/src/components/integrations/TenantAuthPolicyCard.vue:325 | technical_fp_supported | rule_intent_not_violated |
| SQ-0115 | Web:S6845 | apps/frontend/src/components/mcp/McpAgentSetup.vue:133 | needs_reassessment | rule_applies_correction_proposed |
| SQ-0116 | Web:S6845 | apps/frontend/src/components/mcp/McpAgentSetup.vue:150 | needs_reassessment | rule_applies_correction_proposed |
| SQ-0117 | Web:S6845 | apps/frontend/src/components/mcp/McpAgentSetup.vue:166 | needs_reassessment | rule_applies_correction_proposed |
| SQ-0118 | Web:S6845 | apps/frontend/src/components/mcp/McpAgentSetup.vue:195 | needs_reassessment | rule_applies_correction_proposed |
| SQ-0119 | Web:S6853 | apps/frontend/src/components/platform/TenantLicenseEditor.vue:176 | technical_fp_supported | rule_intent_not_violated |
| SQ-0122 | Web:S6853 | apps/frontend/src/components/snippets/MacroStepEditor.vue:161 | technical_fp_supported | rule_intent_not_violated |
| SQ-0123 | Web:S6853 | apps/frontend/src/components/snippets/MacroStepEditor.vue:173 | technical_fp_supported | rule_intent_not_violated |
| SQ-0124 | Web:S6853 | apps/frontend/src/components/snippets/SnippetCommandEditor.vue:74 | technical_fp_supported | rule_intent_not_violated |
| SQ-0125 | Web:InputWithoutLabelCheck | apps/frontend/src/components/snippets/SnippetTransfer.vue:44 | technical_fp_supported | rule_intent_not_violated |
| SQ-0130 | typescript:S7767 | apps/frontend/src/components/UserAvatar.vue:42 | technical_fp_supported | rule_intent_not_violated |
| SQ-0132 | secrets:S6697 | apps/frontend/src/locales/en-BACKUP-UX.json:1522 | technical_fp_supported | rule_intent_not_violated |
| SQ-0133 | secrets:S6697 | apps/frontend/src/locales/en-NOTE-JEFF.json:1247 | technical_fp_supported | rule_intent_not_violated |
| SQ-0134 | secrets:S6697 | apps/frontend/src/locales/pt-BR-BACKUP-UX.json:1522 | technical_fp_supported | rule_intent_not_violated |
| SQ-0135 | secrets:S6697 | apps/frontend/src/locales/pt-BR-NOTE-JEFF.json:1247 | technical_fp_supported | rule_intent_not_violated |
| SQ-0146 | typescript:S2245 | apps/frontend/src/services/service-cache.ts:94 | technical_fp_supported | rule_intent_not_violated |
| SQ-0149 | typescript:S6324 | apps/frontend/src/services/terminal-input-model.service.ts:49 | technical_fp_supported | rule_intent_not_violated |
| SQ-0150 | typescript:S6324 | apps/frontend/src/services/terminal-osc-command.service.ts:5 | technical_fp_supported | rule_intent_not_violated |
| SQ-0151 | typescript:S6324 | apps/frontend/src/services/terminal-osc-command.service.ts:5 | technical_fp_supported | rule_intent_not_violated |
| SQ-0152 | typescript:S6324 | apps/frontend/src/services/terminal-osc-directory.service.ts:5 | technical_fp_supported | rule_intent_not_violated |
| SQ-0153 | typescript:S6324 | apps/frontend/src/services/terminal-osc-directory.service.ts:5 | technical_fp_supported | rule_intent_not_violated |
| SQ-0154 | typescript:S6324 | apps/frontend/src/services/terminal-osc-directory.service.ts:5 | technical_fp_supported | rule_intent_not_violated |
| SQ-0155 | typescript:S6324 | apps/frontend/src/services/terminal-osc-directory.service.ts:5 | technical_fp_supported | rule_intent_not_violated |
| SQ-0156 | typescript:S6324 | apps/frontend/src/services/terminal-osc-directory.service.ts:5 | technical_fp_supported | rule_intent_not_violated |
| SQ-0157 | typescript:S6324 | apps/frontend/src/services/terminal-osc-directory.service.ts:5 | technical_fp_supported | rule_intent_not_violated |
| SQ-0158 | typescript:S2310 | apps/frontend/src/services/terminal-path-autocomplete.service.ts:212 | needs_reassessment | rule_applies_correction_proposed |
| SQ-0161 | typescript:S8786 | apps/frontend/src/views/admin/HighAvailabilityView.vue:320 | needs_reassessment | rule_applies_correction_proposed |
| SQ-0165 | Web:InputWithoutLabelCheck | apps/frontend/src/views/admin/IntegrationsView.vue:3581 | technical_fp_supported | rule_intent_not_violated |
| SQ-0170 | typescript:S1313 | apps/frontend/src/views/admin/NativeSshGatewayView.vue:37 | technical_fp_supported | rule_intent_not_violated |
| SQ-0171 | typescript:S1313 | apps/frontend/src/views/admin/NativeSshGatewayView.vue:61 | technical_fp_supported | rule_intent_not_violated |
| SQ-0172 | typescript:S1313 | apps/frontend/src/views/admin/NativeSshGatewayView.vue:65 | technical_fp_supported | rule_intent_not_violated |
| SQ-0173 | typescript:S1313 | apps/frontend/src/views/admin/NativeSshGatewayView.vue:70 | technical_fp_supported | rule_intent_not_violated |
| SQ-0174 | typescript:S1313 | apps/frontend/src/views/admin/NativeSshGatewayView.vue:75 | technical_fp_supported | rule_intent_not_violated |
| SQ-0175 | Web:S6853 | apps/frontend/src/views/admin/NativeSshGatewayView.vue:365 | technical_fp_supported | rule_intent_not_violated |
| SQ-0176 | Web:S6853 | apps/frontend/src/views/admin/NativeSshGatewayView.vue:369 | technical_fp_supported | rule_intent_not_violated |
| SQ-0187 | typescript:S6324 | apps/frontend/src/views/admin/SessionAuditDetailView.vue:803 | technical_fp_supported | rule_intent_not_violated |
| SQ-0188 | typescript:S6324 | apps/frontend/src/views/admin/SessionAuditDetailView.vue:803 | technical_fp_supported | rule_intent_not_violated |
| SQ-0189 | typescript:S6324 | apps/frontend/src/views/admin/SessionAuditDetailView.vue:803 | technical_fp_supported | rule_intent_not_violated |
| SQ-0190 | typescript:S6324 | apps/frontend/src/views/admin/SessionAuditDetailView.vue:803 | technical_fp_supported | rule_intent_not_violated |
| SQ-0191 | typescript:S6324 | apps/frontend/src/views/admin/SessionAuditDetailView.vue:removida | needs_reassessment | source_removed_pending_scanner |
| SQ-0192 | typescript:S6324 | apps/frontend/src/views/admin/SessionAuditDetailView.vue:removida | needs_reassessment | source_removed_pending_scanner |
| SQ-0193 | typescript:S6324 | apps/frontend/src/views/admin/SessionAuditDetailView.vue:removida | needs_reassessment | source_removed_pending_scanner |
| SQ-0194 | typescript:S6324 | apps/frontend/src/views/admin/SessionAuditDetailView.vue:806 | technical_fp_supported | rule_intent_not_violated |
| SQ-0195 | typescript:S6324 | apps/frontend/src/views/admin/SessionAuditDetailView.vue:807 | technical_fp_supported | rule_intent_not_violated |
| SQ-0196 | typescript:S6324 | apps/frontend/src/views/admin/SessionAuditDetailView.vue:808 | technical_fp_supported | rule_intent_not_violated |
| SQ-0199 | typescript:S6324 | apps/frontend/src/views/admin/SessionAuditDetailView.vue:removida | needs_reassessment | source_removed_pending_scanner |
| SQ-0200 | typescript:S6324 | apps/frontend/src/views/admin/SessionAuditDetailView.vue:removida | needs_reassessment | source_removed_pending_scanner |
| SQ-0201 | typescript:S6324 | apps/frontend/src/views/admin/SessionAuditDetailView.vue:removida | needs_reassessment | source_removed_pending_scanner |
| SQ-0202 | typescript:S6324 | apps/frontend/src/views/admin/SessionAuditDetailView.vue:removida | needs_reassessment | source_removed_pending_scanner |
| SQ-0203 | typescript:S6324 | apps/frontend/src/views/admin/SessionAuditDetailView.vue:removida | needs_reassessment | source_removed_pending_scanner |
| SQ-0204 | typescript:S6324 | apps/frontend/src/views/admin/SessionAuditDetailView.vue:removida | needs_reassessment | source_removed_pending_scanner |
| SQ-0205 | typescript:S6324 | apps/frontend/src/views/admin/SessionAuditDetailView.vue:removida | needs_reassessment | source_removed_pending_scanner |
| SQ-0232 | Web:InputWithoutLabelCheck | apps/frontend/src/views/admin/WebhooksView.vue:1078 | technical_fp_supported | rule_intent_not_violated |
| SQ-0233 | Web:InputWithoutLabelCheck | apps/frontend/src/views/admin/WebhooksView.vue:1079 | technical_fp_supported | rule_intent_not_violated |
| SQ-0241 | Web:InputWithoutLabelCheck | apps/frontend/src/views/HostsView-BACKUP-UX.vue:2264 | technical_fp_supported | rule_intent_not_violated |
| SQ-0242 | Web:InputWithoutLabelCheck | apps/frontend/src/views/HostsView-BACKUP-UX.vue:2265 | technical_fp_supported | rule_intent_not_violated |
| SQ-0243 | Web:InputWithoutLabelCheck | apps/frontend/src/views/HostsView-NOTE-JEFF.vue:2007 | technical_fp_supported | rule_intent_not_violated |
| SQ-0244 | Web:InputWithoutLabelCheck | apps/frontend/src/views/HostsView-NOTE-JEFF.vue:2008 | technical_fp_supported | rule_intent_not_violated |
| SQ-0245 | typescript:S6324 | apps/frontend/src/views/HostsView.vue:removida | needs_reassessment | source_removed_pending_scanner |
| SQ-0246 | Web:InputWithoutLabelCheck | apps/frontend/src/views/HostsView.vue:7465 | technical_fp_supported | rule_intent_not_violated |
| SQ-0247 | Web:InputWithoutLabelCheck | apps/frontend/src/views/PemKeysView.vue:199 | technical_fp_supported | rule_intent_not_violated |
| SQ-0248 | Web:InputWithoutLabelCheck | apps/frontend/src/views/ProfileView.vue:286 | technical_fp_supported | rule_intent_not_violated |
| SQ-0249 | Web:InputWithoutLabelCheck | apps/frontend/src/views/SecretsView.vue:483 | technical_fp_supported | rule_intent_not_violated |
| SQ-0250 | Web:InputWithoutLabelCheck | apps/frontend/src/views/SecretsView.vue:484 | technical_fp_supported | rule_intent_not_violated |
| SQ-0251 | Web:InputWithoutLabelCheck | apps/frontend/src/views/SecretsView.vue:540 | technical_fp_supported | rule_intent_not_violated |
| SQ-0252 | Web:InputWithoutLabelCheck | apps/frontend/src/views/SecretsView.vue:541 | technical_fp_supported | rule_intent_not_violated |
| SQ-0258 | typescript:S2245 | apps/frontend/src/views/TerminalView.vue:1893 | technical_fp_supported | rule_intent_not_violated |
| SQ-0259 | Web:S6845 | apps/frontend/src/views/TerminalView.vue:4391 | technical_fp_supported | rule_intent_not_violated |
| SQ-0260 | Web:S6845 | apps/frontend/src/views/TerminalView.vue:4408 | technical_fp_supported | rule_intent_not_violated |
| SQ-0262 | Web:InputWithoutLabelCheck | apps/frontend/src/views/TerminalView.vue:6010 | technical_fp_supported | rule_intent_not_violated |

Os motivos, evidências, validações executadas, limites e hashes individuais estão em `/tmp/NA0093-frontend-fp-reconciliation.json`. Proposta documental privada para a raiz consolidar no plano canônico; não modifica a árvore congelada.
