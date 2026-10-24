---
change_id: NA-0057
title: Onboarding MCP por agente e transporte HTTP compatível
type: feature
status: ready-for-tests
created_at: 2026-10-13T16:03:32-03:00
base_branch: master
base_sha: 1755022aa2e8d884ddf295e3e2470acfdcb5ad24
branch: docs/NA-0057-20261013-mcp-onboarding-review
owner: jefersonfq
planner: codex
risk: medium
---

# NA-0057 — Avaliação do onboarding MCP

## Contexto e situação anterior
A tela `apps/frontend/src/views/admin/McpTokensView.vue` já oferece Conectar agente,
criação de tokens, perfis e teste somente leitura. O gerador em
`apps/frontend/src/services/mcp.service.ts` fornece comando Codex e um JSON genérico
reutilizado para Claude e Gemini. O usuário solicitou reavaliação e proposta de
configuração pronta para copiar e colar. A frente começou como análise e foi ampliada, com autorização explícita, para implementação e testes.

## Problema e objetivo
Determinar lacunas reais e propor onboarding por cliente, mantendo autorização,
escopo por host, expiração, revogação e auditoria existentes.

## Escopo
- Incluído: avaliação e implementação localizada do assistente por agente/shell,
  presets, proteção de segredo, probe completo e transporte HTTP stateless MCP;
  testes unitários, HTTP real e navegador, documentação e revisão independente.
- Excluído: OAuth, novos clientes além dos três CLI, execução SSH, alteração de
  permissões/policies, produção e mudanças no banco. Nenhuma configuração real
  do agente do usuário será sobrescrita; testes usam ambientes descartáveis.

## Achados e prioridade

1. **Alta — configuração específica por cliente.** O mesmo `genericHttpConfig`
   usa `transport: streamable_http` e `url`, sem contêiner `mcpServers`. Claude Code
   documenta `mcpServers.<nome>.type: http`; Gemini CLI usa `httpUrl` para Streamable
   HTTP, enquanto `url` seleciona SSE. Os botões atuais sugerem configuração pronta,
   mas entregam apenas referência genérica. Codex já usa variável de ambiente para
   o Bearer; acrescentar alternativa TOML e instruções de destino.
2. **Alta — completar e testar transporte MCP.** `mcp.service.ts:handleJsonRpc`
   não trata `notifications/initialized` nem `ping`; o default rejeita métodos.
   `mcp.controller.ts:jsonRpc` transforma erro em envelope com `id: null` para uma
   notificação. A especificação do transporte exige 202 sem corpo ao aceitar
   notificações. Avaliar também GET/405, Accept, versão e Origin em conjunto com
   controles globais antes de declarar compatibilidade Streamable HTTP completa.
   A ausência de sessão persistente/SSE, isoladamente, não exige reescrever o servidor.
3. **Alta — evitar falso sucesso no teste.** `runMcpReadOnlyProbe` não envia
   initialized, não negocia Accept e verifica apenas presença de result/ausência de
   error; um resultado de ferramenta `isError: true` pode parecer aprovado. Os testes
   de onboarding usam respostas simuladas, não certificam conexão dos clientes reais.
4. **Média — fluxo curto, específico ao agente.** Hoje há vários blocos e os scripts
   de iniciar agente terminam em `codex`, inclusive no guia que apresenta outros
   clientes. Selecionar cliente e shell antes de mostrar comandos; indicar arquivo,
   escopo e como mesclar sem sobrescrever servidores já cadastrados.
5. **Média — endereço e credencial.** A URL deriva de `window.location.origin`.
   Funciona quando o agente alcança essa origem, mas localhost, WSL/container e
   agentes remotos exigem orientação/URL confirmada. Distinguir teste do navegador
   de conexão real do agente. Tokens antigos não são recuperáveis; o probe atual
   só funciona após criação. Uma entrada mascarada temporária permitiria validar
   token existente sem persistir segredo ou criar token novo desnecessariamente.
6. **Média — manutenção.** A view tem 2.148 linhas. Extrair somente o assistente de
   conexão e geradores puros, preservando tabela/perfis/permissões, evita ampliar
   acoplamento sem justificar refatoração integral.

## Proposta de experiência
Fluxo: escolher agente → escolher shell/escopo → credencial e permissões → copiar
configuração → testar conexão. Iniciar com Codex CLI, Claude Code e Gemini CLI.
Exibir somente o formato do cliente selecionado, endpoint e destino do arquivo,
com Copiar configuração e instrução curta para fornecer token por entrada oculta.
Não inserir segredo real no JSON baixado, URL, histórico do shell, logs ou storage.
Selecionar Consulta por padrão; ampliar acesso apenas com decisão explícita.
Mostrar autenticação, handshake, descoberta e consulta como resultados separados;
rede/TLS, token inválido/expirado, MCP desabilitado e permissão insuficiente devem
ter orientações distintas. Nenhum teste de onboarding deve abrir SSH ou escrever.
Confirmar escopos e acessibilidade por teclado, foco de modal, mobile, clipboard
indisponível, loading/erro/sucesso e retorno ao fluxo após criar token.

## Critérios de aceitação
- [x] Achados vinculados a código e documentação primária.
- [x] Suítes unitárias existentes executadas com resultado real.
- [x] Proposta e limites registrados, sem mudanças funcionais.
- [x] Presets corretos Codex CLI (TOML/comando), Claude Code e Gemini CLI (JSON),
  scripts por shell, destino/mescla e endpoint explicados sem segredo embutido.
- [x] Notificação initialized aceita com HTTP202 vazio; ping e contratos HTTP
  suportados com regressões negativas e autorização preservada.
- [x] Probe valida envelopes, IDs, initialized, catálogos e isError sem executar escrita.
- [x] UI valida estados, teclado, clipboard, mobile e segredo temporário sem persistência.
- [x] Transporte exercitado por cliente MCP em ambiente isolado; limitações de
  homologação de CLIs proprietários explicitamente registradas.

## Estratégia técnica
Primeira implementação proposta: corrigir protocolo e probe pontualmente; gerar
presets por cliente/shell e extrair componente do assistente. Usar URL validada e
quoting específico ao shell. Depois testar clientes com ambiente HOME isolado e
token descartável de consulta. OAuth/autorização pelo navegador, múltiplos perfis
e outros clientes ficam para frente separada, conforme demanda e compatibilidade.

## Riscos e mitigações
Transportes podem funcionar em clientes tolerantes e falhar em outros: exigir
handshake real e não apenas mocks. Templates mudam entre clientes: versionar matriz
de compatibilidade e exemplos. Segredos: manter fora dos snippets persistentes.
Não inferir ausência global de controles de Origin só pela leitura do módulo MCP.

## Matriz de testes e evidências
Ran: `npx vitest run apps/frontend/src/services/mcp.service.test.ts apps/backend/src/modules/mcp/mcp.service.test.ts apps/backend/src/modules/mcp/mcp.guard.test.ts apps/backend/src/modules/mcp/mcp-action-mode-policy.test.ts apps/backend/src/modules/mcp/mcp-audit-evidence.test.ts`.
Resultado: 5 arquivos, 32 testes aprovados; duração informada 589ms.
Skipped: navegador e cliente real nesta revisão; nada foi alterado em UI/transporte.
Planned: fixtures do protocolo, leitores de configuração/CLI, token expirado/revogado,
tenant/host restrito, falha de clipboard, foco e mobile após implementação.

## Baseline
Base: 1755022aa2e8d884ddf295e3e2470acfdcb5ad24; master limpa e igual a origin/master
após fetch. Testes passaram com aviso já conhecido do loader nativo futuro do Vite.

## Rollback ou recuperação
Mudanças locais no frontend e transporte HTTP MCP, sem migrations ou dependências
novas no produto. Recuperar código pela base/checkpoint NA-0056 em checkout separado.
Para reverter após eventual integração, usar PR de revert; nenhum dado exige downgrade.

## Mudanças de escopo e decisões
Reavaliação interpretada como análise e proposta, sem implementação funcional
automática. Compatibilidade Desktop/ChatGPT/Cursor/VS Code não foi certificada.

## Aprovação
GO_WITH_RISKS: usuário aprovou explicitamente implementação fim a fim da proposta
em 2026-10-13. Mudança localizada viável; preservar isolamento e controles existentes.
Revisão independente exigida antes da conclusão. Autorização desta etapa é para
implementar e testar; commit/publicação não são inferidos de fim a fim, conforme
regra de commit do projeto. Branch documental existente é mantida nesta frente
para preservar identidade e trabalho local, com intenção funcional registrada.

## Fontes oficiais consultadas em 2026-10-13
- https://learn.chatgpt.com/docs/extend/mcp?surface=cli
- https://code.claude.com/docs/en/mcp
- https://geminicli.com/docs/tools/mcp-server/
- https://modelcontextprotocol.io/specification/2025-06-18/basic/transports

## Implementação retomada em 2026-10-14
Usuário reafirmou autorização para implementar fim a fim e executar testes/simulações.
Estado de entrega: LOCAL_WIP; sem commit/publicação autorizados.
IN_PLAN: assistente extraído, presets, probe, contrato stateless HTTP, testes e guia operacional.
NECESSARY_CORRECTION: search_hosts também filtra allowedHostIds, pois é a consulta do
onboarding; normalização method/name/uri antes dos guards impede divergência com
dispatch; validação anterior ao AJV preserva IDs e rejeita coerção de tipos inválidos.
Proteções contra respostas antigas na criação de token e carregamentos após troca
de tenant preservam o isolamento no fluxo alterado. Revisão independente e harness
de navegador identificaram correções; nenhuma homologação humana foi inferida.
Origens permitidas vêm de APP_URL/APP_FRONTEND_URL; clientes sem Origin autenticam
normalmente. Accept explícito é exigido; exemplos JSON-RPC do guia foram atualizados.
Manual integrado: manifesto não mapeia Tokens MCP; atualizado OPERATIONS-mcp-lite.md.
SDK MCP instalado apenas em /tmp para teste opt-in, sem alteração de package/lock.

## Resultado local e limites
Critérios funcionais exercitados no WIP; ver test-results.md. Revisão independente
PASS_WITH_WARNINGS, sem homologação humana ou validação de commit publicado.
Estado ready-for-tests preserva o gate de checks em SHA futuro; os testes locais
não autorizam commit, publicação ou merge. Lint completo permanece com falhas
preexistentes comprovadas na base; arquivos novos e probe passam isoladamente.
Gemini CLI real validado com handshake e listagem em ambiente descartável; sessão
interativa com inferência ainda não homologada. Presets confrontados com documentação,
testes de formato e seleção no navegador.

## Refinamento UX autorizado — 2026-10-14T12:27:17-03:00
Usuário aprovou implementar fim a fim os cinco ajustes da revisão: preservar
endpoint ao criar/cancelar token; caminho de cadastro recomendado por agente;
menos ações/cards concorrentes na tela principal; resultado do teste com destino
explícito e próximo passo; guia mais curto em mobile. Manter segredos temporários,
limpeza no fechamento/tenant e probe same-origin. Não alterar permissões/backend.
Critérios adicionais: endpoint persiste no retorno e é reiniciado ao trocar tenant;
Codex mostra comando por padrão e TOML como alternativa; status separa servidor
disponível de confirmação no agente; auditoria continua acessível por teclado;
resultado distingue sucesso, consulta não executada e falha. Validar navegador
desktop/mobile, estados/clipboard/foco/concorrência e testes MCP/typecheck/build.
Homologação real Gemini/Codex continua dependente de ambiente disponível; não
representar configuração lida como sessão interativa homologada.

## Aceitação do refinamento UX
- [x] Preservação de endpoint na criação, cancelamento e reabertura; reset no tenant.
- [x] Cadastro principal por cliente com alternativa Codex secundária.
- [x] CTA de conexão, auditoria agrupada, resumo compacto e perfis na criação.
- [x] Resultado do teste local com destino explícito, sucesso/consulta omitida/falha.
- [x] Desktop/tablet/mobile, teclado, clipboard, estados vazios e concorrência.
- [x] Gemini real conecta com preset e confiança restrita ao diretório de teste.
Revisão independente PASS no WIP. Estado de entrega continua LOCAL_WIP: nenhuma
publicação, merge ou sincronização de master efetuados/autorizados nesta interação.

## Permissões compactas — aprovação de 2026-10-14
Usuário autorizou implementar a revisão de densidade fim a fim. GO: alteração
local de apresentação, sem alterar permissões, defaults ou payloads. Baseline:
76 testes e matriz anterior aprovados; coluna atual lista todas as tags, formulário
repete descrições. Estado deste incremento: in-development.
Aceitação: coluna Permissões com contagem e detalhes por clique/teclado; shell e
riscos altos visíveis; herança explícita; detalhes com fallback para chaves sem
metadados. Formulários compartilhando seletor agrupado por módulo com busca,
seleção preservada ao filtrar e descrição acessível. Validar muitos itens, herança,
metadados ausentes, criação/edição, teclado e três viewports. Rodar lint dos novos
componentes, typecheck/build e harness; revisão independente. Rollback: remover
componentes e restaurar somente os pontos desta apresentação. Nenhuma mudança de
backend, acesso, terminal ou dependências.

Aceitação do incremento Permissões compactas: atendida no WIP. Contagem/detalhes,
acessos sensíveis, herança, fallback sem metadados, seletor compartilhado, busca,
preservação de seleção e teclado validados. Grupo sem metadados classificado como
NECESSARY_CORRECTION para permitir inspecionar/remover chaves antigas.
Gates locais e revisão independente PASS. Evidências em test-results.md.
Estado ready-for-tests para futuro candidato publicado; commit/CI/homologação
permanecem pendentes e não são inferidos dos checks locais.
