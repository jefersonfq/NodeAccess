# PRD Local AI Lite

## Objetivo
Adicionar uma capacidade opcional de IA local no NodeAccess para:
- conversar com base no contexto do produto e dos hosts
- analisar sessoes SSH e auditorias
- sugerir ou executar acoes em hosts dentro de uma politica explicita de permissao
- usar documentos internos do cliente como base de conhecimento

## Motivacao
Essa frente agrega valor para operacao e suporte quando o usuario quer:
- localizar hosts e sessoes com linguagem natural
- resumir diagnosticos de SSH
- investigar erros com apoio de IA local
- consultar padroes internos do cliente sem depender de IA externa

## Diretrizes de arquitetura
- tudo deve ser opcional
- se a IA local nao estiver ativada, o frontend nao deve exibir suas acoes nem depender dela para carregar telas existentes
- o backend deve expor a funcionalidade como modulo separado, sem acoplar o terminal principal
- o provider de modelo deve ser abstraido por interface
- RAG/knowledge base deve ser modulo proprio, separado da execucao de comandos
- politicas de acao no host devem ser camada propria, separada da conversa

## Nomenclatura sugerida
- nome de produto: `Assistente local`
- provider inicial sugerido: `Ollama`
- modelo inicial sugerido: `qwen2.5-coder`

## Casos de uso prioritarios
- "abrir sessoes do cliente X"
- "listar hosts do grupo Y"
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

## Guardrails minimos
- toda acao em host deve respeitar a permissao do usuario no NodeAccess
- toda execucao remota deve gerar auditoria propria
- a IA nunca deve receber segredo em claro como resposta de sistema
- o modo `baixo impacto` deve usar allowlist, nao denylist
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

### Fontes iniciais
- arquivos PDF
- Markdown
- TXT
- links internos exportados/manualizados pelo cliente

### Regras
- ingestion separada da conversa
- parsing e chunking em modulo proprio
- indice local opcional por tenant
- documentos devem ser vinculados ao tenant
- documentos podem ser marcados por escopo:
  - tenant
  - grupo
  - privado do usuario

## Integracao tecnica recomendada
### Provider
- interface `LocalAiProvider`
- implementacao inicial: `OllamaProvider`
- healthcheck proprio
- configuracao em integracoes/admin

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

## Fases recomendadas
### Fase 1
- conversa local somente leitura
- contexto de banco e auditoria
- sem execucao remota
- sem dependencia no terminal

### Fase 2
- knowledge base local com upload de arquivos
- busca semantica por tenant
- citacoes e fontes na resposta

### Fase 3
- execucao remota em modo `baixo impacto`
- abrir sessao tecnica isolada para a IA
- auditoria propria por comando executado

### Fase 4
- controle total opcional
- aprovacao explicita
- feature flag
- guardrails e trilha forte de auditoria

## Recomendacao de produto
- faz sentido como frente futura
- nao deve nascer como "agente com acesso total"
- o primeiro corte mais seguro e valioso e:
  - conversa local
  - contexto do NodeAccess
  - auditoria SSH
  - knowledge base opcional
  - sem executar comando em host

## Fora do escopo inicial
- autonomia irrestrita da IA sobre hosts
- escrita automatica em arquivos remotos
- execucao destrutiva
- dependencia obrigatoria do frontend em IA local
