# PRD Lite - NodeAccess

Versao curta para agentes. Use este arquivo antes de `docs/PRD.txt`.
Para decidir qual PRD detalhado abrir depois, use `docs/PRD-map-lite.md`.
Para contexto funcional completo da solucao, use
`docs/PROJECT-functional-context-nodeaccess.md`.

## Manutencao documental obrigatoria
Sempre que uma nova funcionalidade, facilidade operacional, integracao, modulo,
agente, permissao, relatorio ou recurso de seguranca for adicionado, alterado ou
removido, atualizar tambem:
- `docs/PROJECT-functional-context-nodeaccess.md`
- `docs/PROJECT-value-summary.md`, quando afetar valor, beneficios ou prova de
  valor
- `README.md`, quando afetar apresentacao, instalacao, operacao ou lista geral
  de recursos
- `docs/PRD-map-lite.md`, quando criar, mover ou arquivar PRDs
- PRD ou guia operacional do dominio afetado

Essa regra faz parte do Definition of Done de features relevantes.

## Produto
Plataforma web para acesso SSH via browser, com experiencia semelhante ao MobaXterm, sem cliente local. Foco em seguranca, rastreabilidade e baixa latencia.

## Objetivos
- centralizar acesso SSH via browser
- suportar ate 300 usuarios com controle por licenca
- permitir deploy via Docker
- manter latencia de terminal abaixo de 50 ms no p95

## Criterios de sucesso inicial
- garantir adocao real pelos usuarios dentro da empresa
- reduzir atrito nas operacoes do dia a dia, evitando que o usuario precise sair do NodeAccess para tarefas comuns
- reduzir ao maximo o atrito para baixar, instalar, configurar e executar agentes nas maquinas dos usuarios
- manter alta estabilidade e confiabilidade nas integracoes prioritarias:
  - 1Password
  - JIRA
  - Google Workspace
- manter alta estabilidade e previsibilidade no fluxo de agentes, especialmente em cenarios com VPN, usuario proprio por maquina e conectividade menos uniforme
- tratar qualquer recurso novo de UX, IA ou automacao como secundario se comprometer a confiabilidade dessas integracoes-base

## Checklist de priorizacao e rollout
Antes de priorizar ou liberar uma feature nova, validar:
- melhora a adocao real ou reduz atrito operacional no uso diario?
- reduz ou ao menos nao aumenta o atrito para instalar e operar agentes?
- preserva ou melhora a estabilidade das integracoes prioritarias?
- preserva ou melhora a confiabilidade do fluxo de agentes em ambientes com VPN e credenciais proprias?
- evita aumentar complexidade perceptivel para o usuario final?
- falha de forma segura sem quebrar login, terminal ou fluxos principais?
- tem observabilidade suficiente para diagnostico e suporte?
- pode ser desligada ou escondida com baixo risco se houver regressao?

Se a resposta for `nao` para adocao, confiabilidade das integracoes-base ou experiencia dos agentes, a feature nao deve entrar na frente das prioridades principais.

## Stack e arquitetura
- frontend: Vue 3 + TypeScript + Naive UI + xterm.js
- backend: Node.js + Fastify + WebSocket + ssh2
- dados: MySQL + Prisma + Redis
- infra: Docker + Nginx
- fluxo: browser -> WSS -> backend -> SSH -> host
- com bastion: browser -> backend -> bastion -> host

## Dominios principais
- autenticacao com login local, JWT e TOTP obrigatorio
- integracao Google com dois papeis:
  - `Google SSO` para login com conta Google
  - `Google Workspace` para refletir ciclo de vida de usuarios no NodeAccess
- hosts com escopo `personal`, `team` e `global`
- conexao SSH com `password` ou `PEM`
- bastion host por grupo ou por host
- SFTP para operacoes de arquivo
- integracao com 1Password por referencia `op://...`
- licenciamento por usuarios ativos

## Regras de negocio que mais impactam codigo
- 2FA via TOTP e obrigatorio; nao pode ser desabilitado
- login pode ser local; Google SSO e opcao secundaria
- objetivo inicial da integracao Google:
  - permitir login com conta Google
  - criar usuario no NodeAccess de forma padrao a partir da identidade Google, quando permitido
  - desativar usuario no NodeAccess quando ele for desativado ou removido no Google Workspace
  - neste primeiro momento, o foco nao e sincronizacao completa de atributos ou grupos; e autenticacao + provisionamento/desativacao basicos
- usuarios desativados nao consomem licenca
- criacao de usuario acima do limite da licenca deve ser bloqueada no servidor
- configuracoes de licenca persistidas no banco sao a fonte primaria em producao; overrides por `.env` servem apenas para desenvolvimento/testes locais
- configuracoes globais ficam em Plataforma e sao restritas a superadmins; configuracoes operacionais ficam no tenant e admins comuns veem licenca/consumo apenas para consulta
- quotas, modulos e providers licenciados so podem ser alterados por superadmin para um tenant explicitamente selecionado, com auditoria e bloqueio de reducao abaixo do consumo atual
- usuario sem permissao nao pode cadastrar ou editar hosts
- antes de salvar host, o sistema pode testar conectividade
- host com sessoes, auditorias ou referencias operacionais historicas nao deve falhar com `500` ao excluir; o sistema deve bloquear a exclusao com erro claro e seguro
- exclusao de host deve ser `soft delete` por padrao, preservando sessoes, auditorias e referencias historicas sem manter o host ativo nos fluxos operacionais
- quando um host estiver em `soft delete`, telas historicas e dashboards podem exibi-lo com badge clara de `host excluido`, mas atalhos operacionais nao devem reabrir conexao para esse destino
- em bases com muitos hosts, a tela principal de `Hosts` deve usar paginacao server-side por filtro `all/global/unfiled/folder/group/tag`, sem depender de carregar todo o catalogo no cliente
- contadores da sidebar de `Hosts` devem vir de endpoint leve de resumo, nao de agregacao local sobre catalogo completo baixado no browser
- `favoritos` e `recentes` em `Hosts`, dashboard pessoal e host switcher do terminal devem resolver apenas os hosts necessarios por IDs, evitando `listagens amplas` como suporte estrutural da UI
- busca em `Hosts` deve responder imediatamente com dados locais em cache quando disponiveis e sincronizar com backend em segundo plano, preservando corretude final sem travar digitacao
- a tela de `Hosts` deve priorizar cache derivado no frontend para dados de exibicao repetidos por item visivel, como labels, tooltips, links resolvidos, flags de acao e metadados visuais, evitando recalculo direto no template
- polling e refresh automatico devem respeitar visibilidade da aba e contexto real de uso, evitando consultas recorrentes sem valor operacional
- telas administrativas e fluxos historicos relevantes devem ter observabilidade minima de payload e duracao no backend para permitir calibracao progressiva de performance sem otimizacao cega
- reconexao do terminal deve ser manual; usuario controla a tentativa
- limpar terminal nao encerra sessao SSH
- expiracao da sessao web deve remover acesso a UI e, na politica segura atual, encerrar sessoes SSH do navegador ao voltar para login
- manter sessoes SSH vivas apos expiracao da sessao web e uma evolucao futura, nao comportamento padrao
- secrets nunca devem ser expostos na API ou persistidos em claro

## Regras de visibilidade
- hosts `personal` sao visiveis apenas ao dono
- hosts `team` sao visiveis ao grupo
- hosts `global` sao definidos pelo admin
- pastas de hosts sao pessoais por usuario; nao existe pasta de equipe no modelo atual
- grupos exibidos na sidebar seguem pertencimento:
  - admin ve todos os grupos do tenant
  - usuario comum ve apenas grupos dos quais participa

Evolucao em estudo:
- `docs/PRD-host-inventory-acl-lite.md` define a direcao futura para separar
  inventario corporativo, ACL por arvore com heranca e views pessoais de
  produtividade.
- nessa evolucao, `personal/team/global` deixam de ser a estrutura principal de
  navegacao e passam a ser migrados para ACL/politicas equivalentes.
- hosts pessoais em ambiente corporativo devem ser tratados como recurso
  gerenciado por politica do tenant/grupo, nao como recurso invisivel para
  administradores.

## Google
- `Google SSO` e `Google Workspace` devem coexistir na mesma integracao, mas com responsabilidades separadas
- a fonte principal da configuracao Google atual fica na integracao salva no banco, nao nas variaveis legadas do `.env`
- `Google SSO`:
  - usa `clientId`
  - permite login com conta Google
  - pode restringir por dominio quando configurado
- `Google Workspace`:
  - usa `domain`, `adminEmail` e `service account`
  - serve para detectar usuarios desativados ou removidos e refletir isso no NodeAccess
  - `autoProvision` pode criar o usuario local de forma padrao no primeiro login Google, quando habilitado

## SSH e segredos
- host pode usar credencial local ou referencia do 1Password
- se `one_password_ref` estiver preenchido, a credencial resolvida substitui password/PEM local na conexao
- segredo do 1Password existe apenas em memoria durante a sessao
- PEM e tokens devem ficar cifrados em repouso
- segredos operacionais para comandos devem ser tratados como recurso proprio de Vault, nao como texto dentro de snippet
- snippets e macros podem referenciar secrets, mas nao devem armazenar valor sensivel em `command`
- a UI deve deixar claro quando um snippet ou recurso usa `secret X` ou `secret Y`, sem revelar o valor
- detalhe curto em:
  - `docs/PRD-vault-secrets-lite.md`
  - `docs/PRD-snippets-lite.md`

## Entidades principais
- `User`: identidade, papel, MFA, status, permissao de hosts
- `Group`: agrupamento de acesso
- `Host`: destino SSH, auth, escopo, owner/group, bastion opcional
- `BastionHost`: salto para redes privadas
- `PemKey`: chave privada cifrada
- `Integration`: provider externo e config cifrada
- `Session`: sessoes SSH
- `AuthLog` e `AdminLog`: auditoria
- `License`: limite de usuarios

## Bastions
- bastion deve ficar claro como recurso de conectividade por host ou grupo
- UI deve indicar bastion efetivo e origem:
  - direto no host
  - herdado do grupo
  - sem bastion
- a tela de bastions deve mostrar quais hosts/grupos usam cada bastion antes de alteracao/exclusao
- evolucao recomendada:
  - reaproveitar PEM cadastrada no sistema como fluxo principal
  - manter senha/PEM cifrados e sem exibicao do valor
- detalhe curto em `docs/PRD-bastions-lite.md`

## Fora do escopo imediato
- WinRM
- app mobile nativo
- gravacao grafica completa como video forense obrigatorio para todos os
  protocolos

Observacao: RDP/VNC/Telnet/serial deixaram de ser apenas backlog generico e
passam a ser guiados por `docs/PRD-multi-protocol-access-lite.md`.
LDAP/Active Directory passa a ser guiado por
`docs/PRD-ldap-integration-lite.md`.

## Backlog avaliado
### Faz sentido priorizar
- fullscreen real do terminal pelo browser, com botao explicito e saida visivel sem depender do teclado:
  - melhora UX direto
  - baixo risco tecnico
  - combina com preferencias de usuario como evolucao posterior
  - detalhe curto em `docs/prd-archive/PRD-terminal-fullscreen-lite.md`
- tratamento de mudanca de host key com aviso claro, bloqueio seguro e fluxo de confianca/atualizacao controlada:
  - e importante para seguranca operacional
  - reduz erro humano em troca legitima de chave
  - deve ficar no backend como regra primaria com UX explicativa no frontend
  - detalhe curto em `docs/prd-archive/PRD-host-key-trust-lite.md`
  - status atual:
    - fase 1 concluida: deteccao, bloqueio, modal de confianca e reconexao assistida
    - fase 2 concluida: estado atual no host, historico curto e auditoria com fingerprint anterior/nova
- persistir sessao de terminal quando cair apenas a conexao browser-WSS, sem manter segredo vivo de forma insegura:
  - faz sentido como evolucao
  - precisa separar queda de websocket de expiracao da sessao web
  - deve nascer com limite de tempo curto, retomada manual e sem quebrar a politica segura atual
  - para reinicio temporario do backend, `KeepAlive` nao resolve sozinho
  - a direcao melhor e combinar heartbeat global autenticado no frontend com deteccao de queda/retorno do websocket para recarga controlada da UI
  - investigacao futura de bug:
    - em ambiente local, reinicio temporario do backend pode levar a `sessao expirada` cedo demais mesmo com refresh token valido
    - validar diferenca entre indisponibilidade transitória do backend e refresh token realmente invalido/expirado
    - revisar especialmente terminal e sessao ao vivo, que hoje tentam refresh preventivo durante o ping
- compartilhamento controlado de acesso ao terminal:
  - faz sentido dividir em duas frentes:
    - `host link`
    - `shared terminal session`
  - recomendacao:
    - primeiro resolver entrada com link
    - depois colaboracao em tempo real na mesma sessao
  - detalhe curto em `docs/PRD-terminal-sharing-lite.md`
  - nomenclatura recomendada:
    - `Abrir em sessao propria` para `host link`
    - `Compartilhar sessao ao vivo` para `shared terminal session`
  - para `host link`, o padrao recomendado e `link autenticado interno`
  - `link publico de uso unico` tambem faz sentido como opcao avancada, desde que:
    - tenha expiracao curta `5/10/30 min`
    - seja realmente uso unico
    - tenha revogacao
    - tenha auditoria forte
  - para `shared terminal session`, a diretriz tecnica recomendada e baixo acoplamento:
    - modulo proprio no backend
    - camada propria de presenca/controle no frontend
    - rollback simples para `viewer-only` ou feature flag, sem impactar o terminal individual
  - desenho tecnico inicial recomendado:
    - fase 3.1 como `viewer-first`
    - owner cria sessao compartilhada a partir de sessao ativa
    - viewer entra por link autenticado interno
    - apenas owner envia input no primeiro corte
    - output e presenca seguem por canal dedicado
  - status atual:
    - modelagem e contratos compartilhados concluidos
    - modulo HTTP desacoplado concluido
    - presenca/output em canal dedicado concluido no backend
    - UI minima de compartilhamento e entrada viewer concluida
    - proximo corte: `Fase 3.2` com pedido de controle, lease curto, owner com revogacao imediata, logs de permissao em `AdminLog` e contexto multiusuario refletido em `SessionAudit`
    - ordem sugerida:
      - dados + schemas
      - service HTTP + logs
      - arbitragem no gateway
      - UI owner/viewer
      - enrich de auditoria
    - status atual da 3.2:
      - dados + schemas concluidos
      - service HTTP + logs concluidos
      - arbitragem no gateway concluida no backend
      - UI owner/viewer concluida no frontend
      - enrich de `SessionAudit` concluido no detalhe da auditoria
      - owner pode retomar o controle a qualquer momento, sem esperar o fim da lease do participante
      - ajuste fino futuro de UX:
        - ao conceder controle ao participante, a viewport do terminal ao vivo ainda pode deslocar levemente antes de se recompor no primeiro comando/output
        - tratar como refinamento visual da transicao de controle, nao como bug critico
      - evolucao futura de retomada:
        - se o viewer fechar a janela por engano ou sair da sessao ao vivo sem invalidar o link, a tela principal pode indicar que a sessao compartilhada ainda esta ativa
        - se o link ainda estiver valido e o usuario continuar autorizado, ele deve conseguir voltar a acompanhar sem depender de um novo link enviado pelo owner
        - a retomada deve respeitar expiracao, revogacao, tenant e acesso atual ao host
      - proximo corte: expandir esse contexto colaborativo para lista, filtros ou timeline administrativa se fizer sentido
- saude tecnica do backend:
  - saneamento do `typecheck` do backend concluido
  - ajuste focado em tipagem e manutencao, sem alterar regra funcional
  - blocos cobertos:
    - `redis`, `auth`, `google`
    - `dashboard` e `server`
    - rotas Fastify principais
    - `logs`, `pem-keys`, `session-audit-policy`
    - `sftp`
    - declaracao local minima para `ws`
  - status atual:
    - `npm run typecheck -w apps/backend` passando

### Faz sentido com ajuste de escopo
- login com usuario e senha + chave:
  - faz sentido apenas se o objetivo for autenticar no host com dois fatores de credencial no mesmo fluxo
  - nao faz sentido como variacao de login da plataforma
  - deve ser tratado como novo modo de autenticacao SSH por host, com regra clara de quando usar `password+key`
  - detalhe curto em `docs/PRD-ssh-pem-password-lite.md`
- IA local com SLM/LLM:
  - faz sentido como frente futura, desde que nasca desacoplada do terminal e opcional no frontend
  - recomendacao de arquitetura:
    - provider abstrato
    - implementacao inicial via `Ollama`
    - modelo inicial sugerido: `qwen2.5-coder`
    - knowledge base separada da execucao remota
    - politica de acao separada da conversa
  - recomendacao de produto:
    - fase 1 em `somente leitura`
    - fase 2 com base de conhecimento local
    - fase 3 com execucao remota `baixo impacto`
    - controle total apenas em fase posterior e opcional
  - status atual do acesso MCP/IA:
    - governanca por token MCP persistido concluida para capabilities, modos de `ActionRun`, expiracao e `allowedHostIds`
    - full access governado por `ActionRun` concluido para ator admin efetivo, com revalidacao de policy e auditoria
    - shell interativo livre via MCP concluido no primeiro corte para tokens com `full_operational_access`, capabilities interativas e host permitido
    - auditoria administrativa concluida para chamadas, negacoes, rate limit e eventos `MCP_INTERACTIVE_SSH_*`
    - persistencia consolidada de sessoes MCP shell concluida em `mcp_interactive_ssh_sessions`
    - consulta administrativa de sessoes MCP shell concluida, incluindo filtros, navegação por token e encerramento administrativo
  - proximos passos recomendados:
    - checklist final de producao para liberar clientes com acesso full via IA
    - estrategia para multi-replica, sticky routing ou registry compartilhado das sessoes interativas
    - regra de revogacao imediata de token e impacto sobre sessoes MCP shell ja abertas
    - endurecimento operacional adicional por ambiente, tenant e token, se a exposicao crescer
  - detalhe curto em `docs/PRD-local-ai-lite.md`
- webhooks de saida:
  - faz sentido como frente de integracao para eventos de alto valor do NodeAccess
  - recomendacao:
    - modulo proprio e assíncrono
    - `outbox pattern` simplificado com persistencia e worker
    - assinatura HMAC por entrega
    - payload enxuto e versionado
    - rollout inicial com poucos eventos de alto valor
  - detalhe curto em `docs/PRD-webhooks-lite.md`
  - proposta tecnica em `docs/PRD-webhooks-tech-proposal.md`
- aderencia a ISO 27001:
  - faz sentido como frente de produto, desde que tratada como suporte ao SGSI e nao como promessa de certificacao automatica
  - foco recomendado:
    - evidencias
    - retenção
    - revisao de acesso
    - trilha administrativa
    - exportacao e relatorios
  - gap analysis em `docs/ISO27001-gap-analysis.md`
  - detalhe curto em `docs/PRD-iso27001-lite.md`
- playback de sessao SSH:
  - faz sentido como evolucao direta da auditoria atual, sem entrar em gravacao de video
  - recomendacao:
    - replay textual/event-based do terminal usando os chunks JSONL ja capturados
    - terminal read-only com xterm.js
    - timeline de comandos/eventos e controles simples de reproducao
    - acesso restrito por tenant/permissao, com cuidado especial para `stdin`
  - detalhe curto em `docs/PRD-session-playback-lite.md`
- dashboard administrativo de adocao:
  - faz sentido separar do dashboard pessoal e do dashboard admin operacional atual
  - foco recomendado:
    - usuarios mais ativos
    - hosts mais acessados
    - telas mais acessadas
    - recursos mais utilizados
    - usuarios vs recursos
  - detalhe curto em `docs/PRD-admin-adoption-dashboard-lite.md`
- quick switcher de hosts no terminal:
  - faz sentido como frente de adocao e UX para tecnicos que operam varios hosts no mesmo fluxo
  - foco recomendado:
    - quick picker dentro do terminal
    - favoritos e recentes
    - atalho configuravel por usuario
    - hover apenas como opcional futuro
  - detalhe curto em `docs/PRD-terminal-host-switcher-lite.md`
- aliases de hosts no SSH Gateway:
  - faz sentido como proximo passo de UX apos estabilizar os formatos de conexao direta
  - objetivo:
    - permitir conectar por apelido curto do host, sem depender de IP ou nome completo
    - reduzir erro de digitacao e atrito para operacao diaria
  - exemplos desejados:
    - `ssh -p 2222 'usuario_nodeaccess@prod-db'@ip_publico_nodeaccess`
    - `ssh -p 2222 'usuario_nodeaccess@root@prod-db'@ip_publico_nodeaccess`
  - escopo recomendado:
    - adicionar `alias` ao host, unico por tenant
    - resolver alias no mesmo fluxo de nome, IP e `#ID`
    - exibir alias em `sshs`, `hosts` e listagens relevantes
    - manter auditoria sobre o host resolvido, sem expor segredo
  - nao deve alterar autenticacao, permissao ou isolamento de acesso; alias e apenas identificador amigavel
- testes de carga e desempenho:
  - faz sentido como frente transversal para medir capacidade real da plataforma sem acoplar testes ao produto
  - foco recomendado:
    - API
    - gateway SSH/websocket
    - dashboards
    - terminal e sessao compartilhada
    - impacto de auditoria e logs
  - detalhe curto em `docs/PRD-load-testing-lite.md`

### Ja existe parcial ou totalmente
- snippets com atalho para abrir no terminal:
  - ja existe painel de snippets no terminal
  - ja existe atalho para abrir snippets
- macro/snippet de inicializacao por host:
  - faz sentido para rotinas como elevar privilegio, diagnostico inicial e sequencias operacionais repetidas
  - configuracao deve ficar no host, sem alterar o backend SSH de execucao de comandos
  - deve ser opt-in por host, com modos `desativado`, `sugerir ao conectar` e `executar automaticamente`
  - deve aparecer/aplicar apenas em protocolos com terminal web de texto; protocolos graficos devem limpar a configuracao para evitar estado sem efeito
  - modo sugerido reduz risco e friccao de adocao; automatico deve ficar explicito na UI
  - auditoria deve registrar configuracao/execucao por usuario, host e snippet, sem armazenar conteudo sensivel ou valor de secret
  - snippets podem referenciar secrets via Vault, mantendo valores sensiveis fora da configuracao do host
- autocomplete do terminal:
  - faz sentido como frente de adocao do terminal e produtividade operacional
  - deve ser habilitado por tenant e opcional por usuario
  - primeiro corte recomendado: sugestoes de snippets por gatilho `sni `, sem execucao automatica
  - evoluir depois para password suggestions mascaradas, command suggestions e IA opcional
  - shell integration deve ser fase posterior e opt-in, sem injecao automatica no host remoto por padrao
  - detalhe curto em `docs/PRD-terminal-autocomplete-lite.md`
- snippets pessoais e da organizacao:
  - ja existe escopo pessoal
  - ja existe escopo de equipe/tenant compartilhado
  - evolucao mais util agora e melhorar descoberta, filtro e governanca, nao recriar o conceito base
  - PRD dedicado criado em `docs/PRD-snippets-lite.md`
  - segredos devem ser referenciados via Vault, nao salvos no snippet
- vault de secrets:
  - faz sentido como recurso reutilizavel, nao exclusivo de snippets
  - primeira evolucao recomendada:
    - modelo proprio de `Secret`
    - criptografia em repouso
    - ACL por usuario/grupo/tenant
    - auditoria de uso sem valor sensivel
    - UX explicita indicando qual secret sera usado
  - detalhe curto em `docs/PRD-vault-secrets-lite.md`
- port forwarding associado ao host:
  - ja existe associacao por host no modelo e na UI de host
  - o host ja exibe forwardings relacionados
  - a evolucao mais util agora e unificar a entrada de criacao e simplificar a linguagem

### Faz sentido priorizar na frente de port forwarding
- normalizar termos de produto:
  - escolher um termo principal e aplicar no menu lateral, pagina dedicada, modal e painel da sessao
  - recomendacao: usar `Acessos locais` como nome de produto na UI e manter `port forwarding SSH` como subtitulo/ajuda tecnica
  - evitar alternar entre `Tunis SSH`, `tunnel`, `forwarding` e `port forwarding` no mesmo fluxo
- simplificar o fluxo de criacao:
  - trocar campos tecnicos crus por linguagem orientada a tarefa
  - exemplo de modelo mental:
    - `Porta no seu computador`
    - `Destino dentro do host/rede`
    - `Abrir automaticamente ao conectar`
    - `Liberar acesso web` quando aplicavel
  - manter campos avancados como `bind address` em area recolhida ou avancada
- criar a partir do host:
  - o usuario deve conseguir criar forwarding diretamente no contexto do host, sem depender do terminal
  - a tela lateral deve continuar servindo para listar, buscar e revisar tudo do tenant
  - a criacao principal deve aceitar host preselecionado vindo de `Hosts`

Status atual da frente:
- linguagem principal da UI alinhada para `Acessos locais`
- formulario simplificado:
  - `Porta no seu computador`
  - `Host de destino`
  - `Porta do servico`
  - `Abrir automaticamente`
  - `bind address` movido para `Opcoes avancadas`
- entrada pelo host concluida:
  - abrir `Acessos locais` a partir de `Hosts`
  - abrir modal de criacao com host pre-selecionado
  - listar ja filtrado pelo host quando vier desse contexto
  - exibir host selecionado no modal
- operacao basica no modal do host concluida:
  - editar acesso salvo
  - remover acesso salvo
  - ligar/desligar `Abrir automaticamente`

Proximo passo opcional de baixo risco:
- abrir `Acesso web` direto da lista de acessos dentro do modal do host quando `webEnabled` estiver ativo

### Hosts: modos de exibicao
- a tela de `Hosts` deve permitir pelo menos dois modos de exibicao:
  - `Cards`
  - `Lista`
- a preferencia pode ser salva localmente por navegador, sem depender de persistencia server-side no primeiro corte
- `Cards` continua como modo padrao inicial
- `Lista` prioriza operacao e leitura densa para ambientes com maior volume de hosts
- um terceiro modo mais compacto pode ser avaliado depois, se houver demanda real
- evolucao recomendada para performance e estabilidade:
  - extrair itens de host em componentes leves e bem testados, separando lista/card do container principal sem alterar o design percebido
  - avaliar lazy-mount de detalhes secundarios por host, como tooltips ricos, links, tags ocultas, bastion e tuneis, preservando foco, hover e acessibilidade basica
  - considerar virtualizacao apenas se a reducao por componente/cache nao for suficiente, pois impacta scroll, selecao em massa, drag/drop e menus de acao
  - manter harness cobrindo carregamento, alternancia `recentes/todos`, menu de acoes, botoes de conexao, erros de console/browser e metricas de DOM/long tasks
  - avaliar cache/payload reduzido para dados auxiliares de hosts, incluindo inventario, bastions, tags, links, secrets, pastas ACL e tuneis, sem comprometer corretude final

### Sugestoes adicionais para port forwarding
- diferenciar `configurado` de `ativo` com linguagem mais clara:
  - `salvo no host`
  - `aberto nesta sessao`
- oferecer presets simples de destino:
  - banco de dados
  - redis
  - web interna
  - rdp
- validar conflito de porta local antes de salvar quando possivel, ou explicar claramente no auto-start
- para acesso web, explicar melhor quando usar `web access` vs forwarding normal

### Nao faz sentido como proximo passo isolado
- abrir senhas salvas diretamente por snippet:
  - aumenta risco de exposicao de segredo e mistura automacao com cofre sem guardrail suficiente
  - faz mais sentido evoluir referencias seguras ou input manual assistido do que exibir segredo salvo em claro

### Proximo passo futuro de operacao e release
- a frente operacional atual ja cobre:
  - pacote de release
  - install/update
  - doctor
  - rollback
  - backup/restore
  - promote release para `current`
- proximo passo futuro recomendado:
  - `install-from-tarball.sh` para:
    - extrair release em `releases/`
    - promover via `switch-release.sh`
    - iniciar o fluxo de instalacao com o menor numero possivel de comandos manuais
  - flexibilizar a frente de TLS/certificados de deploy:
    - remover obrigatoriedade operacional de `fullchain.pem` + `privkey.pem` no primeiro `up`
    - suportar `TLS_MODE=off|provided|selfsigned`
    - deixar automacao de `Let's Encrypt` como fluxo assistido de servidor, nao como dependencia obrigatoria da UI
  - automacao de publish/entrega de release:
    - gerar pacote versionado
    - checksums
    - opcionalmente bundle offline de imagens
    - entrega previsivel para o servidor ou storage de distribuicao
- objetivo dessa fase futura:
  - reduzir ainda mais o atrito de implantacao
  - diminuir erro manual em upgrade
  - padronizar o modelo `releases/shared/current` como fluxo oficial

## Direcao recomendada para proximas fases
1. roadmap estrategico de valor:
   - detalhe curto em `docs/PRD-strategic-roadmap-lite.md`
   - priorizar frentes que aumentem valor comercial sem prejudicar operacao atual
2. security assessment e preparacao para certificacao:
   - detalhe curto em `docs/PRD-security-assessment-lite.md`
   - combinar Nessus, ZAP, Nuclei, SAST, scan de containers e testes manuais
3. fullscreen real do terminal
4. fluxo seguro para mudanca de host key
5. retomada controlada de sessao apos queda de websocket
6. avaliar modo SSH `password+key` apenas se houver caso operacional real
7. melhorar descoberta e governanca de snippets ja existentes
8. autocomplete do terminal com opt-in por tenant/usuario

## Proxima fase recomendada de host key
1. politica por escopo:
   - `personal`: dono pode confiar/atualizar
   - `team`: exigir permissao de gestao de hosts ou regra equivalente
   - `global`: restringir a admin
2. UX de bloqueio:
   - quando o usuario nao puder aprovar a mudanca, explicar quem precisa agir
   - diferenciar falta de permissao de erro tecnico
3. observabilidade/admin:
   - facilitar leitura de eventos de host key no admin
   - destacar ultima troca por host quando fizer sentido

Status atual:
- fase 3 em andamento/concluida neste corte:
  - `personal`: dono ou admin
  - `team`: admin ou usuario com `canManageHosts`
  - `global`: somente admin
  - terminal informa quando o usuario nao pode aprovar a troca

## Quando abrir o PRD completo
- regra detalhada de tela
- requisito funcional numerado
- roadmap e fases
- risco, compliance ou caso de uso completo
