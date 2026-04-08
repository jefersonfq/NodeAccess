# PRD Agents Lite

## Objetivo
Evoluir a frente de agentes proxy do NodeAccess para ficar confiavel em instalacao, download, onboarding, observabilidade e operacao via VPN local.

## Contexto Atual
- O produto ja possui:
  - cadastro e revogacao de agentes
  - token unico de registro
  - WebSocket de registro do agente
  - roteamento SSH via agente online por usuario ou tenant
  - binarios gerados em `apps/agent/dist`
- A UI atual de agentes esta em `apps/frontend/src/views/AgentsView.vue`
- O backend de download e registro esta em `apps/backend/src/modules/agents`

## Problemas Atuais
- Download de binarios retornava 404 na UI porque os links apontavam para `/api/agents/...` enquanto o backend publica em `/api/v1/agents/...`
- Distribuicao atual depende de binarios locais em `apps/agent/dist`, sem pipeline explicita de release
- UI informa `macOS arm64/x64`, mas o build atual do agente gera apenas `node18-macos-x64`
- UX ruim no Windows: o binario CLI pode ser aberto por duplo clique, sem feedback util ao usuario
- Falta mensagem clara de que o `.exe` nao e aplicativo com janela e deve ser executado por PowerShell/CMD
- Nao existe validacao guiada de instalacao apos copiar token/comando
- Nao existe tela curta de diagnostico do agente
- Nao existe versionamento visivel entre servidor e agente
- Existe duplicacao de UI entre `AgentsView.vue` e `AgentManager.vue`

## Escopo Inicial Recomendado
1. Corrigir distribuicao e download
2. Melhorar onboarding e setup
3. Expor estado operacional minimo
4. Consolidar a arquitetura da UI

## Fase 1
- Garantir links de download corretos
- Padronizar nomes dos artefatos
- Exibir claramente plataformas realmente suportadas
- Registrar erro amigavel quando binario nao existir
- Melhorar UX de distribuicao no Windows:
  - instruir execucao por terminal
  - nao induzir uso por duplo clique
  - oferecer comando pronto para PowerShell/CMD
- Definir estrategia de build e release para `apps/agent`

## Fase 2
- Wizard curto de instalacao
- Copia de comando por plataforma
- Validacao de conectividade apos criar token
- Instrucoes separadas para Windows, Linux e macOS

## Fase 3
- Exibir versao do agente
- Exibir ultimo handshake, latencia simples e origem da conexao
- Exibir mismatch de versao servidor/agente
- Exibir motivo de offline mais recente

## Politica de Conexao por Host
- O host pode escolher explicitamente como deve conectar:
  - `direct`
  - `agent_user`
  - `agent_tenant_fallback`
  - `auto`
- `agent` deve ser tratado como valor legado equivalente a `agent_tenant_fallback`.
- Nao deve existir fallback silencioso.
- Se o host estiver em `agent_user` e nao houver agente do usuario online, a conexao deve falhar com mensagem clara.
- Se o host estiver em `agent_tenant_fallback`, deve tentar agente do usuario e depois agente do tenant; se nenhum existir, deve falhar.
- Se o host estiver em `auto`, pode tentar agente do usuario, agente do tenant e depois direto, sempre exibindo o caminho final usado.
- O metodo efetivamente usado deve ficar visivel para o usuario durante a conexao e registravel em auditoria.

## Melhorias Futuras Recomendadas
- Governanca:
  - modelar `user-bound` e `service-bound` explicitamente
  - evitar agente sem owner claro
  - diferenciar agente pessoal de agente de servico do tenant
- Selecao previsivel do agente do tenant:
  - evitar depender apenas do ultimo agente registrado no tenant
  - permitir marcar um agente de servico como `default`
  - avaliar selecao futura por host ou grupo
- Observabilidade:
  - exibir versao do agente
  - exibir ultimo handshake
  - exibir latencia simples
  - exibir origem/IP da conexao
  - exibir motivo de offline recente quando disponivel
- Auditoria:
  - registrar agente criado
  - registrar token emitido
  - registrar agente conectado/desconectado
  - registrar agente usado em sessao SSH com snapshot de `agentId`, `agentName`, `agentSource` e owner
  - registrar agente revogado/excluido
- Ciclo de vida:
  - separar `Revogar` de `Excluir permanentemente`
  - manter historico/snapshot mesmo quando o cadastro operacional for excluido
- UX de setup:
  - wizard curto `criar token -> rodar comando -> validar conectado`
  - diagnostico guiado por plataforma
  - mensagem clara no Windows de que o binario e CLI, nao aplicativo com janela

## Regras de Produto
- Token do agente continua sendo exibido uma unica vez
- Revogacao deve invalidar reconexoes futuras
- Agente deve continuar sendo associado ao usuario criador e ao tenant
- Em producao, downloads devem refletir apenas plataformas realmente publicadas

## Arquivos Provaveis
- frontend:
  - `apps/frontend/src/views/AgentsView.vue`
  - `apps/frontend/src/services/agent.service.ts`
  - `apps/frontend/src/locales/pt-BR.json`
  - `apps/frontend/src/locales/en.json`
- backend:
  - `apps/backend/src/modules/agents/agent.routes.ts`
  - `apps/backend/src/modules/agents/agent.service.ts`
  - `apps/backend/src/modules/agents/agent.gateway.ts`
  - `apps/backend/src/modules/agents/agent.registry.ts`
- agent:
  - `apps/agent/src/index.js`
  - `apps/agent/package.json`

## Fora de Escopo Inicial
- Assinatura de binarios
- Auto-update do agente
- Multi-agente com politica de prioridade sofisticada
- Portal completo de fleet management

## Proximo Corte Recomendado
- modelar governanca `user-bound` e `service-bound`
- permitir selecionar ou marcar agente de servico do tenant como padrao
- adicionar status/versao/ultimo handshake na UI
- registrar auditoria de uso do agente em sessao SSH com snapshot completo
