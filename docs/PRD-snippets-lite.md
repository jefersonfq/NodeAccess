# PRD Lite - Snippets

Versao curta para evolucao do recurso de snippets.

## Objetivo
- acelerar comandos repetitivos no terminal
- manter snippets simples, macros e atalhos com UX clara
- permitir referencia futura a segredos sem armazenar senha dentro do snippet

## Estado atual
- snippets ja existem no produto
- existe painel no terminal
- existe quick picker no terminal
- existe atalho configuravel por usuario
- existe escopo pessoal e compartilhado por equipe/tenant
- snippets podem referenciar Vault Secrets via `{{secret:alias}}`
- a UI destaca aliases de secrets usados no cadastro/lista/painel/picker
- a execucao resolve o valor no backend via websocket, sem retornar o segredo em payload comum ao frontend
- a auditoria de stdin sensivel usa payload mascarado
- macros/automacoes mais avancadas ficam relacionadas a `docs/PRD-terminal-macros-lite.md`

## Regra central
- snippet nao deve armazenar senha ou segredo puro
- snippet pode referenciar um segredo pelo identificador seguro do Vault
- o valor do segredo deve ser resolvido apenas no momento de uso, conforme permissao do usuario

Exemplo conceitual:
- comando:
  - `mysql -u root -p`
- segredo referenciado:
  - `secret:mysql-root-prod`
- UX:
  - mostrar que o snippet usa o segredo `mysql-root-prod`
  - nunca mostrar o valor do segredo

## Escopo fase 1
- documentar e padronizar snippets como consumidor de segredos
- adicionar metadados visuais para snippet que usa segredo
- deixar claro na UI quando um snippet depende de `secret X` ou `secret Y`
- impedir salvamento de segredo em campo de comando quando detectado padrao obvio de senha, se viavel
- manter execucao manual pelo usuario

## Escopo fase 2
- integrar com `Vault Secrets`
- permitir placeholder de segredo em snippets e macros:
  - `{{secret:alias}}`
  - ou referencia estruturada equivalente
- resolver segredo somente durante execucao
- mascarar eventos sensiveis na auditoria
- registrar auditoria de uso do segredo sem valor sensivel

Status:
- implementado para envio pelo terminal:
  - deteccao visual de `{{secret:alias}}`
  - validacao visual de alias acessivel no cadastro/edicao
  - confirmacao antes de executar snippet com secret
  - resolucao server-side no gateway SSH
  - registro de uso do secret em log administrativo sem valor
  - auditoria de stdin com placeholder mascarado
  - redaction defensivo de stdout quando o valor do secret aparecer logo apos o uso
- pendente:
  - politicas mais refinadas por secret/grupo
  - bloqueio por politica para padroes inseguros, se necessario

## Fora do escopo
- senha em claro no campo `command`
- retorno do segredo como payload comum para o frontend
- execucao automatica irrestrita ou silenciosa sem configuracao explicita do usuario
- segredo acoplado ao modelo de snippet

## Evolucao futura - snippets de inicializacao de sessao
Faz sentido evoluir snippets para permitir execucao automatica apos uma sessao SSH iniciar, semelhante a macro pos-login de clientes como MobaXterm.

Objetivo:
- preparar ambiente automaticamente apos conexao bem-sucedida
- reduzir passos repetitivos de primeiro comando
- padronizar rotina por usuario, host ou grupo

Casos de uso:
- entrar com outro usuario:
  - `sudo -iu deploy`
- acessar diretorio padrao:
  - `cd /opt/minha-app`
- iniciar acompanhamento de logs:
  - `tail -f /var/log/app.log`
- chamar script de preparacao ou diagnostico:
  - `/opt/scripts/session-start.sh`
- exportar variaveis nao sensiveis de contexto:
  - `export APP_ENV=prod`

Escopo recomendado para primeiro corte:
- permitir marcar um snippet como `executar ao iniciar sessao`
- configurar a regra por usuario e host especifico
- executar apenas depois de a conexao SSH estar estabelecida
- mostrar feedback claro no terminal:
  - `Executando snippet inicial: <nome>`
- permitir desabilitar/remover a regra facilmente
- registrar auditoria especifica de snippet inicial executado

Escopo posterior:
- multiplos snippets por host com ordem configuravel
- regra por grupo de hosts ou grupo de usuarios
- delay entre comandos
- macros `expect/send` para prompts pos-login
- templates de inicializacao por time
- politica administrativa para permitir/bloquear auto-execucao por escopo

Guardrails especificos:
- nao executar automaticamente snippet com `{{secret:alias}}` sem confirmacao ou politica explicita
- alertar ou bloquear comandos potencialmente destrutivos conforme politica
- diferenciar snippet manual de snippet de inicializacao na UI e na auditoria
- evitar execucao silenciosa; o usuario deve entender que existe automacao de inicio
- permitir cancelar/desabilitar antes de iniciar novas sessoes
- manter auditoria mascarada para qualquer stdin sensivel

Riscos:
- comando incorreto rodar em host errado
- `sudo`, scripts ou comandos destrutivos executarem sem contexto suficiente
- automacao travar a sessao aguardando prompt inesperado
- segredo ser enviado para prompt errado ou aparecer em output remoto

Recomendacao:
- tratar como evolucao de snippets/macros, nao como detalhe visual
- primeiro corte deve ser opt-in, por usuario + host, com feedback no terminal e auditoria
- integracao com macros avancadas deve seguir `docs/PRD-terminal-macros-lite.md`

## UX recomendada
- no cadastro/edicao:
  - mostrar bloco `Segredos usados`
  - listar aliases referenciados
  - validar se o usuario tem acesso ao segredo
- no picker/painel:
  - badge `usa segredo`
  - tooltip: `Usa secret: mysql-root-prod`
- antes da execucao:
  - se houver segredo, mostrar confirmacao discreta quando politica exigir
  - deixar claro que o valor nao sera exibido
- na auditoria:
  - registrar `snippet executado`
  - registrar `secret usado`
  - nunca registrar valor do secret

## Riscos
- vazar segredo em auditoria de stdin/stdout
- vazar segredo no historico remoto do shell
- usuario colar segredo em comando incorreto
- automacao enviar segredo para prompt inesperado

## Guardrails
- preferir prompt interativo a senha na linha de comando
- destacar comandos potencialmente inseguros como `mysql -pSENHA`
- bloquear/alertar quando o snippet tentar persistir segredo literal
- exigir permissao explicita para usar segredo compartilhado

Status:
- alerta nao bloqueante para possiveis segredos literais implementado em:
  - senha inline de MySQL/MariaDB
  - atribuicoes como `password=`, `token=`, `secret=`
  - `curl -u usuario:senha`
  - `PGPASSWORD=...`

## Arquivos provaveis
- backend:
  - `apps/backend/src/modules/snippets/*`
  - `apps/backend/prisma/schema.prisma`
- frontend:
  - `apps/frontend/src/views/SnippetsView.vue`
  - `apps/frontend/src/components/SnippetsPanel.vue`
  - `apps/frontend/src/views/TerminalView.vue`
  - `apps/frontend/src/services/snippet.service.ts`
- docs:
  - `docs/PRD-vault-secrets-lite.md`
  - `docs/PRD-terminal-macros-lite.md`
