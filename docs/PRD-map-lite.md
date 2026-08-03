# PRD Map Lite

Mapa curto para economizar tokens.

Use assim:
- ler `docs/PRD-lite.md` primeiro
- abrir este arquivo para decidir qual PRD detalhado realmente precisa ser lido
- evitar abrir PRDs de frentes nao relacionadas

## Estrutura recomendada
- `fonte primaria curta`: `docs/PRD-lite.md`
- `mapa de navegacao`: `docs/PRD-map-lite.md`
- `contexto funcional completo`: `docs/PROJECT-functional-context-nodeaccess.md`
- `decisoes consolidadas`: `docs/DECISIONS.md`
- `andamento recente`: `docs/WORKLOG-lite.md`
- `PRDs de dominio`: abrir apenas o que toca a tarefa
- `propostas tecnicas`: abrir so quando a tarefa for estrutural ou de infraestrutura

## Manutencao documental obrigatoria
Ao adicionar, alterar ou remover funcionalidade, facilidade operacional,
integracao, agente, permissao, relatorio, modulo ou recurso de seguranca,
atualizar tambem a documentacao de referencia:

- `docs/PROJECT-functional-context-nodeaccess.md`
- `docs/PRD-lite.md`
- `docs/PROJECT-value-summary.md`, se houver impacto em valor/proposta
- `README.md`, se houver impacto em apresentacao, instalacao ou operacao
- este mapa, se houver novo PRD, mudanca de status ou arquivamento
- PRD/guia operacional especifico do dominio afetado

## Estado de referencia
- `ativo`:
  - PRD que ainda guia evolucao funcional ou UX no dia a dia
- `complementar`:
  - PRD util, mas nao precisa ser aberto por padrao
- `tecnico`:
  - proposta estrutural, arquitetura ou execucao tecnica
- `historico controlado`:
  - frente majoritariamente implementada ou de baixo uso atual
  - manter no repo, mas evitar leitura por padrao

## Frentes principais

### Estrategia e roadmap
- `docs/PROJECT-functional-context-nodeaccess.md`
  - foco: inventario funcional completo da solucao, recursos, facilidades, integracoes, agentes, seguranca, casos de uso e contexto para chats/assistentes
  - status: documento vivo; manter atualizado junto com cada feature relevante
  - referencia: `ativo`
- `docs/PRD-strategic-roadmap-lite.md`
  - foco: modulos futuros de maior valor comercial e diferenciacao frente a PAM/Zero Trust/acesso moderno
  - status: direcao estrategica; usar para priorizacao de produto e planejamento de proposta
  - referencia: `ativo`
- `docs/PRD-security-assessment-lite.md`
  - foco: varredura de seguranca, hardening, evidencia de scan e preparacao para certificacao
  - status: direcao operacional; usar antes de rodar Nessus, ZAP, Nuclei, SAST ou scans de container
  - referencia: `ativo`

### Core SSH e sessao
- `docs/prd-archive/PRD-terminal-fullscreen-lite.md`
  - foco: fullscreen do terminal
  - status: implementado com preferencia de usuario
  - referencia: `historico controlado`
- `docs/PRD-terminal-sharing-lite.md`
  - foco: sessao propria e sessao ao vivo
  - status: fase principal implementada; restam refinamentos de UX e evolucoes administrativas
  - referencia: `ativo`
- `docs/PRD-live-sessions-overview-lite.md`
  - foco: dashboard operacional de sessoes em tempo real, hosts em uso, usuarios conectados e acesso concorrente com permissao dedicada
  - status: PRD criado; usar quando a tarefa tocar presenca operacional, sessoes ativas, usuarios por host, notificacao de acesso concorrente ou observabilidade em tempo real
  - referencia: `ativo`
- `docs/PRD-terminal-host-switcher-lite.md`
  - foco: quick switcher de hosts no terminal
  - status: implementado no primeiro corte; restam refinamentos opcionais
  - referencia: `ativo`
- `docs/PRD-terminal-macros-lite.md`
  - foco: macros/snippets no terminal
  - status: frente existente; validar quando a tarefa tocar automacao de comandos
  - referencia: `complementar`
- `docs/PRD-snippets-lite.md`
  - foco: snippets como recurso de produtividade, quick picker e consumo futuro de secrets
  - status: snippets existem; evolucao recomendada e integrar referencias de secrets sem armazenar senha no snippet
  - referencia: `ativo`
- `docs/PRD-vault-secrets-lite.md`
  - foco: cofre de segredos reutilizavel por snippets e outros recursos futuros
  - status: PRD criado; implementar com seguranca, ACL, auditoria e criptografia em repouso
  - referencia: `ativo`
- `docs/PRD-session-policy-lite.md`
  - foco: politicas de sessao
  - status: abrir apenas para regras de encerramento, expiracao e limites
  - referencia: `complementar`

### Hosts, acessos locais e web access
- `docs/PRD-host-inventory-acl-lite.md`
  - foco: evolucao futura de hosts para inventario corporativo unico do tenant, ACL por arvore com heranca, views pessoais de produtividade e politica governada para hosts pessoais
  - status: PRD criado para decisao de produto/arquitetura; usar quando a tarefa tocar permissoes por pasta/host, remocao de Personal/Team/Global, mapa de permissoes, simulacao "visualizar como" ou governanca de hosts pessoais
  - referencia: `ativo`
- `docs/PRD-multi-protocol-access-lite.md`
  - foco: suporte futuro a RDP, Telnet, VNC, serial e arquitetura de `ConnectionProfile` por protocolo
  - status: PRD criado para orientar evolucao multi-protocolo sem acoplar tudo ao modelo SSH atual
  - referencia: `ativo`
- `docs/PRD-host-notifications-knowledge-lite.md`
  - foco: notificacoes temporarias por host, reconhecimento, resolucao, timeline operacional e base futura de conhecimento do host
  - status: PRD criado para estudo de viabilidade; iniciar por notificacao temporaria, badges em Hosts e aviso no terminal/interacoes com host
  - referencia: `ativo`
- `docs/PRD-host-bulk-actions-lite.md`
  - foco: edicao em massa de hosts, selecao por filtros, troca de Bastion/Chave PEM, tags, pasta, preview, confirmacao e auditoria
  - status: fase 1 implementada com preview, apply sincronono, relatorio, historico e rollback controlado; usar para evolucoes de operacao em escala, bulk update, selecao por filtro ou manutencao de muitos hosts
  - referencia: `ativo`
- `docs/PRD-ssh-importers-lite.md`
  - foco: importacao de hosts SSH a partir de Apache Guacamole, MobaXterm, mRemoteNG, OpenSSH config, CSV e outras ferramentas usadas pelo mercado
  - status: PRD criado; usar quando a tarefa tocar onboarding, migracao de clientes SSH, importacao de hosts, deduplicacao ou preview de inventario
  - referencia: `ativo`
- `docs/PRD-bastions-lite.md`
  - foco: bastion host / jump server, vinculo por host/grupo, PEM reutilizavel e visibilidade de impacto
  - status: PRD criado; primeira fase recomendada e UX/visibilidade antes de refatorar credenciais
  - referencia: `ativo`
- `docs/PRD-port-forwardings-lite.md`
  - foco: acessos locais, porta preferida x porta ativa, fallback e UX
  - status: runtime com `assignedLocalPort` e UX principal implementados; restam refinamentos contextuais
  - referencia: `ativo`
- `docs/PRD-host-associated-links-lite.md`
  - foco: links operacionais associados ao host, com placeholders simples como `{{HOST.IP}}`
  - status: PRD criado; iniciar por schema/placeholder e depois CRUD persistido
  - referencia: `ativo`
- `docs/PRD-links-catalog-lite.md`
  - foco: visao consolidada de links, origem manual/integracao e futura sync com 1Password
  - status: PRD criado; usar quando a tarefa tocar listagem consolidada, busca, origem ou sincronizacao
  - referencia: `ativo`
- `docs/prd-archive/PRD-forwarding-ux-lite.md`
  - foco: UX de forwarding
  - status: complementar; usar quando a tarefa for visual/operacional
  - referencia: `complementar`
- `docs/prd-archive/PRD-web-access-lite.md`
  - foco: abrir servicos web via SSH
  - status: implementado; ler junto com port forwarding quando tocar links e portas
  - referencia: `complementar`
- `docs/prd-archive/PRD-host-key-trust-lite.md`
  - foco: host key changed / trusted host key
  - status: fases 1 e 2 concluidas
  - referencia: `historico controlado`

### Auditoria e compliance
- `docs/PRD-session-audit-lite.md`
  - foco: auditoria SSH
  - status: base implementada; usar para regras funcionais
  - referencia: `ativo`
- `docs/PRD-session-audit-ai-lite.md`
  - foco: IA sobre auditoria
  - status: opcional/futuro
  - referencia: `complementar`
- `docs/PRD-session-playback-lite.md`
  - foco: replay textual/event-based de sessoes SSH auditadas em terminal fake/read-only, timeline de comandos e tratamento de comandos interativos
  - status: PRD criado e refinado; implementar como evolucao da auditoria, sem video no MVP
  - referencia: `ativo`
- `docs/PRD-session-audit-licensing-lite.md`
  - foco: licenciamento da auditoria
  - status: abrir so quando a tarefa tocar limites de plano/licenca
  - referencia: `complementar`
- `docs/PRD-license-entitlements-lite.md`
  - foco: evolucao da licenca para limites, modulos e integracoes por provider
  - status: PRD criado; usar quando a tarefa tocar produto/licenciamento alem da auditoria
  - referencia: `ativo`
- `docs/PRD-session-audit-architecture.md`
  - foco: arquitetura maior de auditoria
  - status: tecnico; evitar por padrao
  - referencia: `tecnico`
- `docs/PRD-session-audit-tech-proposal.md`
  - foco: proposta tecnica de auditoria
  - status: tecnico; abrir apenas em mudancas estruturais
  - referencia: `tecnico`
- `docs/PRD-iso27001-lite.md`
  - foco: aderencia do produto a evidencias e governanca
  - status: backlog inicial definido
  - referencia: `complementar`

### Adocao, preferencia e dashboards
- `docs/PRD-platform-adoption-lite.md`
  - foco: adocao, UX e produtividade
  - status: varias entregas ja implementadas; ainda e referencia principal para evolucoes de UX
  - referencia: `ativo`
- `docs/prd-archive/PRD-user-preferences-lite.md`
  - foco: preferencias do usuario
  - status: parte importante ja persistida; abrir quando a tarefa tocar sincronizacao entre dispositivos
  - referencia: `complementar`
- `docs/PRD-user-dashboard-lite.md`
  - foco: dashboard pessoal
  - status: fases principais implementadas; restam refinamentos analiticos
  - referencia: `ativo`
- `docs/PRD-admin-adoption-dashboard-lite.md`
  - foco: dashboard admin de adocao
  - status: base e drill-down inicial implementados; restam comparativos e filtros mais ricos
  - referencia: `ativo`
- `docs/PRD-live-sessions-overview-lite.md`
  - foco: decisao historica sobre Mapa de acessos e sessoes ativas; a tela `/access-map` foi removida do produto e a visao canonica deve evoluir em `/admin/reports/sessions`
  - status: despriorizado como tela propria; manter apenas como referencia para regras de presenca, concorrencia e permissao `canViewLiveSessions`
  - referencia: `complementar`
- `docs/PRD-feedback-lite.md`
  - foco: feedback do usuario com inbox admin e retorno de status ao proprio usuario
  - status: PRD criado; usar quando a tarefa tocar escuta de produto, sugestoes, bugs relatados ou comunicacao de retorno ao usuario
  - referencia: `ativo`

### Integracoes e expansoes
- `docs/PRD-rbac-architecture.md`
  - foco: arquitetura RBAC consolidada, desacoplamento AuthN/AuthZ, integracoes com LDAP/AD, Entra ID, Okta, OIDC/SAML, SCIM, TACACS+, SOLID, modelo de dados e plano incremental
  - status: documento dedicado criado; usar como fonte principal quando a tarefa tocar autorizacao, permissoes, RBAC, mapeamento de grupos externos, roles ou policies de acesso
  - referencia: `ativo`
- `docs/PRD-rbac-lite.md`
  - foco: resumo curto de permissoes granulares por ferramenta e capacidade
  - status: mantido como resumo; arquitetura consolidada vive em `docs/PRD-rbac-architecture.md`
  - referencia: `complementar`
- `docs/PRD-tenancy-lite.md`
  - foco: ativacao e melhoria de tenancy no backend/frontend, principalmente descoberta pre-login e isolamento por JWT
  - status: PRD criado; usar quando a tarefa tocar multi-tenant, header `X-Tenant-Slug`, login por tenant ou subdominio
  - referencia: `ativo`
- `docs/PRD-api-keys-lite.md`
  - foco: acesso a API por `API key` para automacoes e integracoes, com escopos, hash no banco, auditoria e revogacao
  - status: PRD criado; usar quando a tarefa tocar autenticacao de integracao, automacao server-to-server ou governanca de credenciais tecnicas
  - referencia: `complementar`
- `docs/PRD-webhooks-lite.md`
  - foco: webhooks outbound, onde o NodeAccess envia eventos para plataformas externas com assinatura, retry e auditoria
  - status: base implementada; usar quando a tarefa tocar subscriptions, deliveries, eventos de saida, payload, retry ou HMAC outbound
  - referencia: `ativo`
- `docs/PRD-inbound-webhooks-lite.md`
  - foco: webhooks inbound, onde plataformas externas enviam eventos para o NodeAccess com autenticacao, idempotencia, normalizacao e processamento desacoplado
  - status: PRD criado; usar quando a tarefa tocar recebimento de eventos externos, monitoramento, CMDB, ITSM, aprovacao externa de JIT ou notificacoes de host por integracao
  - referencia: `ativo`
- `docs/OPERATIONS-inbound-webhooks-lite.md`
  - foco: guia operacional de inbound webhooks com exemplos de criacao, ingestao, HMAC, idempotencia e consulta de receipts
  - status: guia inicial criado; usar quando a tarefa tocar teste ponta a ponta, suporte a integradores ou validacao operacional de inbound webhooks
  - referencia: `operacional`
- `docs/PRD-jira-session-integration-lite.md`
  - foco: integracao com Jira
  - status: abrir so em tarefas de correlacao com tickets
  - referencia: `complementar`
- `docs/PRD-ldap-integration-lite.md`
  - foco: LDAP/Active Directory como provider opcional de integracao para autenticacao, provisionamento e sincronizacao futura de usuarios/grupos
  - status: PRD criado; usar quando a tarefa tocar diretorio corporativo, login LDAP, AD, sync de usuarios ou mapeamento de grupos externos
  - referencia: `ativo`
- `docs/PRD-local-ai-lite.md`
  - foco: IA local opcional
  - status: futuro; ainda orientado por arquitetura
  - referencia: `complementar`
- `docs/PRD-local-ai-tech-proposal.md`
  - foco: plano tecnico inicial da IA local, com desacoplamento, gates por modulo, tools internas e provider abstrato
  - status: tecnico; abrir quando a tarefa for estrutural ou de implementacao inicial
  - referencia: `tecnico`
- `docs/PRD-mcp-nodeaccess-lite.md`
  - foco: MCP como interface governada para expor contexto e tools do NodeAccess a assistentes de IA
  - status: Fase 1 inicial implementada com discovery, auth, governanca de token, resources read-only e tools governadas iniciais para `ActionRun`; evolucao futura para autonomia controlada e protocolo MCP mais completo
  - referencia: `ativo`
- `docs/PRD-ai-ssh-operational-access-lite.md`
  - foco: preparar acesso SSH operacional por IA com sessao tecnica, modos de acesso, policy e kill switch
  - status: direcao inicial consolidada; foundation, `ActionRun`, execucao real inicial, detalhe e integracao MCP em progresso
  - referencia: `ativo`
- `docs/OPERATIONS-mcp-lite.md`
  - foco: configuracao, discovery, autenticacao, exemplos de uso e validacao operacional do primeiro corte do MCP
  - status: guia operacional inicial criado para o backend MCP
  - referencia: `complementar`
- `docs/PRD-ai-diagnostic-scripts-lite.md`
  - foco: base governada de scripts/playbooks de diagnostico com execucao controlada, suporte futuro a scripts, analise por IA e canais como MCP/assistentes externos
  - status: primeiro corte implementado no dashboard do host, com execucao inicial, detalhe da execucao, resumo por IA e ajuda contextual; restam expansoes de runner, scripts, autonomia controlada e governanca admin
  - referencia: `ativo`
- `docs/OPERATIONS-diagnostic-playbooks-lite.md`
  - foco: uso operacional do modulo de diagnosticos, escolha de playbook, leitura de estados e interpretacao do resumo por IA
  - status: guia inicial criado para suporte e operacao do primeiro corte
  - referencia: `complementar`
- `docs/PRD-ai-diagnostic-scripts-tech-proposal.md`
  - foco: desenho tecnico do modulo de playbooks de diagnostico, runner isolado, suporte futuro a scripts, persistencia, auditoria, IA e canais externos
  - status: tecnico; abrir quando a tarefa for de implementacao estrutural
  - referencia: `tecnico`
- `docs/PRD-ai-diagnostic-scripts-implementation-plan.md`
  - foco: backlog por fases para implementar playbooks de diagnostico
  - status: tecnico; usar para planejar ou executar a entrega
  - referencia: `tecnico`
- `docs/PRD-agents-lite.md`
  - foco: agentes
  - status: frente separada; abrir so em tarefas especificas
  - referencia: `complementar`
- `docs/PRD-agents-onboarding-lite.md`
  - foco: onboarding, instalacao e validacao guiada de agentes nas maquinas dos usuarios
  - status: PRD criado; usar quando a tarefa tocar UX de setup, scripts, servico ou diagnostico do agente
  - referencia: `ativo`
- `docs/PRD-agents-governance-lite.md`
  - foco: governanca dos agentes
  - status: complementar
  - referencia: `complementar`

### Desempenho e tuning
- `docs/PRD-load-testing-lite.md`
  - foco: estrategia de testes de carga
  - status: plano definido
  - referencia: `complementar`
- `docs/PRD-load-testing-tech-proposal.md`
  - foco: execucao tecnica de testes de carga
  - status: tecnico; abrir so para implementacao
  - referencia: `tecnico`
- `docs/PRD-platform-tuning-lite.md`
  - foco: tuning da plataforma
  - status: abrir apenas para desempenho
  - referencia: `complementar`
- `docs/PRD-platform-tuning-tech-proposal.md`
  - foco: tuning tecnico
  - status: tecnico; evitar por padrao
  - referencia: `tecnico`

### Instalacao e operacao
- `docs/PRD-installation-packaging-backup-restore-lite.md`
  - foco: instalacao inicial, artefatos de release, backup e restore self-hosted
  - status: PRD criado; usar quando a tarefa tocar deploy operacional, empacotamento, runbook, backup ou restauracao
  - referencia: `ativo`
- `docs/PRD-ha-redundancy-dr-lite.md`
  - foco: alta disponibilidade, redundancia, active/passive, active-active parcial, VRRP, balanceador, backups, recuperacao de desastre e preparacao multi-node
  - status: guia operacional/arquitetural criado; usar quando a tarefa tocar HA, failover, DR, containers em maquinas diferentes, sizing resiliente ou desenho de cliente com virtualizador
  - referencia: `ativo`
- `docs/DECISION-ha-two-node-v1.md`
  - foco: escopo formal, garantias e limites do HA de dois nos fechado na versao 2.0.28, além da evolução posterior
  - status: decisão aceita; consultar antes de ampliar automação de promoção, failover ou topologia
  - referencia: `decisao`
- `docs/OPERATIONS-ha-dr-runbook-lite.md`
  - foco: comandos operacionais de backup, restore, checks de DR, harness agregado e doctor para recuperar/validar ambiente
  - status: runbook operacional criado; usar quando a tarefa tocar execucao pratica de DR, validacao de backup ou recuperacao
  - referencia: `ativo`
- `docs/PRD-installation-packaging-backup-restore-implementation-plan.md`
  - foco: backlog tecnico e ordem de execucao da frente operacional, incluindo recuperacao administrativa offline
  - status: plano tecnico criado; usar quando a tarefa for implementar scripts, compose, env, backup ou restore
  - referencia: `tecnico`

### SFTP e gerenciador de arquivos
- `docs/PRD-sftp-lite.md`
  - foco: melhorias funcionais e de UX do gerenciador de arquivos SFTP
  - status: PRD criado; prioridade imediata em itens de UX frontend-only (filtro, sort, single-click, atalhos), depois delete recursivo, audit log e multi-selecao
  - referencia: `ativo`

### CLI e acesso nativo
- `docs/PRD-platform-adoption-lite.md` (secao: Cliente terminal local)
  - foco: CLI Node.js para acesso sem browser (hosts, snippets, sessao SSH via WebSocket)
  - status: PRD documentado na secao de adocao; pendente decisao de inicio
  - referencia: `ativo`
- `docs/PRD-ssh-ca-lite.md`
  - foco: SSH Certificate Authority por usuario, acesso SSH direto sem proxy
  - status: PRD criado; pendente decisao sobre requisito de audit antes de implementar
  - referencia: `ativo`

### Regras especificas de SSH
- `docs/PRD-ssh-pem-password-lite.md`
  - foco: modo `PEM + password`
  - status: frente avaliada com ajuste de escopo
  - referencia: `complementar`

## Consolidacao de status

### Ja implementado ou majoritariamente implementado
- terminal fullscreen
- compartilhamento de terminal em sessao propria e sessao ao vivo
- quick switcher de hosts no terminal
- port forwarding com porta ativa e fallback
- web access integrado ao conceito de porta ativa
- host key trust
- preferencias persistidas por usuario
- dashboard pessoal
- dashboard admin de adocao no primeiro corte
- saude tecnica: `typecheck` do backend saneado

### Implementado, mas com refinamentos futuros
- sessao ao vivo:
  - retomada do viewer sem novo link
  - refinamentos de UX na transicao de controle
- dashboard pessoal:
  - comparativos com periodo anterior
  - sugestoes mais inteligentes
- dashboard admin:
  - comparativos e filtros mais ricos
- acessos locais:
  - refinamentos contextuais adicionais de UX
- adocao:
  - onboarding curto e telemetria adicional

### Futuro / estrutural
- IA local
- ISO 27001 como suporte a evidencia e governanca
- Jira integration
- agentes e governanca
- load testing e tuning mais profundos

## Sugestao de leitura minima
- para a maior parte das tarefas:
  - `docs/PRD-lite.md`
  - `docs/PRD-map-lite.md`
- abrir um PRD especifico so quando a tarefa cair nestes grupos:
  - terminal compartilhado: `docs/PRD-terminal-sharing-lite.md`
  - forwarding/web: `docs/PRD-port-forwardings-lite.md`
  - bastions: `docs/PRD-bastions-lite.md`
  - UX/adocao: `docs/PRD-platform-adoption-lite.md`
  - tenancy: `docs/PRD-tenancy-lite.md`
  - dashboard pessoal: `docs/PRD-user-dashboard-lite.md`
  - dashboard admin: `docs/PRD-admin-adoption-dashboard-lite.md`
  - auditoria: `docs/PRD-session-audit-lite.md`
  - snippets: `docs/PRD-snippets-lite.md`
  - secrets/vault: `docs/PRD-vault-secrets-lite.md`

## Candidatos a leitura rara
- `docs/prd-archive/PRD-terminal-fullscreen-lite.md`
- `docs/prd-archive/PRD-host-key-trust-lite.md`
- `docs/prd-archive/PRD-user-preferences-lite.md`
- `docs/prd-archive/PRD-web-access-lite.md`
- `docs/prd-archive/PRD-forwarding-ux-lite.md`

Observacao:
- esses arquivos ainda sao uteis, mas muito do que eles definem ja esta implementado ou consolidado em PRDs mais ativos
- nao recomendo apagar agora; recomendo tratá-los como referencia secundaria

## Recomendacao de uso por tarefa
- tarefa de UX ou produtividade:
  - `docs/PRD-platform-adoption-lite.md`
  - e um PRD de dominio especifico se necessario
- tarefa de terminal compartilhado:
  - `docs/PRD-terminal-sharing-lite.md`
- tarefa de forwarding/web:
  - `docs/PRD-port-forwardings-lite.md`
  - `docs/prd-archive/PRD-web-access-lite.md` se houver link/HTTP
- tarefa de auditoria:
  - `docs/PRD-session-audit-lite.md`
- tarefa de dashboard pessoal:
  - `docs/PRD-user-dashboard-lite.md`
- tarefa de dashboard admin:
  - `docs/PRD-admin-adoption-dashboard-lite.md`
- tarefa tecnica transversal:
  - abrir proposta tecnica apenas se a mudanca realmente for estrutural
- tarefa de SFTP / gerenciador de arquivos:
  - `docs/PRD-sftp-lite.md`
- tarefa de TLS / certificado / HTTPS de deploy:
  - `docs/PRD-tls-certificate-management-lite.md`
- tarefa de CLI ou acesso nativo sem browser:
  - `docs/PRD-platform-adoption-lite.md` (secao CLI)
  - `docs/PRD-ssh-ca-lite.md` (se tocar certificados SSH)
