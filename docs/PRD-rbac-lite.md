# PRD RBAC Lite

## Objetivo
Definir uma evolucao futura de permissoes granulares por ferramenta no NodeAccess, sem substituir imediatamente o modelo atual de `admin`, `user` e `canManageHosts`.

O objetivo e permitir que cada tenant controle se um usuario ou grupo pode criar, editar, excluir ou apenas consumir recursos como hosts, snippets, acessos locais, agentes, secrets e auditoria.

## Contexto Atual
- O modelo atual tem:
  - `admin`: acesso amplo de gestao
  - `user`: acesso operacional limitado
  - `canManageHosts`: flag especifica para cadastro/edicao de hosts
- Alguns modulos ja possuem diferenca pratica entre gestao e consumo:
  - hosts: usuario pode gerenciar hosts apenas se tiver permissao de hosts
  - acessos locais: admin gerencia; usuario pode consumir/abrir acessos existentes
  - secrets e integracoes seguem regras proprias por modulo
- A evolucao desejada e desacoplar permissoes por ferramenta, sem criar regras ad hoc em cada tela.

## Principio de Produto
- Permissao deve ser orientada por capacidade, nao apenas por tela.
- A UI pode esconder acoes, mas o backend sempre deve validar a permissao.
- Permissoes devem poder ser aplicadas por usuario e, futuramente, por grupo.
- Admin continua como papel privilegiado com todas as permissoes do tenant.
- A ausencia de permissao deve falhar com `403` e mensagem clara.

## Modelo Futuro Sugerido

### Entidades
- `Permission`: catalogo tecnico de capacidades, por exemplo `forwardings:create`.
- `Role` ou `PermissionSet`: conjunto nomeado de permissoes por tenant.
- `UserPermission`: excecao ou atribuicao direta por usuario.
- `GroupPermission`: atribuicao futura por grupo.

### Ordem de resolucao sugerida
1. `admin` recebe todas as permissoes.
2. permissoes diretas do usuario.
3. permissoes herdadas dos grupos.
4. perfil/base padrao do tenant.
5. negar por padrao quando a permissao nao estiver presente.

## Matriz Inicial de Permissoes

### Hosts
- `hosts:view`: visualizar hosts permitidos pelo escopo.
- `hosts:create`: criar host.
- `hosts:update`: editar host.
- `hosts:delete`: remover host.
- `hosts:connect`: abrir sessao SSH.
- `hosts:test`: testar conectividade.
- `hosts:manage_links`: criar, editar e remover links associados ao host.

### Acessos locais
- `forwardings:view`: visualizar acessos locais dos hosts permitidos.
- `forwardings:open`: abrir/fechar tunnel de acesso local.
- `forwardings:create`: criar novo acesso local.
- `forwardings:update`: editar acesso local.
- `forwardings:delete`: remover acesso local.
- `forwardings:test`: testar destino interno antes de salvar.
- `forwardings:web_open`: abrir acesso web quando habilitado.

### Snippets
- `snippets:view`: visualizar snippets permitidos.
- `snippets:execute`: executar snippet no terminal.
- `snippets:create`: criar snippet.
- `snippets:update`: editar snippet.
- `snippets:delete`: remover snippet.
- `snippets:manage_shared`: publicar ou alterar snippets compartilhados.

### Secrets
- `secrets:view`: listar aliases e metadados de secrets.
- `secrets:create`: criar secret.
- `secrets:update`: editar metadados ou valor.
- `secrets:rotate`: rotacionar secret.
- `secrets:revoke`: revogar secret.
- `secrets:delete`: excluir secret.
- `secrets:use`: consumir secret por snippets ou automacoes autorizadas.

### Agentes
- `agents:view`: visualizar agentes.
- `agents:create`: criar token de agente.
- `agents:update`: alterar metadados, modo ou padrao.
- `agents:delete`: remover agente.
- `agents:test`: testar alcance do agente ate um host.
- `agents:diagnostics`: visualizar diagnosticos detalhados.

### Sessoes SSH e auditoria
- `sessions:view_own`: visualizar sessoes proprias.
- `sessions:view_all`: visualizar sessoes do tenant.
- `sessions:close_own`: encerrar sessoes proprias.
- `sessions:close_any`: encerrar sessoes de qualquer usuario.
- `session_audit:view`: visualizar auditoria de sessao.
- `session_audit:export`: exportar auditoria.
- `session_audit:ai`: gerar ou consultar analises de IA.
- `shared_sessions:create`: compartilhar sessao ao vivo.
- `shared_sessions:control`: solicitar ou receber controle de sessao compartilhada.

### Administracao
- `users:view`: listar usuarios.
- `users:create`: criar usuario.
- `users:update`: editar usuario.
- `users:disable`: ativar/desativar usuario.
- `groups:manage`: gerenciar grupos.
- `integrations:manage`: configurar integracoes.
- `license:manage`: gerenciar licenca.
- `logs:view`: visualizar logs administrativos e de autenticacao.
- `settings:manage`: alterar configuracoes do tenant.

## Mapeamento Inicial Recomendado

### Admin
- Todas as permissoes do tenant.

### User padrao
- `hosts:view`
- `hosts:connect`
- `hosts:test`
- `forwardings:view`
- `forwardings:open`
- `forwardings:web_open`
- `snippets:view`
- `snippets:execute`
- `sessions:view_own`
- `sessions:close_own`

### User com gestao de hosts
- Permissoes de `User padrao`.
- `hosts:create`
- `hosts:update`
- escopos de criacao limitados pelas regras atuais do produto.

## Corte de Implementacao Recomendado

### Fase 1 - Catalogo e helpers
- Criar catalogo central de permissoes em backend/shared.
- Criar helper `can(user, permission, context)`.
- Manter compatibilidade:
  - `admin` passa em tudo.
  - `canManageHosts` continua alimentando permissoes de host.
- Sem migration complexa no primeiro corte.

### Fase 2 - Backend por modulo
- Aplicar permissao no backend em ordem de risco:
  1. acessos locais
  2. snippets
  3. secrets
  4. agentes
  5. auditoria
- Cada endpoint deve validar permissao explicitamente.
- Erros devem usar `403` com codigo estavel por modulo.

### Fase 3 - UI por capacidade
- Expor permissoes efetivas no payload do usuario ou endpoint `/me`.
- Esconder ou desabilitar acoes por capacidade.
- Exibir mensagens de falta de permissao quando o usuario tentar uma acao por link direto ou estado stale.

### Fase 4 - Gestao administrativa
- Tela para perfis ou conjuntos de permissoes por tenant.
- Atribuicao por usuario.
- Atribuicao por grupo.
- Auditoria de alteracoes de permissao.

## Regras de UX
- Nao mostrar botoes de criacao/edicao/exclusao quando o usuario nao tiver permissao.
- Acoes de consumo devem continuar visiveis quando permitidas, mesmo sem permissao de gestao.
- Diferenciar claramente:
  - recurso indisponivel por licenca
  - recurso oculto por falta de permissao
  - recurso visivel, mas sem capacidade de gestao

## Regras de Seguranca
- Backend e a fonte primaria da autorizacao.
- Frontend nunca deve ser a unica barreira.
- Permissao deve considerar tenant e escopo do recurso.
- Segredos nunca devem ser expostos mesmo quando o usuario tiver permissao de uso.
- Toda mudanca de permissao deve gerar `AdminLog`.

## Fora de Escopo Inicial
- ABAC completo baseado em atributos dinamicos.
- Politicas por horario, IP, device posture ou risco.
- Workflow de aprovacao para cada acao.
- Delegacao temporaria de permissao.
- Sincronizacao completa de permissoes com Google Workspace ou AD.

## Arquivos Provaveis no Futuro
- `apps/backend/src/shared/permissions.ts`
- `apps/backend/src/shared/authorization.ts`
- `apps/backend/src/modules/users/user.service.ts`
- `apps/backend/src/modules/groups/group.service.ts`
- `apps/frontend/src/stores/auth.ts`
- `apps/frontend/src/services/permissions.service.ts`
- `packages/shared/src/permissions.ts`

## Decisao Atual
Nao implementar RBAC completo agora.

Manter o modelo atual e preparar a linguagem de produto e tecnica para evoluir com baixo acoplamento. A primeira regra aplicada como ponte e: `admin` gerencia acessos locais; `user` consome acessos locais existentes.
