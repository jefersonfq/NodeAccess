# PRD Host Bulk Actions Lite

## Objetivo
Permitir que administradores alterem configuracoes de muitos hosts de forma segura, auditavel e intuitiva, sem precisar abrir host por host.

## Status da implementacao
Primeira entrega implementada.

Inclui:
- modo de selecao ativado sob demanda na tela de Hosts
- selecao manual por checkbox
- selecao de hosts visiveis
- selecao de todos os resultados filtrados
- filtros operacionais para refinar o lote:
  - bastion atual
  - chave PEM atual
  - tipo de autenticacao
  - modo de conexao
- preview obrigatorio antes de aplicar
- limite sincronono de ate 500 hosts por operacao
- acoes implementadas:
  - alterar Bastion
  - alterar Chave PEM
  - adicionar Tags
  - remover Tags
- resultado pos-acao no modal
- download de relatorio CSV/JSON
- historico de acoes em massa por tenant
- relatorio JSON por execucao no historico
- snapshot `before/after` para novas execucoes
- rollback controlado para execucoes novas com snapshot
- log administrativo complementar
- acesso restrito a admin

Nao implementado nesta entrega:
- mover hosts para pasta em massa
- jobs assincronos para lotes acima de 500 hosts
- progresso em tempo real
- filtros dentro do historico
- detalhe expandido do historico em tela dedicada
- permissoes granulares via RBAC
- confirmacao digitada para lotes de alto impacto

Observacao de compatibilidade:
- historicos criados antes da introducao do snapshot continuam visiveis, mas nao sao reversiveis.

## Motivacao
Em ambientes com centenas ou milhares de hosts, operacoes comuns podem afetar muitos registros ao mesmo tempo:
- trocar a Chave PEM vinculada
- trocar Bastion / Jumpserver
- adicionar ou remover tags
- mover hosts para pasta
- alterar grupo ou escopo
- alterar modo de conexao
- aplicar padroes em hosts filtrados por nome, grupo, tag, pasta ou estado atual

Sem edicao em massa, o NodeAccess vira gargalo operacional quando o administrador precisa manter inventario em escala.

## Criterios de sucesso
- administrador consegue selecionar e alterar 100+ hosts em poucos passos
- filtros deixam claro qual conjunto sera afetado
- nenhuma alteracao em massa ocorre sem preview e confirmacao
- operacoes sensiveis ficam auditadas com antes/depois quando aplicavel
- falhas parciais sao explicadas por host
- a tela continua usavel com bases grandes, usando paginacao e filtros server-side

## Usuarios alvo
- admin de tenant
- futuro papel RBAC com capacidade `hosts.bulk_update`
- superadmin apenas dentro do tenant ativo, sem atravessar tenants implicitamente

## Escopo inicial
### Acoes em massa prioritarias
- `Alterar Bastion`
- `Alterar Chave PEM`
- `Adicionar Tags`
- `Remover Tags`
- `Mover para Pasta`

Status:
- implementadas: Bastion, Chave PEM, Adicionar Tags, Remover Tags
- pendente: Mover para Pasta

### Selecionar hosts por
- selecao manual por checkbox
- selecionar todos da pagina atual
- selecionar todos os resultados filtrados
- filtros existentes da tela de Hosts:
  - grupo
  - tag
  - pasta
  - busca por nome/IP
  - escopo
- filtros novos recomendados:
  - bastion atual
  - chave PEM atual
  - modo de conexao
  - auth type
  - hosts sem bastion
  - hosts sem PEM
  - hosts com senha

## Fora do escopo inicial
- alterar senha em massa
- importar ou revelar segredo em massa
- excluir hosts em massa
- alterar `onePasswordRef` em massa
- aplicar scripts/comandos em massa
- operacoes cross-tenant
- edicao simultanea de muitos campos em um unico formulario generico

## UX recomendada
### Barra de selecao
Quando houver hosts selecionados, mostrar uma barra fixa/discreta:
- `{count} hosts selecionados`
- `Selecionar todos os {total} resultados`
- `Limpar selecao`
- menu `Acoes`

Acoes no menu:
- `Alterar Bastion`
- `Alterar Chave PEM`
- `Adicionar Tags`
- `Remover Tags`
- `Mover para Pasta`

### Selecao por filtro
O fluxo deve suportar dois modos:
- `selecionados manualmente`
- `todos os resultados do filtro atual`

Para `todos os resultados do filtro atual`, a confirmacao deve mostrar os filtros aplicados de forma legivel.

Exemplo:
- `Grupo: Produção`
- `Tag: Linux`
- `Nome contém: app-`
- `Bastion atual: bastion-antigo`

### Modal de acao
Cada acao deve ter modal proprio e simples.

Exemplo `Alterar Bastion`:
- resumo da selecao
- bastion atual:
  - `varios valores` quando houver mistura
  - `sem bastion` quando todos estiverem sem bastion
- novo bastion:
  - selecionar bastion
  - opcao `remover bastion direto do host` quando fizer sentido
- aviso:
  - `A alteracao afeta novas sessoes. Sessoes SSH ja abertas nao serao alteradas.`
- botao primario:
  - `Aplicar em {count} hosts`

### Preview obrigatorio
Antes de confirmar, mostrar:
- total afetado
- amostra dos primeiros hosts
- contagem por estado atual quando aplicavel
- alertas de permissao, hosts excluidos, referencias invalidas ou conflitos

### Resultado
Apos aplicar:
- `{success} atualizados`
- `{failed} falharam`
- `{skipped} ignorados`
- tabela curta com falhas
- download de relatorio CSV/JSON

## Regras de seguranca
- usuario sem permissao de gerenciar hosts nao ve acoes em massa
- admin so altera hosts visiveis e dentro do tenant ativo
- host em soft delete nao deve ser alterado por bulk action operacional
- referencias devem ser validadas no backend:
  - bastion existe e pertence ao tenant
  - PEM existe e usuario/admin pode usa-la
  - tag/pasta pertence ao tenant/usuario conforme regra atual
- segredos nunca devem ser retornados no preview ou relatorio
- operacoes de alto impacto devem exigir confirmacao explicita

## Auditoria
Cada bulk action deve gerar log administrativo com:
- usuario executor
- tenant
- tipo de acao
- origem da selecao:
  - manual
  - filtro
- filtros usados quando houver
- quantidade solicitada
- quantidade atualizada
- quantidade ignorada/falha
- ids de hosts afetados, com limite ou referencia de relatorio
- valor anterior e novo quando aplicavel
- data/hora

Para alteracoes sensiveis como Bastion e PEM, registrar antes/depois por host em formato resumido.

## Modelo de operacao sugerido
### Entrada comum
```ts
type HostBulkSelection =
  | { mode: 'ids'; hostIds: number[] }
  | { mode: 'filter'; filter: HostBulkFilter }

type HostBulkAction =
  | { type: 'set_bastion'; bastionId: number | null }
  | { type: 'set_pem_key'; pemKeyId: number | null }
  | { type: 'add_tags'; tagIds: number[] }
  | { type: 'remove_tags'; tagIds: number[] }
  | { type: 'move_folder'; folderId: number | null }
```

### Endpoints sugeridos
- `POST /api/v1/hosts/bulk/preview`
- `POST /api/v1/hosts/bulk/apply`
- `GET /api/v1/hosts/bulk/history`
- `POST /api/v1/hosts/bulk/history/:id/rollback`

O preview e o apply devem usar o mesmo contrato de selecao. Para reduzir risco de divergencia, o `apply` pode receber um `previewId` temporario ou um hash do preview.

## Backend recomendado
Criar service especifico para evitar acoplar a logica ao CRUD simples de host:
- `HostBulkActionService`
- `HostBulkActionValidator`
- `HostBulkActionRepository`

Responsabilidades:
- resolver selecao por ids ou filtros
- validar permissao por host
- calcular preview
- aplicar alteracao com transacao quando viavel
- registrar auditoria
- retornar resultado por host

## Performance e escala
- filtros e selecao por resultado devem ser server-side
- evitar carregar 1000+ hosts completos no browser apenas para selecionar
- preview deve trazer amostra e agregacoes, nao necessariamente todos os dados
- aplicar em lotes internamente quando necessario
- limite inicial sugerido:
  - ate 500 hosts: aplicacao sincronona
  - acima disso: preparar evolucao para job assincrono

## Estados de UX
- loading de preview
- preview vazio
- preview com warnings
- bloqueio por permissao
- confirmacao pendente
- aplicando
- sucesso total
- sucesso parcial
- falha total

## Microcopy recomendada
- `A alteracao sera aplicada apenas aos hosts selecionados.`
- `Sessoes SSH ja abertas nao serao alteradas. Novas conexoes usarao a nova configuracao.`
- `Revise os hosts afetados antes de confirmar.`
- `Alguns hosts nao podem ser alterados. Veja os motivos antes de aplicar.`
- `Esta acao sera registrada na auditoria administrativa.`

## Roadmap sugerido
### Fase 1 - implementada
- selecao por checkbox na tela de Hosts
- selecionar todos da pagina
- selecionar todos os resultados filtrados
- filtros por bastion atual, PEM atual, auth type e modo de conexao
- acoes:
  - alterar Bastion
  - alterar Chave PEM
  - adicionar/remover Tags
- preview obrigatorio
- apply sincronono
- auditoria basica
- relatorio CSV/JSON de resultado
- historico de bulk actions
- snapshot antes/depois por host para novas execucoes
- rollback controlado quando houver snapshot

### Fase 2 - melhoria operacional
- filtros dentro do historico:
  - acao
  - usuario executor
  - periodo
  - status
- detalhe expandido do historico:
  - todos os hosts afetados
  - antes/depois legivel
  - falhas e ignorados sem depender apenas do JSON
- mover para Pasta
- confirmacao digitada para lotes grandes ou acoes sensiveis
- repetir acao a partir de uma execucao anterior

### Fase 3 - escala
- jobs assincronos para lotes grandes
- progresso em tempo real
- cancelamento de job quando tecnicamente seguro
- retencao/configuracao de relatorios de historico
- notificacao de conclusao para operacoes longas

### Fase 4 - governanca e automacao
- permissoes granulares/RBAC:
  - `hosts.bulk.update_bastion`
  - `hosts.bulk.update_pem_key`
  - `hosts.bulk.update_tags`
  - `hosts.bulk.rollback`
- alterar modo de conexao em massa
- assistente de migracao operacional:
  - `hosts sem bastion`
  - `hosts usando senha`
  - `hosts com PEM antiga`
- API publica/admin para automacao controlada
- integracao futura com RBAC granular

## Riscos e trade-offs
- selecionar todos por filtro pode afetar mais hosts que o admin espera; preview e confirmacao sao obrigatorios
- atualizar campo errado em massa pode quebrar acesso operacional; auditoria e resultado por host ajudam suporte
- fazer tudo no frontend com multiplos PATCH aumenta risco de falha parcial sem rastreabilidade; backend deve ser fonte de verdade
- job assincrono e mais robusto para escala, mas aumenta complexidade; fase 1 pode ser sincronona com limite claro
- rollback automatico nem sempre e seguro quando referencias mudam; por isso deve permanecer controlado, baseado em snapshot e indisponivel para historicos sem `before/after`
