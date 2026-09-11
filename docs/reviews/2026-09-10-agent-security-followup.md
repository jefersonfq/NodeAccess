# Revisão de segurança dos agentes — atualização

Data: 2026-09-10. Escopo: código atual de relay, conector privado, autenticação, registry, listener localhost, instalador e atualizador. Revisão estática e simulação em memória, mais execução de testes existentes. Não houve alteração funcional, scan de clientes, uso da VPN ou auditoria dos binários instalados nesta revisão.

Complementa `2026-09-10-agent-security-preliminary.md`. Prioridades são de engenharia, não notas CVSS. Não há evidência apresentada de exploração em produção.

## O que mudou desde a revisão preliminar

O antigo achado de ownership dos frames foi corrigido: `agent.registry.ts:351` e `:369` exigem a mesma instância de agente proprietária do stream para mensagens de controle e dados. O encerramento de uma instância também usa identidade de objeto. Os testes direcionados de operações, gateway e listener passaram: 14 testes em três arquivos.

O listener localhost tem restrições próprias: bind em 127.0.0.1, validação de porta, limites de listeners/conexões e buffers. Esses limites não equivalem a limites implementados em todo o relay TCP legado.

## Achados prioritários

### A01 — Revogação incompleta após registro duplicado (alta, reproduzido)

`apps/backend/src/modules/agents/agent.registry.ts:99` substitui a entrada de lookup sem fechar a conexão anterior. `:277` desconecta somente a instância retornada por `getActiveById`. Streams mantêm referência à instância antiga.

Simulação, sem rede: registrar agente A; abrir ponte simulada; registrar B com o mesmo agentId/userId/tenantId; chamar `disconnectById`. Resultado:

```json
{"oldSocketOpen":true,"newSocketClosed":true,"oldBridgeDestroyed":false,"remainingBridges":1}
```

O caso exige registros autenticados duplicados, por reconexão concorrente ou reutilização da credencial; não é acesso anônimo. Mostra que revogar a identidade não garante fechar todas as conexões locais dela. Não demonstra exploração em clientes.

Correção proposta: política explícita para registro duplicado, fechamento da instância substituída e índice de todas as conexões por identidade. Revogar deve fechar todas as instâncias e pontes, inclusive as já substituídas. Testar mesma identidade, dois agentes pessoais do mesmo usuário e callbacks tardios da conexão antiga.

### A02 — Revogação distribuída e ciclo de vida da identidade (alta, lacunas no código)

`agent.service.ts:495` persiste revogação e chama registry local. `:604` gira hash, sem desconectar o socket autenticado anteriormente. `agent.gateway.ts` autentica na conexão; o heartbeat atual verifica pong, não o estado de autorização no banco. `authenticate` (`agent.service.ts:648`) verifica agente ativo/não excluído/não pausado, mas não consulta atividade do tenant ou do proprietário.

Não foi validado encerramento distribuído em réplicas. Rotação pode legitimamente preservar conexões no modo planejado, mas isso precisa ser separado de revogação de segurança. Para SERVICE_BOUND, saída/desativação do criador não deve ter semântica presumida de agente pessoal: definir propriedade institucional.

Correção proposta: eventos de invalidação entre gateways, revalidação periódica com prazo máximo explícito e contador de geração da credencial. Aceite: revogar na API A fecha conexões no gateway B dentro do prazo documentado, mesmo após eventos perdidos; tenant desativado impede registro; usuário desativado impede uso de seu agente pessoal.

### A03 — Limite da rede do cliente depende somente do servidor (alta, confirmado estaticamente)

`apps/agent/src/index.js:225` recebe `host/port` e executa `sock.connect`, sem uma política local de destinos. No conector privado, `agent.registry.ts:388` permite destinos amplos quando listas de hostname/CIDR estão vazias, e portas vazias significam qualquer porta. A rota de cadastro permite arrays vazios.

Isso não elimina a ACL de hosts no backend e não prova acesso arbitrário por qualquer usuário. O risco principal é a amplitude da confiança concedida ao servidor e a configuração permissiva involuntária.

Correção proposta: política local administrável pelo cliente, com destinos/portas autorizados e validação do IP final após DNS; tratamento explícito de IPv4/IPv6, loopback, link-local e redes de gerenciamento. O servidor não pode ampliar silenciosamente a política local. Escopo vazio de conector privado deve bloquear; permissões amplas precisam ser explícitas, com migração das instalações existentes.

### A04 — Credencial no URL e transporte sem TLS permitido no CLI (alta, confirmado estaticamente)

`apps/agent/src/index.js:117` inclui token na query; `apps/backend/src/modules/ssh/ssh.routes.ts:55` o recebe assim. O CLI aceita ws/http e permite `--insecure`. TLS é validado por padrão quando WSS é usado, mas o rótulo autorrelatado `tlsMode=verified` não comprova TLS quando a URL usa WS.

Não foram encontrados vazamentos reais nesta revisão. Query pode aumentar exposição em logs de infraestrutura; HTTP/WS deixa o segredo sem proteção de transporte.

Correção proposta: WSS obrigatório fora de desenvolvimento explícito, token em header ou troca por ticket curto, redação de segredos em logs, identidade por instalação e renovação. Não tratar metadado enviado pelo agente como atestação de segurança.

### A05 — Runtime e autenticidade da distribuição (alta, confirmado nos caminhos de build)

`apps/agent/package.json` e `installer/platforms.mjs:3` apontam para Node 18. Essa linha está EOL segundo a [tabela oficial do Node.js](https://nodejs.org/en/about/previous-releases). Isso comprova configuração de build, não a versão embutida em cada artefato já instalado.

`installer/windows/build-msi.ps1:36` permite build sem certificado. `AgentUpdates.ps1` valida HTTPS, caminho, tamanho, checksum e versão maior que a atual; `AgentSetup.ps1:341` confere novamente hash antes de abrir MSI. Não foi observada verificação obrigatória de editor/assinatura nesses caminhos.

Hash é proteção de integridade, mas manifesto e pacote no mesmo distribuidor não estabelecem uma autoridade independente em caso de comprometimento do distribuidor. Já existe comparação de versão; a lacuna é autenticar os metadados e a política de rollback, não ausência total de comparação.

Correção proposta: runtime suportado, pipeline que recusa release comercial sem assinatura, verificação de editor/chave confiável no cliente, manifesto assinado e rollback controlado. Inventariar versão/hash/assinatura dos artefatos efetivamente distribuídos; SBOM e verificação de dependências por versão resolvida.

### A06 — Privilégio e limites do relay (média/alta conforme instalação)

O instalador Linux gerado em `agent.routes.ts` cria unidade systemd sem `User=`, com token protegido por chmod 600. Priorizar usuário de serviço dedicado e isolamento compatível com conexão outbound. Não generalizar esse comportamento para o aplicativo desktop Windows, que tem outro fluxo.

O relay legado envia dados sem um teto explícito de `bufferedAmount` no caminho revisado e não reage ao retorno de `push` para controlar a origem (`agent-bridge-stream.ts`). O plugin WebSocket não define limites específicos do produto. Não foi realizado teste de exaustão; limites da biblioteca não são equivalentes a orçamento operacional definido por agente/tenant.

Correção proposta: limites de conexões, tamanho de frame, filas e taxa de controle; backpressure de ponta a ponta; encerramento apenas do stream excedente; teste com consumidor lento e entradas inválidas. Manter o executor futuro de Nmap/scans separado do relay para não elevar os privilégios do agente de acesso.

## Sequência recomendada e aceite

1. A01/A02: autoridade de revogação e identidade. Testes com sockets duplicados, duas réplicas, token girado, tenant/usuário desativado e eventos atrasados.
2. A03/A04: política local, defaults restritivos e transporte protegido. Testes de destinos permitidos/negados, DNS alterado e tentativa de ampliação pelo servidor.
3. A05: runtime e distribuição verificável. Testes de pacote adulterado, manifesto alterado, editor desconhecido e rollback não autorizado.
4. A06: privilégio mínimo e resiliência. Testes de fila saturada, consumidor lento e permissões de arquivos/serviço em cada sistema suportado.

mTLS pode complementar identidade por instalação, mas não substitui revogação, limites locais ou atualização assinada. Antes de liberar uma nova versão comercial, comprovar esses critérios nos binários finais e em laboratório, além do código-fonte.

## Evidências desta execução

- `agent-operations.test.ts`: 3 aprovados.
- `agent.gateway.test.ts`: 2 aprovados.
- `agent-local-listener.test.ts`: 9 aprovados.
- Simulação A01: `/tmp/nodeaccess-agent-security-audit.mjs`; resultado registrado acima. Os sockets são EventEmitters em memória; o endereço documental não recebeu conexão TCP.
- Não foram modificados agentes, sessões ou configurações de clientes.
