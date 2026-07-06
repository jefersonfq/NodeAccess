# PRD Lite - NodeAccess Private Access via Agents

## Objetivo
Evoluir os agentes do NodeAccess para fornecer uma solucao propria de acesso
privado no modelo Zero Trust/ZTNA, sem depender de Cloudflare ou Tailscale como
componentes obrigatorios.

A ideia central e manter o comportamento atual dos agentes e adicionar um modo
mais governado, em que o agente atua como "Private Access Connector" do
NodeAccess:

- hosts internos nao expostos publicamente
- agente conecta outbound ao NodeAccess
- usuario acessa pelo browser ou gateway do NodeAccess
- NodeAccess aplica autenticacao, MFA, RBAC, politicas, auditoria e gravacao
- agente abre apenas o caminho TCP/SSH permitido ate o destino interno

## Nao Objetivo
Este PRD nao trata Cloudflare ou Tailscale como integracoes principais.

Cloudflare Zero Trust e Tailscale devem ser usados apenas como benchmark
conceitual e referencia de mercado para comparar capacidades esperadas:

- conector instalado dentro da rede privada
- conexao outbound
- rede privada sem porta exposta
- politicas por usuario/grupo/recurso
- auditoria de acesso
- diagnostico e health do conector
- alta disponibilidade com mais de um conector

## Contexto Atual do NodeAccess
O NodeAccess ja possui um modelo de agente proxy:

- agente conecta outbound por WebSocket ao backend
- backend usa o agente para abrir conexoes TCP locais e tunelar SSH
- hosts podem selecionar conexao direta, agente do usuario, agente do tenant ou
  modo automatico
- o PRD de governanca ja recomenda diferenciar agentes `user-bound` e
  `service-bound`

Arquivos de referencia:

- `ai/modules/agents.md`
- `docs/PRD-agents-lite.md`
- `docs/PRD-agents-governance-lite.md`
- `docs/PRD-ssh-gateway-lite.md`

## Decisao Principal
O NodeAccess consegue oferecer uma solucao parecida com Zero Trust usando os
agentes atuais como base.

Nao e necessario criar um novo conector separado para o MVP. A mudanca
recomendada e evoluir o agente existente para dois modos claros:

- `proxy_agent`: comportamento atual, focado em tunelamento operacional simples
- `private_access_connector`: comportamento Zero Trust do NodeAccess, com
  configuracao, governanca, escopo de rede, politicas e auditoria reforcadas

## Diferenca Entre os Modos

### Modo Atual - `proxy_agent`
Uso esperado:

- acesso rapido a redes locais
- agente vinculado a usuario ou tenant
- roteamento SSH via agente online
- menor configuracao inicial
- adequado para ambientes menores ou uso assistido

Comportamento:

```text
browser -> NodeAccess -> agente -> host SSH
```

Caracteristicas:

- simples de instalar
- menor carga administrativa
- pode continuar existindo como hoje
- nao exige desenho formal de zonas, redes ou politicas por conector

### Modo Zero Trust NodeAccess - `private_access_connector`
Uso esperado:

- acesso corporativo a redes privadas sem VPN tradicional
- hosts internos sem IP publico ou porta SSH exposta
- conector de servico por tenant, site, rede, cliente ou ambiente
- politica explicita por usuario/grupo/host/tag
- auditoria forte do caminho usado
- diagnostico operacional e health do conector
- possibilidade futura de alta disponibilidade

Comportamento:

```text
browser/gateway -> NodeAccess -> Private Access Connector -> host interno
```

Caracteristicas:

- agente deve ser `service-bound`
- agente deve ter escopo de rede declarado
- agente deve aceitar somente destinos autorizados pelo backend
- fallback deve ser explicito, nunca silencioso
- toda sessao deve registrar o conector efetivo usado
- conector deve publicar health, versao, latencia e ultimo erro

## Configuracao Necessaria Para o Comportamento Zero Trust
Para usar o agente como `private_access_connector`, o admin precisa configurar:

1. Tipo do agente:
   - `private_access_connector`
2. Ownership:
   - obrigatoriamente `service-bound`
   - owner associado ao tenant ou identidade de servico
3. Escopo de rede:
   - nome do site/rede/ambiente
   - CIDRs permitidos
   - hostnames/domains permitidos, se aplicavel
   - portas permitidas, inicialmente SSH `22` e portas cadastradas no host
4. Politica de uso:
   - quais usuarios, times ou grupos podem usar o conector
   - quais hosts ou tags de hosts podem ser acessados por ele
   - se permite ou nao fallback para outro conector
5. Health e diagnostico:
   - teste de reachability para hosts internos
   - ultimo handshake
   - versao do agente
   - latencia simples ate o backend
   - ultimo erro de conexao
6. Auditoria:
   - snapshot do conector
   - usuario autenticado
   - host destino
   - politica aplicada
   - metodo efetivo de conexao

## Modelo Proposto

### `Agent`
Campos conceituais sugeridos:

- `id`
- `tenantId`
- `name`
- `agentType`: `proxy_agent` ou `private_access_connector`
- `binding`: `user-bound` ou `service-bound`
- `status`: `online`, `offline`, `degraded`, `revoked`, `deleted`
- `ownerType`
- `ownerId`
- `siteName`
- `environment`
- `version`
- `lastSeenAt`
- `lastError`
- `createdBy`
- `revokedAt`
- `deletedAt`

### `PrivateAccessScope`
Escopo aplicado somente ao `private_access_connector`:

- `agentId`
- `allowedCidrs`
- `allowedHostnames`
- `allowedPorts`
- `allowedHostTags`
- `allowFallback`
- `priority`

### Configuracao por Host
O host deve ter metodo de conectividade explicito:

- `direct`
- `proxy_agent`
- `private_access_connector`
- `auto`

Regras:

- `direct`: backend tenta conectar diretamente ao host.
- `proxy_agent`: usa agente no comportamento atual.
- `private_access_connector`: usa somente conectores ZTNA autorizados.
- `auto`: pode tentar ordem configurada, mas deve exibir e auditar o caminho
  final usado.

Nao deve existir fallback silencioso.

## Politicas do Private Access

### Regras Minimas
- Todo conector Zero Trust deve ser `service-bound`.
- Todo conector deve ter owner claro.
- Todo conector deve ter escopo de rede declarado.
- O backend e a fonte de verdade para autorizacao.
- O agente nao decide permissao final; ele apenas executa conexoes aprovadas.
- O agente deve recusar solicitacoes fora do escopo recebido.
- O usuario nunca acessa diretamente o IP privado; acessa via NodeAccess.

### Politicas Futuras
- acesso por tags de host
- acesso por grupos de usuario
- janela de horario
- justificativa obrigatoria
- aprovacao temporaria
- bloqueio por risco ou MFA ausente
- politica por protocolo, porta ou ambiente

## Fluxos

### Fluxo Atual Preservado
```text
admin cria agente comum
usuario instala/roda agente
host usa metodo proxy_agent
usuario abre terminal
NodeAccess roteia via agente online
```

### Fluxo Zero Trust NodeAccess
```text
admin cria Private Access Connector
NodeAccess gera token de instalacao de servico
admin instala agente em VM/rede privada
admin declara escopo de rede e politicas
admin associa hosts/tags ao conector
usuario abre terminal no NodeAccess
NodeAccess valida usuario, MFA, RBAC e politica
NodeAccess envia ao conector uma solicitacao autorizada
conector abre TCP/SSH ate o host interno
NodeAccess audita sessao, comando e caminho efetivo
```

## Requisitos Funcionais

- Permitir criar agente em modo `proxy_agent` ou `private_access_connector`.
- Impedir `private_access_connector` sem ownership `service-bound`.
- Permitir declarar escopo de rede para conectores Zero Trust.
- Permitir associar host ou tag de host a um conector Zero Trust.
- Permitir configurar metodo de conectividade por host.
- Exibir na sessao qual caminho foi usado.
- Registrar auditoria com snapshot do agente/conector usado.
- Exibir health do conector:
  - online/offline
  - versao
  - ultimo handshake
  - ultimo erro
  - latencia simples
- Bloquear conexao quando o destino estiver fora do escopo do conector.
- Bloquear conexao quando usuario nao tiver permissao ao host, mesmo que o
  conector consiga alcancar a rede.

## Requisitos Nao Funcionais

- Nao expor SSH dos hosts internos na internet.
- Nao exigir VPN tradicional no endpoint do usuario.
- Nao alterar autenticacao, autorizacao, websocket ou sessao SSH alem do
  necessario para registrar e aplicar o caminho de conectividade.
- Manter compatibilidade com agentes e hosts existentes.
- Manter o backend como ponto central de politica e auditoria.
- Evitar dependencia obrigatoria de Cloudflare, Tailscale ou outro provedor.
- Preparar o modelo para HA futura com multiplos conectores por rede.

## Impacto em UX

- A area atual de agentes pode evoluir para "Agentes" com dois tipos visiveis:
  - Agente comum
  - Conector de acesso privado
- O wizard de criacao deve mudar conforme o tipo escolhido.
- Para `proxy_agent`, manter instalacao simples.
- Para `private_access_connector`, orientar configuracao de servico:
  - onde instalar
  - qual rede ele cobre
  - quais hosts/tags podem usar
  - como validar conectividade
- Na tela de hosts, mostrar o metodo de conectividade sem poluir a listagem.
- Na sessao, mostrar o caminho efetivo usado de forma discreta e auditavel.
- Mensagens de erro devem diferenciar:
  - conector offline
  - destino fora do escopo
  - usuario sem permissao
  - host inacessivel
  - credencial SSH invalida

## Estados Principais

- agente comum online
- agente comum offline
- conector Zero Trust online
- conector Zero Trust degradado
- conector Zero Trust sem escopo configurado
- conector Zero Trust sem hosts associados
- host associado a conector offline
- host fora do escopo do conector
- conexao bloqueada por politica
- conexao autorizada e auditada

## Benchmark com Cloudflare e Tailscale

### Similaridades Desejadas
- conector dentro da rede privada
- conexao outbound
- sem porta SSH publica nos hosts internos
- controle centralizado por usuario/grupo/recurso
- auditoria de acesso
- health do conector
- suporte futuro a alta disponibilidade

### Diferenciais do NodeAccess
- terminal web integrado
- credenciais SSH gerenciadas pelo NodeAccess
- auditoria de sessao SSH no produto
- politicas de acesso ligadas ao inventario de hosts
- experiencia sem instalar cliente VPN no computador do usuario
- possibilidade de combinar browser, SSH gateway nativo e agentes

### Limites Frente a Produtos ZTNA Dedicados
- no MVP, nao havera rede mesh generica
- no MVP, nao havera cliente de endpoint para todo trafego privado
- foco inicial e acesso operacional a hosts/protocolos suportados pelo
  NodeAccess, principalmente SSH
- governanca avancada, postura de dispositivo e roteamento L3 completo ficam
  fora do primeiro corte

## Escopo MVP Recomendado

1. Adicionar tipo de agente:
   - `proxy_agent`
   - `private_access_connector`
2. Aplicar regra: `private_access_connector` exige `service-bound`.
3. Adicionar escopo basico ao conector:
   - CIDRs
   - portas
   - tags/hosts permitidos
4. Adicionar metodo `private_access_connector` ao host.
5. Resolver conector por host/tag/politica.
6. Validar destino no backend e no agente antes de abrir TCP.
7. Registrar auditoria do caminho efetivo.
8. Exibir health minimo na UI.
9. Criar onboarding especifico para instalar como servico.

## Fora do Escopo MVP

- Cliente VPN/endpoint NodeAccess.
- Roteamento L3 generico para qualquer aplicacao.
- Provisionamento automatico de Cloudflare, Tailscale ou outro provedor.
- Politica de postura de dispositivo.
- HA automatica sofisticada entre conectores.
- Mesh entre conectores.
- Substituir firewall ou SD-WAN do cliente.

## Riscos

- Posicionamento comercial exagerado: o MVP deve ser descrito como acesso
  privado operacional/ZTNA para hosts gerenciados, nao como VPN completa.
- Ambiguidade entre agente comum e conector Zero Trust: a UI precisa separar os
  dois modos com clareza.
- Fallback mal definido pode criar acesso por caminho nao esperado.
- Diagnostico inicial pode confundir falha de rede, falha de politica e falha
  de credencial SSH.
- Escopo de rede amplo demais pode reduzir o valor de seguranca do modelo.

## Validacao Rapida

1. Criar um agente como `private_access_connector`.
2. Instalar o agente como servico em uma VM dentro da rede privada.
3. Configurar escopo com CIDR e porta SSH permitida.
4. Associar um host interno ao metodo `private_access_connector`.
5. Abrir sessao SSH pelo terminal web.
6. Confirmar que o host nao possui porta SSH publica exposta.
7. Confirmar que a sessao registra:
   - usuario
   - host destino
   - conector usado
   - metodo efetivo
   - inicio/fim da sessao
8. Tentar acessar host fora do escopo e confirmar bloqueio.
9. Desligar o conector e confirmar erro claro de conector offline.

## Roadmap Sugerido

### Implementado - Corte Inicial
- tipo de agente `PROXY_AGENT` e `PRIVATE_ACCESS_CONNECTOR`
- criacao/listagem de conector de acesso privado na tela de agentes
- escopo inicial do conector por site, ambiente, CIDR e porta
- metodo de host `private_access_connector`
- resolucao backend de conector privado online por tenant e escopo IP/porta
- associacao opcional de host a um conector privado especifico
- validacao backend do conector privado associado ao host
- bloqueio sem fallback direto quando o host exige conector privado
- auditoria de sessao com metodo efetivo `private_access_connector`
- snapshot JSON da rota em `sessions` e `session_audits`, contendo metodo
  solicitado, metodo efetivo, agente/conector usado, origem da selecao e escopo
  privado aplicado
- painel "Rota de acesso" no detalhe da auditoria, exibindo conector,
  selecao, site/ambiente, escopo permitido e fallback registrado
- status separado para conector privado no endpoint de agentes

### Fase 1 - Modo Zero Trust Basico
- tipos `proxy_agent` e `private_access_connector`
- ownership `service-bound`
- escopo basico por CIDR/porta/host
- metodo de conectividade por host
- auditoria do caminho efetivo
- health minimo do conector

### Fase 2 - Governanca e UX
- tags de hosts
- politicas por grupo/time
- wizard de instalacao como servico
- diagnostico guiado
- mensagens de erro por causa provavel
- dashboard de conectores por tenant/rede

### Fase 3 - Alta Disponibilidade
- multiplos conectores por rede
- prioridade por conector
- failover explicito e auditado
- testes periodicos de reachability
- visao de degradacao por site

### Fase 4 - Politicas Avancadas
- aprovacao temporaria
- justificativa obrigatoria
- janela de acesso
- integracao com risco/MFA
- politica por protocolo
- auditoria administrativa completa

## Decisao Final
O produto deve evoluir os agentes para oferecer um modo "NodeAccess Private
Access", semelhante ao conceito de Zero Trust, mas focado no acesso operacional
auditavel a hosts internos.

O comportamento atual dos agentes deve ser preservado. O comportamento Zero
Trust deve ser ativado por configuracao explicita do agente como
`private_access_connector`, com ownership de servico, escopo de rede, politicas,
health e auditoria reforcada.
