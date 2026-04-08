# PRD Lite - Bastions

Versao curta para evolucao de bastion hosts / jump servers no NodeAccess.

## Objetivo
- deixar claro como hosts usam bastions
- alinhar autenticacao de bastion ao padrao de credenciais do produto
- melhorar visibilidade operacional de quais hosts dependem de cada bastion
- reduzir configuracao duplicada de PEM/senha

## Estado atual
- existe modelo de `BastionHost`
- host pode ter `bastionId` opcional
- grupo pode ter `bastionId` opcional
- conexao SSH ja suporta salto `NodeAccess -> Bastion -> Host`
- tela administrativa de bastions existe
- fase 1 de UX implementada:
  - host exibe campo `Bastion / Jump server` no cadastro/edicao
  - backend expõe bastion efetivo e origem: `host`, `group` ou `none`
  - tela de hosts exibe badge/tooltip com bastion efetivo
  - tela administrativa de bastions exibe contagens de uso por hosts diretos, grupos e hosts herdados
- UX atual ainda nao deixa suficientemente claro como reaproveitar PEM ja cadastrada no sistema
- fase 2 de credenciais implementada parcialmente:
  - bastion pode apontar para PEM cadastrada no sistema via `systemPemKeyId`
  - fluxo legado de colar PEM no bastion foi mantido como opcional
  - terminal/SFTP/teste de conexao resolvem primeiro a PEM cadastrada e caem para PEM legada quando necessario
  - conexao via terminal diferencia erro no bastion de erro no host final
  - verificacao de host key continua ativa para o host final; trust-store dedicado de host key para bastions fica pendente para fase de seguranca

## Regra central
- bastion e um recurso de conectividade, nao uma credencial solta
- host pode usar bastion por heranca de grupo ou override direto no host
- a UI deve mostrar o bastion efetivo e a origem:
  - `Direto no host`
  - `Herdado do grupo`
  - `Sem bastion`
- credenciais de bastion devem seguir o padrao de seguranca do produto:
  - senha cifrada em repouso
  - PEM reutilizavel do cadastro de chaves PEM sempre que possivel
  - evitar colar PEM duplicada no cadastro de bastion como fluxo principal

## Casos de uso
- host privado acessivel apenas via jump server
- grupo de hosts de um cliente que compartilha o mesmo bastion
- host especifico que precisa sobrescrever o bastion herdado do grupo
- auditoria/admin quer saber rapidamente quais hosts dependem de um bastion antes de alterar ou excluir

## Escopo fase 1 - UX e visibilidade
- tela de bastions:
  - coluna ou painel `Hosts usando` - implementado como `Uso`
  - contagem de hosts vinculados diretamente - implementado
  - contagem de grupos vinculados - implementado
  - tooltip com hosts/grupos relacionados - implementado
- tela de hosts:
  - deixar campo `Bastion` mais evidente no cadastro/edicao - implementado
  - mostrar no card/lista/detalhe do host qual bastion efetivo esta sendo usado - implementado em lista/cards
  - indicar se e `direto no host` ou `herdado do grupo` - implementado via tooltip/badge
- exclusao de bastion:
  - manter bloqueio quando em uso
  - mensagem deve explicar quais hosts/grupos ainda usam o bastion - implementado com contagens

## Escopo fase 2 - Credenciais e PEM
- bastion com metodo:
  - `Senha` - existente
  - `PEM cadastrada` - implementado
  - `PEM + senha`, se alinhado ao suporte de host - pendente
- preferir selecionar uma PEM ja cadastrada no sistema - implementado
- fluxo de colar PEM diretamente no bastion deve virar opcional/legado ou migracao assistida - implementado como opcional/legado
- UI deve deixar claro:
  - `Esta chave PEM e compartilhada/reutilizada` - implementado
  - `Alterar esta PEM pode impactar outros recursos que a usam`, se aplicavel - implementado como aviso

## Escopo fase 3 - Operacao e seguranca
- teste de conectividade usando bastion efetivo
- aviso quando host usa bastion inacessivel ou revogado
- trust-store de host key para bastions, com fluxo explicito de primeiro aceite e alteracao de fingerprint
- dashboard/admin com bastions mais usados e falhas por bastion
- auditoria de alteracoes:
  - bastion criado
  - bastion editado
  - host passou a usar bastion
  - grupo passou a usar bastion
  - bastion excluido

## Fora do escopo inicial
- roteamento multi-hop com mais de um bastion
- bastion dinamico por regra de rede
- descoberta automatica de bastions
- cofre externo dedicado so para bastion

## UX recomendada
- em `Hosts`:
  - campo claro: `Bastion / Jump server`
  - opcao: `Sem bastion`
  - opcao: `Herdar do grupo`, quando o host estiver em grupo com bastion configurado
  - opcao: selecionar bastion especifico
  - badge no host: `Bastion: bastion-prod`
  - tooltip: `Herdado do grupo Cliente X` ou `Configurado diretamente no host`
- em `Bastions`:
  - badge de uso: `3 hosts`, `2 grupos`
  - acao `Ver uso`
  - listagem resumida de hosts/grupos impactados
- em erro de exclusao:
  - `Este bastion ainda e usado por 3 hosts e 2 grupos. Remova os vinculos antes de excluir.`

## Regras de dados
- `Host.bastionId` sobrescreve o bastion do grupo
- se `Host.bastionId` for `null`, a resolucao deve considerar o bastion do grupo, quando existir
- se o host nao tiver grupo ou o grupo nao tiver bastion, conexao e direta
- a UI deve diferenciar `sem override` de `forcar sem bastion`, se essa segunda opcao for adicionada no futuro

## Riscos
- usuario achar que host esta direto quando na pratica herda bastion do grupo
- duplicacao de PEM entre bastions e cadastro de PEM
- excluir/alterar bastion sem perceber impacto em varios hosts
- teste de conexao validar caminho diferente do caminho real usado no terminal

## Guardrails
- backend deve ser fonte de verdade para resolucao do bastion efetivo
- UI nao deve inferir so pelo formulario quando existir heranca de grupo
- alteracoes em bastion devem registrar auditoria administrativa
- excluir bastion em uso deve continuar bloqueado
- PEM reutilizavel deve preservar criptografia em repouso e nunca exibir chave privada

## Arquivos provaveis
- backend:
  - `apps/backend/prisma/schema.prisma`
  - `apps/backend/src/modules/bastions/*`
  - `apps/backend/src/modules/hosts/*`
  - `apps/backend/src/modules/ssh/*`
- frontend:
  - `apps/frontend/src/views/admin/BastionsView.vue`
  - `apps/frontend/src/views/HostsView.vue`
  - `apps/frontend/src/services/bastion.service.ts`
  - `apps/frontend/src/services/host.service.ts`
- shared:
  - `packages/shared/src/schemas/bastion.schema.ts`
  - `packages/shared/src/schemas/host.schema.ts`
