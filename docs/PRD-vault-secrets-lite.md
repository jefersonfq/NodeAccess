# PRD Lite - Vault Secrets

Versao curta para cofre de segredos reutilizavel no NodeAccess.

## Objetivo
- permitir armazenamento seguro de segredos operacionais
- disponibilizar segredos para snippets e outros recursos futuros
- evitar senha em texto livre em snippets, logs, auditoria ou payloads comuns de API

## Regra central
- segredo e recurso proprio do produto
- snippet, macro, terminal, acesso local ou outro recurso futuro apenas referencia o segredo
- o valor do segredo nao pertence ao recurso consumidor

## Casos de uso iniciais
- senha para `sudo`
- senha para `mysql -u root -p` via prompt interativo
- token temporario usado em comando operacional
- senha de usuario tecnico especifico em fluxo assistido

## Casos de uso futuros
- parametros sensiveis para macros
- credenciais temporarias para automacao controlada
- segredos usados por agentes
- referencia a cofres externos como 1Password, Vault ou KMS corporativo

## Escopo fase 1
- PRD e threat model curto
- modelo conceitual de `Secret`
- regras de UX e auditoria
- fluxo de criacao/listagem sem exibir valor apos salvar
- ACL minima por usuario/grupo/tenant

Status:
- backend foundation implementado:
  - schema/migration de `Secret`
  - contratos compartilhados
  - rotas `GET/POST/PATCH /secrets`
  - rotas `POST /secrets/:id/rotate` e `POST /secrets/:id/revoke`
  - rota `DELETE /secrets/:id` para exclusao definitiva
  - listagem sem valor sensivel
  - criptografia com chave fora do banco via helper existente
  - auditoria em `AdminLog` sem valor do segredo
- UI minima implementada:
  - tela dedicada de `Secrets`
  - listagem sem valor sensivel
  - criacao, edicao de metadados, rotacao, revogacao e exclusao definitiva
  - avisos explicitos de politica de armazenamento, nao exibicao e auditoria
  - indicacao de escopo, estado ativo/revogado e rotacao
- integracao inicial com snippets implementada:
  - placeholder `{{secret:alias}}`
  - resolucao server-side no gateway SSH
  - validacao visual de alias acessivel no cadastro/edicao de snippet
  - confirmacao antes do envio
  - auditoria de uso sem valor
  - stdin auditado com placeholder mascarado
  - redaction defensivo de stdout por TTL curto quando o valor aparecer no output
- ainda nao implementado:
  - politicas refinadas por secret/grupo
  - provider externo para cofre corporativo

## Escopo fase 2
- persistencia cifrada em repouso
- envelope encryption:
  - valor cifrado no banco
  - chave mestra fora do banco
  - suporte futuro a KMS/cofre externo
- auditoria de criacao, alteracao, leitura/uso e revogacao
- rotacao manual do segredo

## Escopo fase 3
- integracao com snippets por placeholder/referencia
- injecao no fluxo de terminal com mascaramento de auditoria
- confirmacao por politica quando o segredo for usado
- feedback claro ao usuario:
  - `Este snippet usara o secret mysql-root-prod`
  - `Valor protegido; nao sera exibido`

## Fora do escopo inicial
- gerenciador de senhas completo para usuario final
- compartilhamento externo de segredos
- segredo trafegando para o frontend como dado comum
- senha em texto claro dentro de snippet
- execucao invisivel sem confirmacao ou indicacao ao usuario

## Modelo conceitual
- `Secret`
  - `id`
  - `tenantId`
  - `alias`
  - `description`
  - `scope`
  - `ownerUserId`
  - `groupId`
  - `encryptedValue`
  - `createdAt`
  - `updatedAt`
  - `rotatedAt`
  - `revokedAt`
- `SecretUsageLog`
  - `secretId`
  - `userId`
  - `resourceType`
  - `resourceId`
  - `action`
  - `createdAt`

## Regras de seguranca
- valor nunca deve aparecer em listagem
- valor nao deve retornar em API de leitura comum
- respostas sensiveis devem usar headers anti-cache
- comunicacao deve exigir HTTPS/WSS em producao
- segredo em repouso deve ser cifrado com chave fora do banco
- segredo usado em terminal deve ser mascarado na auditoria quando tecnicamente possivel
- logs devem registrar alias/id e contexto, nunca valor
- permissao deve ser validada no backend em cada uso
- `revogar` deve ser a acao recomendada para bloquear uso mantendo historico
- `excluir` deve ser acao destrutiva para limpeza definitiva do cofre e deve ter confirmacao explicita

## UX recomendada
- deixar claro o nome do segredo usado:
  - `Usa secret: mysql-root-prod`
  - `Usa secret: sudo-prod`
- mostrar origem/escopo:
  - pessoal
  - grupo
  - tenant/admin
- mostrar estado:
  - ativo
  - revogado
  - rotacionado
- no uso:
  - mostrar confirmacao curta se a politica exigir
  - mostrar que o valor ficara protegido
- no erro:
  - `Sem permissao para usar este secret`
  - `Secret revogado`
  - `Secret nao encontrado`

## Auditoria
- registrar:
  - quem criou
  - quem alterou metadados
  - quem rotacionou
  - quem usou
  - qual recurso consumiu o segredo
- nao registrar:
  - valor do segredo
  - preview do segredo
  - payload sensivel completo

## Relacao com 1Password
- a integracao atual com 1Password por referencia continua valida
- Vault Secrets pode nascer como cofre interno simples
- no futuro, o Vault pode suportar provider externo:
  - interno cifrado
  - 1Password
  - HashiCorp Vault
  - KMS/Secrets Manager
- provider externo deve manter a mesma interface de uso no produto

## Riscos
- falso senso de seguranca se o segredo for entregue ao navegador em claro
- vazamento por auditoria de terminal
- vazamento por historico do shell remoto
- uso em prompt errado por automacao fragil
- chave mestra armazenada no mesmo lugar que o banco

## Guardrails
- preferir resolucao server-side quando possivel
- quando o frontend precisar participar, usar fluxo curto e explicito
- mascarar stdin sensivel na auditoria
- bloquear exibicao do valor apos salvar
- exigir permissao explicita por escopo
- registrar todo uso do segredo

## Arquivos provaveis
- backend:
  - `apps/backend/prisma/schema.prisma`
  - `apps/backend/src/modules/secrets/*`
  - `apps/backend/src/modules/snippets/*`
  - `apps/backend/src/modules/session-audit/*`
- frontend:
  - `apps/frontend/src/views/admin/*`
  - `apps/frontend/src/views/SnippetsView.vue`
  - `apps/frontend/src/components/SnippetsPanel.vue`
  - `apps/frontend/src/views/TerminalView.vue`
- shared:
  - `packages/shared/src/schemas/*`
