# PRD Lite - Politicas de Comandos de Sessao

## Objetivo
- permitir criar grupos de bloqueio de comandos pela interface
- vincular politicas a usuarios, grupos de usuarios, hosts e grupos de hosts
- aplicar a mesma regra no terminal web e no SSH Gateway nativo
- manter baixo acoplamento entre UI, politicas, WebSocket e SSH nativo

## Contexto
O NodeAccess tera um ponto comum de entrada de terminal no backend. Toda entrada
do usuario deve passar por uma politica antes de chegar ao shell remoto.

Esse dominio nao deve depender do modulo de AI SSH Actions. As politicas de IA
podem compartilhar conceitos, mas a politica de sessao e um recurso geral do
produto.

## Modelo conceitual
### Grupo de politica
- nome
- descricao
- ativo/inativo
- prioridade
- acao padrao: permitir ou bloquear

### Regra
- tipo: `regex`, `contains`, `prefix`, `exact`
- padrao
- acao: `block` inicialmente
- mensagem exibida ao usuario
- ativo/inativo

### Vinculos
- usuario
- grupo de usuarios
- host
- grupo de hosts
- global do tenant

## Escopo inicial
- CRUD de grupos de politica
- CRUD de regras dentro do grupo
- vinculos com usuario, grupo de usuarios, host e grupo de hosts
- acao inicial somente `block`
- avaliacao por prioridade
- auditoria quando comando for bloqueado
- aplicacao em:
  - terminal web
  - SSH Gateway nativo

## Fora do escopo inicial
- aprovacao interativa
- janela de horario
- excecoes temporarias
- parser semantico completo de shell
- bloqueio dentro de editores/TUI como `vim`, `nano`, `less`
- politicas especificas para SCP/SFTP

## Regras de avaliacao
- politica desativada nao deve ser considerada
- regra desativada nao deve ser considerada
- regras mais especificas devem vencer:
  1. usuario + host
  2. usuario + grupo de hosts
  3. grupo de usuarios + host
  4. grupo de usuarios + grupo de hosts
  5. usuario
  6. grupo de usuarios
  7. host
  8. grupo de hosts
  9. global
- se duas politicas empatarem, usar maior prioridade
- se ainda empatar, bloquear deve vencer permitir

## UX administrativa
Tela: `Politicas de comandos`

Elementos:
- lista de grupos de politica
- status ativo/inativo
- quantidade de regras
- quantidade de vinculos
- prioridade
- acao principal: `Nova politica`
- acoes por item: editar, duplicar, desativar, excluir

Tela de edicao:
- dados gerais
- regras
- vinculos
- simulador de comando

Estados:
- loading ao carregar politicas
- vazio: nenhuma politica criada
- erro: falha ao carregar/salvar
- sucesso: politica salva
- validacao: regex invalida, padrao vazio, vinculo duplicado

## Experiencia durante a sessao
Quando um comando for bloqueado:
```
Comando bloqueado pela politica "Producao segura".
Motivo: remover diretorios recursivamente nao e permitido.
```

O comando nao deve ser enviado ao host.

## Riscos e limites
- Terminal interativo envia bytes, nao comandos estruturados.
- O primeiro corte deve detectar comando ate `Enter`.
- Pastes multiline precisam avaliar cada linha.
- Usuarios avancados podem tentar contornar com shell expansivo, aliases ou scripts.
- A feature deve ser descrita como controle operacional/auditoria, nao sandbox absoluto.

## Arquitetura recomendada
```
WebSocket / SSH Gateway nativo
  -> ManagedSshSessionService
  -> SshInputPolicy
  -> SessionCommandPolicyEvaluator
  -> allow/block
```

O gateway nao deve conhecer banco, regras ou UI de politicas. Ele so recebe uma
decisao: permitir, alterar ou bloquear entrada.

## Arquivos provaveis
- `apps/backend/src/modules/session-command-policy/*`
- `apps/backend/src/modules/ssh/ssh-input-policy.ts`
- `apps/backend/src/modules/ssh/managed-ssh-session.service.ts`
- `apps/backend/prisma/schema.prisma`
- `apps/frontend/src/views/admin/SessionCommandPoliciesView.vue`
- `apps/frontend/src/services/session-command-policy.service.ts`
- `packages/shared/src/schemas/session-command-policy.schema.ts`

## Primeiro corte tecnico
- contrato `SshInputPolicy`
- avaliador puro de regras
- policy com buffer de linha ate `Enter`
- integracao no terminal web e SSH Gateway nativo
- sem UI ainda, usando provider in-memory/allow-all

## Segundo corte
- persistencia no banco
- API REST
- tela administrativa
- simulador de comando

## Depois
- require approval
- excecoes temporarias
- politicas por horario
- relatorios de comandos bloqueados
