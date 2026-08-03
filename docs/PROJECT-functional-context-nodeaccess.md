# NodeAccess - contexto funcional da solucao

Documento vivo para resumir os recursos, facilidades, integracoes e capacidades
da plataforma NodeAccess. Use este arquivo como contexto funcional em conversas
com assistentes, propostas, discovery tecnico/comercial e alinhamento interno de
produto.

## Instrucao de manutencao obrigatoria
Sempre que uma nova funcionalidade, facilidade operacional, integracao, modulo,
permissao, relatorio, agente, fluxo de acesso ou capacidade de seguranca for
adicionada, alterada ou removida, atualizar este documento junto com:

- `README.md`, quando a mudanca impactar a apresentacao geral, instalacao,
  operacao ou lista publica de recursos.
- `docs/PRD-lite.md`, quando a mudanca alterar regra de negocio, escopo atual,
  dominio principal ou prioridade de produto.
- `docs/PRD-map-lite.md`, quando a mudanca criar, arquivar ou reposicionar um
  PRD de dominio.
- `docs/PROJECT-value-summary.md`, quando a mudanca afetar proposta de valor,
  discurso comercial, beneficios ou prova de valor.
- PRD ou guia operacional especifico do dominio, quando houver impacto em uso,
  rollout, suporte, observabilidade ou seguranca.

Essa atualizacao deve fazer parte do Definition of Done de qualquer feature
relevante. A documentacao funcional deve acompanhar o produto, nao ser tratada
como tarefa posterior.

## Visao geral
O NodeAccess e uma plataforma web de acesso operacional seguro para ambientes
corporativos. O produto centraliza conexoes remotas, credenciais, politicas,
auditoria e produtividade em uma experiencia de browser, reduzindo dependencia
de clientes locais, arquivos de senha, chaves espalhadas e VPNs informais.

O foco principal e acesso a servidores, ativos de infraestrutura e ambientes
privados com governanca. O SSH continua sendo o protocolo central, mas a solucao
ja evolui para um modelo multi-protocolo com terminal textual, acesso grafico,
gateway nativo, agentes e conectores de acesso privado.

## Publico alvo
- Times de infraestrutura, redes, cloud, DevOps, SRE, NOC e suporte tecnico.
- Empresas que operam muitos hosts Linux, Windows, appliances, redes privadas
  ou ambientes de clientes.
- Operacoes que precisam de MFA, segregacao por grupo, auditoria, trilha
  administrativa e controle de credenciais.
- Gestores que precisam acompanhar adocao, sessoes, limites de licenca,
  relatorios e riscos operacionais.
- Equipes que querem permitir automacao e IA com governanca, sem expor
  credenciais sensiveis ou liberar acesso amplo fora de politica.

## Proposta de valor
O NodeAccess entrega uma camada unica para acesso, seguranca e produtividade:

- Acesso pelo navegador sem instalar cliente SSH no dispositivo do usuario.
- Suporte a cliente SSH nativo por gateway auditavel, quando o usuario preferir
  fluxo local.
- Credenciais protegidas no servidor, sem revelar senha, PEM, token ou segredo
  para o usuario final.
- Controle de acesso por usuario, grupo, tenant, escopo de host, licenca e
  permissoes administrativas.
- Auditoria de sessoes, comandos, logs administrativos, eventos MCP, agentes,
  gateway e webhooks.
- Acesso a redes privadas por bastion, agentes, conectores privados e modelos
  equivalentes a Zero Trust Network Access.
- Recursos de produtividade como favoritos, recentes, snippets, SFTP, links,
  forwarding, dashboards, assistente local e playbooks de diagnostico.

## Capacidades principais

### Terminal web e sessoes
- Terminal SSH via browser com xterm.js.
- Multiplas sessoes e abas de terminal.
- Busca e alternancia rapida de hosts no terminal.
- Fullscreen real do terminal e popout dedicado.
- Reconnect manual, limpeza de terminal sem encerrar sessao e preferencias por
  usuario.
- Compartilhamento de sessao ao vivo com viewer, pedido de controle, concessao
  temporaria, retomada pelo owner e trilha auditavel.
- Links autenticados e links JIT para acesso temporario, com expiracao, uso
  unico, PIN opcional, revogacao e auditoria.
- Indicadores de sessoes abertas em Hosts para visibilidade operacional pontual.
- A visao consolidada de sessoes deve evoluir no relatorio administrativo de
  sessoes, evitando duplicidade com uma tela separada de mapa de acessos.

### Acesso multi-protocolo
- SSH como protocolo principal.
- Telnet e serial como terminais textuais quando configurados.
- RDP e VNC por sessao grafica no browser usando gateway grafico/guacd quando
  habilitado.
- Modelo de evolucao para `ConnectionProfile`, separando asset gerenciado de
  perfil de acesso.
- Politicas e auditoria ajustadas por protocolo: comandos reconstruidos para
  protocolos textuais quando possivel e auditoria grafica/metadados para RDP/VNC.

### Inventario de hosts
- Cadastro, edicao, busca, filtros e organizacao de hosts.
- Escopos `personal`, `team` e `global`.
- Isolamento por tenant e visibilidade por grupo.
- Favoritos, recentes e dashboard pessoal para reduzir atrito de uso recorrente.
- Tags e pastas pessoais para organizacao individual da tela; pastas pessoais
  nao concedem, removem ou explicam permissao de acesso.
- Host dashboard com informacoes operacionais, diagnosticos, sessoes recentes,
  links e atalhos.
- Soft delete de hosts para preservar historico, auditoria e sessoes antigas sem
  manter o host ativo nos fluxos operacionais.
- Acoes em massa com preview, aplicacao controlada, relatorio, historico e
  rollback quando disponivel.
- Movimentacao em massa de hosts entre pastas corporativas com validacao de ACL
  do destino e restauracao da pasta anterior por rollback.
- ACL de inventario com permissoes de visualizar, conectar, editar e administrar.
- Inventario corporativo exibido separado de Minhas pastas; apenas a arvore
  corporativa participa da heranca e da administracao de ACL.
- ACL definida em pasta sempre e herdada pela subarvore; hosts aceitam apenas
  permissoes locais adicionais e nao exibem controle de heranca.
- Administracao direta da ACL de pastas corporativas a partir da tela de Hosts.
- Acoes de conectar, editar e administrar permissoes sao bloqueadas na interface
  quando a permissao efetiva correspondente nao estiver presente.
- Importacao por CSV, OpenSSH config e Apache Guacamole com pasta corporativa
  obrigatoria, previa da ACL efetiva e heranca aplicada desde a criacao.
- Fontes adicionais planejadas incluem MobaXterm e mRemoteNG.

### Credenciais, PEM e segredos
- Autenticacao em host por senha, PEM e PEM + senha.
- Cadastro de chaves PEM com armazenamento cifrado.
- Conversao de PPK sem senha para formato OpenSSH quando suportado.
- Vault de secrets para valores sensiveis reutilizaveis.
- Referencias `{{secret:alias}}` em snippets e fluxos operacionais sem revelar
  valor sensivel.
- Integracao com 1Password por referencia `op://...`, resolvendo segredo apenas
  em memoria durante a sessao.
- Politica de nunca expor senha, PEM, token ou segredo resolvido na API ou no
  frontend.

### Bastions, agentes e acesso privado
- Bastion host/jump server por host ou herdado por grupo.
- Visibilidade de impacto antes de alterar ou excluir bastions.
- Reuso preferencial de PEM cadastrada para bastion.
- Agentes com conexao outbound por WebSocket para permitir acesso a redes sem
  exposicao direta.
- Modos de conectividade por host: direto, agente do usuario, agente do tenant,
  fallback explicito e automatico governado.
- Diagnostico de agente, status online/offline, heartbeat, origem da conexao e
  validacao de conectividade.
- Evolucao dos agentes para dois modos:
  - `proxy_agent`: comportamento atual, simples, para tunelamento operacional.
  - `private_access_connector`: modo Zero Trust NodeAccess, com agente de
    servico, escopo de rede, CIDRs, portas, politicas, health e auditoria forte.
- Uso do agente como bastion operacional: um agente instalado em uma maquina
  servidora pode acessar outros hosts que essa maquina alcanca, desde que o
  escopo privado permita os destinos.
- Recomendacao de seguranca: evitar escopos amplos como `0.0.0.0/0` em producao,
  salvo excecao controlada, auditada e intencional.

### SFTP, arquivos, links e acessos locais
- Gerenciador de arquivos SFTP integrado ao host.
- Operacoes de arquivo dentro do browser, respeitando credencial e permissao do
  host.
- Catalogo de links operacionais associados a hosts.
- Placeholders simples em links, como IP/FQDN do host.
- Acessos locais e port forwarding com porta preferida, porta ativa e fallback.
- Web access para abrir servicos HTTP/HTTPS atraves de forwarding controlado.
- Tela consolidada de links e tela de SSH tunnels/forwardings.

### Snippets, automacao e politicas de comando
- Snippets de comandos para execucao rapida e padronizada no terminal.
- Snippets com referencias a secrets sem armazenar segredo em claro.
- Quick picker e atalhos operacionais para reduzir comandos repetitivos.
- Politicas de comando para bloqueio, governanca e reducao de risco em sessoes.
- Base para macros e automacoes operacionais auditaveis.

### Auditoria, logs e relatorios
- Auditoria de sessoes SSH com eventos, comandos reconstruidos quando possivel e
  detalhe por sessao.
- Replay textual/event-based como evolucao da auditoria.
- Logs administrativos de criacao, edicao, revogacao e uso de recursos.
- Relatorios de sessoes, logs, snippets, tunels SSH, adocao, UX do cliente e
  host keys.
- Tratamento de host key trust com deteccao de mudanca, aceite explicito,
  historico e auditoria.
- Relatorio administrativo de sessoes como visao canonica para acompanhar
  sessoes, historico e evolucao futura de sessoes ativas.
- Indicadores pontuais de sessoes abertas em Hosts, com permissao dedicada
  quando aplicavel.
- Auditoria especifica para SSH Gateway nativo, MCP, agentes e webhooks.

### Dashboards e produtividade
- Dashboard pessoal com atalhos, hosts recentes/favoritos, metricas e uso
  individual.
- Dashboard administrativo de adocao e visao de uso por usuario.
- Dashboard de host com contexto operacional do ativo.
- Comando global/palette para navegacao rapida.
- Indicadores de loading, recuperacao de reload stale e telemetria de UX do
  cliente.
- Feedback do usuario dentro do produto, com inbox administrativo, status e
  resposta.

### IA, MCP e diagnosticos
- Assistente local no frontend, com contexto da tela atual.
- Playbooks de diagnostico executados de forma controlada via SSH.
- Detalhe de execucao por comando, estado, erro e resumo assistido por IA.
- Modulo de `ActionRun` para evoluir automacoes operacionais governadas.
- MCP Server do NodeAccess para expor contexto e tools a assistentes externos.
- Tokens MCP com escopo por capability, host permitido, expiracao, auditoria,
  rate limit e revogacao.
- Recursos MCP para hosts, dashboards, sessoes, auditorias, comandos,
  snippets, playbooks e diagnostic runs.
- Diretriz de seguranca: MCP deve reutilizar services existentes, aplicar tenant,
  permissoes e escopo, e nunca revelar segredos.

### Integracoes
- Google SSO para login com conta Google.
- Google Workspace para provisionamento/desativacao basica de usuarios.
- 1Password para resolucao governada de credenciais por referencia.
- Jira como frente documentada para correlacao com tickets.
- LDAP/Active Directory como provider opcional documentado para autenticacao,
  provisionamento e sincronizacao futura.
- Webhooks outbound com eventos, assinatura, retry, deliveries e auditoria.
- Webhooks inbound para receber eventos externos com autenticacao, idempotencia,
  normalizacao e processamento desacoplado.
- AWS Secrets Manager aparece como provider documentado na area de integracoes.
- Email/OTP e configuracao de e-mail para fluxos de seguranca e comunicacao.

### Administracao, tenancy e licenciamento
- Usuarios, grupos, papeis e permissoes como `admin`, `user`,
  `canManageHosts` e `canViewLiveSessions`, esta ultima voltada a visibilidade
  de sessoes abertas/presenca operacional.
- Platform admin para gestao de tenants e superadmins.
- Multi-tenant com isolamento operacional e licenciamento por tenant.
- Entitlements por modulo: hosts, snippets, acessos locais, integracoes,
  agentes, secrets, feedback, MCP e outros limites comerciais.
- Configuracoes administrativas, e-mail, integracoes, bastions, webhooks,
  gateway SSH nativo, politicas de comando, relatorios e auditoria.
- Usuarios desativados nao consomem licenca.
- Limites de licenca devem ser aplicados no servidor.

### SSH Gateway nativo
- Gateway SSH para acesso por cliente SSH nativo sem expor credenciais do host ao
  usuario final.
- Autenticacao no NodeAccess, MFA, rate limit, logs, resolucao de host e
  aplicacao de permissao antes da conexao.
- Permite preservar fluxo tecnico local quando o usuario prefere terminal
  nativo, mantendo governanca central.
- Eventos auditaveis: login aceito/negado, MFA, host solicitado, conexao aberta,
  encerrada ou com falha.

### Seguranca
- Login local com JWT, refresh token e MFA/TOTP obrigatorio.
- Google SSO como opcao secundaria.
- Email OTP quando configurado.
- Credenciais e chaves cifradas em repouso.
- Segredos resolvidos somente no backend e apenas durante o uso necessario.
- Isolamento por tenant, grupos e escopos de host.
- Politicas explicitas para conectividade e sem fallback silencioso em caminhos
  sensiveis.
- Auditoria administrativa e operacional.
- Host key trust para detectar troca de chave SSH.
- Revogacao de links, tokens, agentes e sessoes quando aplicavel.
- Rate limit e escopos para MCP e SSH Gateway nativo.

### Deploy, operacao e escala
- Monorepo com frontend Vue 3/TypeScript/Naive UI/xterm.js, backend
  Node.js/Fastify/WebSocket/ssh2, MySQL/Prisma, Redis, Docker e Nginx.
- Separacao entre API REST e gateway WebSocket/SSH.
- Deploy via Docker Compose, imagens de registro e scripts de instalacao.
- Suporte a backup, restore, rollback, doctor script e empacotamento de release.
- HA active/passive como perfil opcional e isolado, com replicacao de MySQL,
  Redis e arquivos, fencing/witness, promoção e rejoin protegidos por gates.
  O painel diferencia bloqueios reais de estados transitórios, exibe idade do
  heartbeat, transferência da VIP, progresso e journal persistente por etapa.
  Papel do agente e prioridade do Keepalived são persistidos pelos scripts de
  promoção/rejoin; isolamento externo continua exigindo confirmação humana.
  Na versão 2.0.28, o suporte formal fica limitado a dois nós de dados: um
  `PRIMARY` e um `STANDBY`; topologias com três ou mais nós ficam reservadas
  para a evolução com quorum, lease distribuído e fencing por nó.
- Estrategia de performance documentada para paginas, APIs, payload,
  carregamento visual e testes com muitos hosts.
- Alvo inicial de ate 300 usuarios, com preocupacao explicita em baixa latencia
  e escala progressiva do catalogo de hosts.

## Navegacao funcional atual
Areas principais para usuario autenticado:

- Home/Dashboard.
- Hosts.
- Chaves PEM.
- Agentes.
- Snippets.
- Secrets.
- Links.
- SSH Tunnels/Acessos locais.
- Feedback.
- Assistente.
- Terminal, terminal compartilhado, terminal popout, sessao grafica e arquivos.
- Perfil.

Areas administrativas:

- Dashboard administrativo.
- Usuarios.
- Grupos.
- Playbooks de diagnostico.
- Tokens MCP.
- Bastions.
- Integracoes.
- Webhooks.
- Feedbacks.
- Relatorios.
- Logs.
- Auditoria de sessao.
- SSH Gateway.
- Politicas de comando.
- Configuracoes.
- Configuracao de e-mail.

Areas de plataforma:

- Tenants.
- Superadmins.

## Casos de uso representativos
- Abrir terminal SSH pelo browser sem instalar cliente local.
- Acessar host privado via bastion, agente ou conector privado.
- Usar agente como ponte/bastion de rede para outros hosts alcancaveis por uma
  maquina servidora.
- Acessar servidor Windows por RDP no browser quando gateway grafico estiver
  habilitado.
- Usar cliente SSH nativo passando pelo SSH Gateway do NodeAccess.
- Cadastrar PEM uma vez e reutilizar em hosts e bastions sem expor o valor.
- Criar snippets padronizados com secrets referenciados.
- Abrir SFTP para investigar ou coletar arquivos de um host.
- Criar link temporario JIT para acesso pontual e auditado.
- Compartilhar uma sessao ao vivo com outro usuario e conceder controle
  temporario.
- Executar playbook de diagnostico e gerar resumo assistido por IA.
- Consultar mapa de acessos para ver sessoes ativas e concorrencia.
- Criar token MCP para um assistente consultar hosts, sessoes e auditoria dentro
  de escopo governado.
- Enviar eventos para sistemas externos via webhooks ou receber eventos externos
  via inbound webhooks.
- Acompanhar adocao por dashboard, relatorios e feedbacks.

## Diferenciais
- Une produtividade tecnica e governanca em uma unica camada.
- Permite browser e cliente SSH nativo, sem abandonar preferencias do usuario.
- Mantem credenciais protegidas e centralizadas.
- Cria caminho proprio para acesso privado estilo Zero Trust usando agentes do
  NodeAccess, sem depender obrigatoriamente de Cloudflare ou Tailscale.
- Trata IA e MCP como interfaces governadas, com auditoria e escopo, em vez de
  acesso irrestrito.
- Preserva historico e auditoria mesmo quando recursos operacionais sao
  removidos ou desativados.
- Tem foco explicito em adocao: menos atrito, mais visibilidade e ferramentas
  proximas da rotina real de infraestrutura.

## Observacoes para uso como contexto em chat
Ao usar este documento como contexto para um assistente, considerar que:

- O NodeAccess nao e apenas terminal web; e uma plataforma de acesso operacional
  seguro.
- SSH e o centro historico do produto, mas o roadmap e a implementacao ja
  apontam para multi-protocolo, agentes, ZTNA, MCP e automacao governada.
- Nem todo PRD representa recurso totalmente finalizado; quando necessario,
  diferenciar recurso implementado, implementado com refinamentos futuros e
  frente documentada para evolucao.
- A regra de negocio deve ser confirmada em `docs/PRD-lite.md` e no PRD de
  dominio correspondente antes de alterar comportamento.
