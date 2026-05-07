# PRD Local AI Lite

## Objetivo
Adicionar uma capacidade opcional de IA local no NodeAccess para:
- conversar com base no contexto do produto e dos hosts
- atuar como assistente local global da plataforma, ajudando o usuario a navegar, entender e operar melhor os modulos disponiveis
- analisar sessoes SSH e auditorias
- sugerir ou executar acoes em hosts dentro de uma politica explicita de permissao
- usar documentos internos do cliente como base de conhecimento

## Motivacao
Essa frente agrega valor para operacao e suporte quando o usuario quer:
- localizar hosts e sessoes com linguagem natural
- entender como usar melhor a propria plataforma e seus modulos sem sair do NodeAccess
- resumir diagnosticos de SSH
- investigar erros com apoio de IA local
- consultar padroes internos do cliente sem depender de IA externa

## Diretrizes de arquitetura
- tudo deve ser opcional
- se a IA local nao estiver ativada, o frontend nao deve exibir suas acoes nem depender dela para carregar telas existentes
- o backend deve expor a funcionalidade como modulo separado, sem acoplar o terminal principal
- o provider de modelo deve ser abstraido por interface
- a plataforma deve permitir IA local, IA em rede ou ambas, conforme politica explicita do tenant
- a coexistencia entre providers deve ser tratada por politica de roteamento, evitando incompatibilidades ou disputa silenciosa entre integracoes
- RAG/knowledge base deve ser modulo proprio, separado da execucao de comandos
- politicas de acao no host devem ser camada propria, separada da conversa
- o assistente deve poder consultar contexto global da plataforma por meio de ferramentas internas controladas, sem acesso livre ao banco ou a rotas sem governanca
- o sucesso inicial dessa frente depende de nao prejudicar a adocao do produto e de nao introduzir instabilidade nas integracoes prioritarias:
  - 1Password
  - JIRA
  - Google Workspace

## Estado atual
Ja existe uma base funcional implementada:
- configuracao do `Assistente local` no admin
- suporte a provider local `Ollama`
- suporte a provider de rede compativel com API OpenAI
- politica de roteamento entre local e rede
- healthcheck e status visivel no admin
- tela dedicada de conversa do assistente
- base de conhecimento com textos, links e arquivos textuais
- instrucoes adicionais para auditoria
- instrucoes adicionais separadas para o assistente conversacional
- chamada contextual do assistente a partir do terminal
- envio controlado de contexto do terminal ativo:
  - sessao atual
  - host atual
  - selecao atual
  - trecho recente do buffer
  - saida recente

O que continua fora do caminho critico:
- runtime principal do terminal
- conexao SSH
- captura base da auditoria
- navegacao principal do produto sem IA
- confiabilidade das integracoes-base do produto

## Nomenclatura sugerida
- nome de produto: `Assistente local`
- provider inicial sugerido: `Ollama`
- modelo inicial sugerido: `qwen2.5-coder`

## Providers suportados pela arquitetura
O assistente deve suportar tanto IA local quanto provedores de IA em rede/internet.

### IA local
- Ollama
- modelos locais compatíveis com o ambiente do cliente
- uso recomendado quando o cliente quer maior controle de dados, baixa dependência externa ou operação em rede restrita

### IA em rede/internet
- OpenAI
- Claude/Anthropic
- Gemini/Google
- provedores compatíveis com API OpenAI
- outros providers futuros por adaptador

Regras:
- provider nao pode alterar regra de negocio
- a mesma policy deve valer para IA local e IA em rede
- execucao SSH deve continuar centralizada no backend do NodeAccess
- segredos e credenciais nao devem ser enviados ao provider como contexto livre
- o tenant deve escolher politica de roteamento e providers permitidos
- para acoes em host, todo provider deve passar por preview, policy, `ActionRun`, auditoria e redaction

## Casos de uso prioritarios
- "abrir sessoes do cliente X"
- "listar hosts do grupo Y"
- "como uso este modulo do NodeAccess?"
- "quais recursos estao habilitados para este tenant?"
- "onde encontro os feedbacks ou configuracoes deste tenant?"
- "analisar a auditoria SSH desta sessao"
- "conectar neste servidor e procurar erros no modulo X"
- "ler o arquivo banner.sh e resumir o comportamento"
- "buscar nos documentos internos como o cliente usa OpenSIPS"

## Modos de permissao
### 1. Somente leitura
- pode consultar banco, auditoria, logs, metadados de hosts e documentos indexados
- nao pode abrir sessao SSH nem rodar comando

### 2. Baixo impacto
- pode abrir sessao controlada e rodar apenas comandos permitidos
- foco em leitura e diagnostico
- exemplos:
  - `pwd`
  - `ls`
  - `cat`
  - `tail`
  - `grep`
  - `find`
  - `ss`
  - `ps`
  - `journalctl`
  - `systemctl status`
- deve bloquear comandos destrutivos e mutaveis

### 3. Controle total
- pode executar comandos mais amplos conforme permissao do usuario e politica do tenant
- deve ser opcional e explicitamente habilitado
- nao deve ser o primeiro corte
- deve mapear internamente para `full_operational_access` da camada `ai-ssh-actions`
- pode operar em dois perfis:
  - `full_limited`: comandos livres apenas quando classificados como seguros ou aprovaveis pela policy
  - `full_governed_free`: IA local ou provider de IA pode conectar no host e executar solicitacoes livres dentro da policy, escopo e auditoria
- nunca deve significar execucao fora das permissoes do usuario, host visibility, tenant, grupo, canal ou policy de comandos
- toda execucao deve registrar solicitante, data/hora, provider, canal, host, comandos, resultado, saida sanitizada e aprovador quando houver

## Guardrails minimos
- toda acao em host deve respeitar a permissao do usuario no NodeAccess
- toda execucao remota deve gerar auditoria propria
- a IA nunca deve receber segredo em claro como resposta de sistema
- o modo `baixo impacto` deve usar allowlist, nao denylist
- o modo `controle total` deve exigir habilitacao explicita por tenant e policy
- o modo `controle total` deve continuar bloqueando comandos classificados como `blocked`
- o assistente deve gerar plano estruturado antes de qualquer `ActionRun`
- a execucao deve ocorrer pela camada `ai-ssh-actions`, nao diretamente pelo chat
- comandos que exigem aprovacao devem criar run pendente ou solicitar aprovacao antes da execucao
- comandos destrutivos devem ficar fora do escopo inicial:
  - `rm`
  - `mv`
  - `cp`
  - `chmod`
  - `chown`
  - `sed -i`
  - `tee`
  - redirecionamentos de escrita

## Base de conhecimento local
### Objetivo
Permitir que o cliente envie documentos e links internos para uso da IA local.

O admin deve conseguir enriquecer a IA com materiais proprios do tenant para melhorar:

- suporte interno
- respostas sobre processos do cliente
- capacidade analitica sobre ambiente e operacao
- orientacao de uso da propria plataforma

### Fontes iniciais
- arquivos PDF
- Markdown
- TXT
- links internos exportados/manualizados pelo cliente
- referencias operacionais cadastradas manualmente pelo admin

### Regras
- ingestion separada da conversa
- parsing e chunking em modulo proprio
- indice local opcional por tenant
- documentos devem ser vinculados ao tenant
- documentos podem ser marcados por escopo:
  - tenant
  - grupo
  - privado do usuario
- links e referencias devem virar artefatos internos controlados, evitando depender de consulta online em tempo real

## Papel como assistente global da plataforma

A IA local nao deve ser pensada apenas como chat tecnico de terminal.

Ela pode funcionar como um assistente global do NodeAccess, ajudando o usuario a:

- localizar recursos dentro da plataforma
- entender o estado do tenant
- navegar entre modulos
- resumir informacoes operacionais
- relacionar hosts, sessoes, auditorias, snippets, secrets, feedbacks e integracoes

Isso exige que o modulo tenha acesso controlado a ferramentas internas de leitura, como:

- busca de hosts
- consulta de sessoes
- leitura de auditoria resumida
- leitura de configuracoes e features do tenant
- busca em base de conhecimento local

Sem permitir acesso irrestrito ao banco ou bypass das regras ja existentes da aplicacao.

## Papel como assistente contextual do terminal
O assistente tambem deve poder ser chamado no terminal sem virar dependencia do terminal.

Direcao recomendada:
- acao explicita do usuario
- contexto da aba ativa enviado sob demanda
- leitura apenas no primeiro corte
- nada de execucao automatica no host

Contexto minimo recomendado:
- host atual
- sessao atual
- selecao atual do terminal
- trecho recente do buffer
- saida recente

Exemplos:
- "explique este erro"
- "resuma o que aconteceu ate agora"
- "o que este comando fez?"
- "quais proximos passos seguros devo seguir?"

## Integracao tecnica recomendada
### Provider
- interface `LocalAiProvider`
- implementacao inicial: `OllamaProvider`
- healthcheck proprio
- configuracao em integracoes/admin
- politica de roteamento entre:
  - `local_only`
  - `network_only`
  - `prefer_local`
  - `prefer_network`

### Orquestracao
- modulo proprio no backend:
  - `local-ai`
- componentes sugeridos:
  - `local-ai.provider.ts`
  - `local-ai.service.ts`
  - `local-ai.controller.ts`
  - `local-ai.routes.ts`
  - `local-ai-policy.service.ts`
  - `local-ai-knowledge.service.ts`

### Frontend
- entrypoint proprio:
  - painel do assistente
  - drawer ou rota dedicada
- a UI so aparece se a integracao estiver habilitada
- nao acoplar a tela principal do terminal ao carregamento da IA
- o assistente deve poder ser chamado como ajuda global da plataforma, sem depender do contexto de uma sessao SSH aberta
- no terminal, a chamada contextual deve nascer como botao ou modal leve, nao como dependencia obrigatoria do layout

## Fases recomendadas
### Fase 1
- conversa local somente leitura
- contexto de banco e auditoria
- ferramentas internas de leitura sobre a plataforma
- sem execucao remota
- sem dependencia no terminal

Status atual:
- concluida para conversa global
- concluida tambem uma primeira chamada contextual a partir do terminal, ainda em leitura

### Fase 2
- knowledge base local com upload de arquivos
- cadastro de links e referencias internas pelo admin
- busca semantica por tenant
- citacoes e fontes na resposta

Status atual:
- upload de textos, links e arquivos textuais concluido
- citacoes basicas concluidas
- busca semantica/indice mais rico ainda e evolucao futura

### Fase 3
- execucao remota em modo `baixo impacto`
- abrir sessao tecnica isolada para a IA
- auditoria propria por comando executado
- integrar `/assistant` com preview de plano operacional
- criar `ActionRun` com `channel: local_ai`
- acompanhar status e resultado no proprio assistente

Status atual:
- ainda nao iniciado

### Fase 4
- controle total opcional em perfil `full_limited`
- aprovacao explicita
- feature flag
- guardrails e trilha forte de auditoria

### Fase 5
- controle total em perfil `full_governed_free`
- IA local ou provider de IA pode conectar no host e executar solicitacoes livres dentro da policy
- liberar apenas para tenants, hosts/grupos, usuarios e canais explicitamente autorizados
- manter kill switch, rate limit, policy snapshot, redaction, auditoria e cancelamento

## Recomendacao de produto
- faz sentido como frente futura
- nao deve nascer como "agente com acesso total"
- o primeiro corte mais seguro e valioso e:
  - assistente global da plataforma
  - conversa local
  - contexto do NodeAccess
  - auditoria SSH
  - knowledge base opcional por tenant
  - sem executar comando em host

## Fora do escopo inicial
- autonomia irrestrita da IA sobre hosts
- escrita automatica em arquivos remotos
- execucao destrutiva
- dependencia obrigatoria do frontend em IA local
- consulta online arbitraria em links externos no momento da resposta

## O que falta
- drawer/chat persistente por aba de terminal
- memoria curta por aba ou por sessao de terminal
- acoes guiadas no terminal com sugestao de comando revisavel
- leitura estruturada do buffer com menos ruido de shell interativo
- modo `baixo impacto` com execucao controlada e auditoria propria
- preview de intencao operacional no `/assistant`
- criacao de `ActionRun` governado a partir do `/assistant`
- modo `controle total` mapeado para `full_limited` e, futuramente, `full_governed_free`
- preferencia por usuario para ativar/desativar ajuda contextual no terminal
