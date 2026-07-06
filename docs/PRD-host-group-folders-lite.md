# PRD Lite - Pastas Organizacionais por Grupo em Hosts

## Objetivo

Permitir organizar hosts dentro de um grupo usando pastas visuais, sem criar uma nova camada de permissao.

Exemplo:

- Grupo: Cliente X
  - raiz do grupo
  - pasta Proxy
    - Maquina 1
    - Maquina 2
  - pasta Banco de Dados
    - Maquina 3

## Problema

Hoje a segmentacao de acesso e feita por grupos. Isso resolve permissao, mas nao resolve organizacao interna quando um grupo possui muitos hosts.

O usuario precisa separar hosts por funcao, ambiente ou responsabilidade operacional dentro do mesmo grupo, sem criar grupos artificiais apenas para organizar a tela.

## Decisao de Produto

Pastas de grupo devem ser apenas uma hierarquia de organizacao.

Elas nao devem:

- conceder acesso;
- remover acesso;
- substituir grupo;
- criar subpermissao;
- afetar regras de auditoria ou sessao.

A permissao continua sendo decidida por:

- `hosts.scope`;
- `hosts.group_id`;
- vinculo do usuario ao grupo;
- papel admin/usuario.

## Escopo

### Incluido

- Criar pasta dentro de um grupo.
- Renomear pasta dentro de um grupo.
- Excluir pasta dentro de um grupo.
- Mover host do grupo para uma pasta do mesmo grupo.
- Mover host de uma pasta para a raiz do grupo.
- Exibir hosts agrupados por:
  - raiz do grupo;
  - pastas do grupo.
- Manter as pastas pessoais existentes.
- Manter comportamento atual de hosts sem pasta.

### Excluido

- Permissao por pasta.
- Compartilhamento de pasta entre grupos.
- Pasta com hosts de grupos diferentes.
- Subpastas.
- Regras de acesso herdadas por pasta.
- Exclusao de hosts ao excluir pasta.

## Regras Funcionais

### RF-01 - Criar Pasta de Grupo

Usuario com permissao de gerenciar hosts ou admin pode criar uma pasta em um grupo visivel/gerenciavel.

Campos:

- `name`;
- `scope = GROUP`;
- `groupId`;
- `tenantId`;
- `createdById`.

### RF-02 - Renomear Pasta de Grupo

Renomear nao deve alterar hosts vinculados.

O nome deve ser unico dentro do mesmo grupo.

### RF-03 - Excluir Pasta de Grupo

Excluir pasta nao exclui hosts.

Ao excluir:

```sql
UPDATE hosts
SET folder_id = NULL
WHERE folder_id = :folderId;
```

Os hosts voltam para a raiz do grupo.

### RF-04 - Vincular Host a Pasta

Um host so pode ser vinculado a uma pasta de grupo se:

- `host.scope = TEAM`;
- `host.group_id = folder.group_id`;
- ambos pertencem ao mesmo tenant.

Caso contrario, a API deve rejeitar.

### RF-05 - Raiz do Grupo

Hosts `TEAM` com `folder_id = NULL` devem aparecer na raiz do grupo.

### RF-06 - Pastas Pessoais Existentes

Pastas atuais devem continuar funcionando como pastas pessoais.

Na migracao, registros existentes em `folders` devem virar:

- `scope = PERSONAL`;
- `group_id = NULL`;
- `created_by_id = user_id`.

## Modelo de Dados Proposto

Evoluir `folders`:

```prisma
model Folder {
  id          Int
  name        String
  scope       FolderScope // PERSONAL | GROUP
  userId      Int?        @map("user_id")
  groupId     Int?        @map("group_id")
  tenantId    Int         @map("tenant_id")
  createdById Int?        @map("created_by_id")
  createdAt   DateTime
}
```

Indices recomendados:

```sql
CREATE INDEX folders_tenant_scope_user_name_idx
ON folders (tenant_id, scope, user_id, name);

CREATE INDEX folders_tenant_scope_group_name_idx
ON folders (tenant_id, scope, group_id, name);

CREATE INDEX hosts_tenant_deleted_group_folder_name_idx
ON hosts (tenant_id, deleted_at, group_id, folder_id, name);
```

## UX

Na sidebar de Hosts:

- Grupo pode ser expansivel.
- Dentro do grupo:
  - item "Raiz";
  - pastas do grupo;
  - contador por pasta.

Menu de contexto:

- Botao direito no grupo:
  - criar pasta;
  - atualizar.
- Botao direito na pasta:
  - renomear;
  - excluir.

Drag and drop:

- host pode ser arrastado para pasta do mesmo grupo;
- host pode ser arrastado para raiz do grupo;
- tentativa de mover para pasta de outro grupo deve ser bloqueada.

## Performance

### Premissas

Meta atual do produto: ate 300 usuarios.

Volume esperado de hosts pode crescer para:

- 800 hosts: volume atual observado em ambiente local;
- 3.000 hosts;
- 5.000 hosts.

### Medicao Inicial Local

Base local observada:

- 825 hosts ativos;
- 181 grupos;
- 3 pastas;
- 7 tags de host;
- 2 links associados.

Consultas diretas no MySQL:

- listagem paginada de 200 hosts: cerca de 0,7 ms no banco;
- `COUNT` de hosts ativos: cerca de 0,4 ms;
- maior grupo local com 43 hosts: cerca de 0,16 ms;
- agrupamento `group_id + folder_id`: cerca de 1,1 ms sem indice dedicado.

Conclusao: o risco primario nao esta no banco para o volume atual. O risco de escala esta mais ligado a:

- quantidade de chamadas no primeiro carregamento da tela;
- payload retornado por `/hosts`;
- renderizacao frontend de listas/cards;
- includes desnecessarios na listagem principal;
- contadores recalculados fora de cache.

### Medicao Chromium em Ambiente Dev

Teste executado com Chromium headless contra o ambiente dev local (`frontend 5173`, API via proxy), em modo lista e com paginacao de 40 hosts.

Para simular escala, foram criados hosts temporarios com prefixo `PERF_TEST_` e removidos ao final. Limpeza validada: `remaining_perf_hosts = 0`.

Resultados observados:

| Volume ativo | `/hosts?page=1&limit=40` | Payload `/hosts` | `/hosts/sidebar-bootstrap` | Linhas renderizadas |
|---:|---:|---:|---:|---:|
| 815 hosts | ~109 ms | ~23 KB | ~64 ms / ~24 KB | 40 |
| 3.015 hosts | ~58 ms | ~23 KB | ~56 ms / ~24 KB | 40 |
| 5.015 hosts | ~48 ms | ~23 KB | ~47 ms / ~24 KB | 40 |

Leitura:

- A listagem principal escala bem porque carrega pagina fixa de 40 hosts.
- O payload da listagem nao cresce com o total de hosts.
- O bootstrap da sidebar tambem ficou estavel nesta massa, pois o numero de grupos/pastas/tags nao cresceu proporcionalmente no teste.
- O loading visual percebido tende a estar mais relacionado ao ciclo inicial da tela e chamadas paralelas do que ao volume total de hosts.

Chamadas observadas no primeiro carregamento da lista:

- `GET /users/me/preferences`
- `POST /logs/user-productivity`
- `GET /host-links/options`
- `GET /sessions/access-map` duas vezes em algumas execucoes
- `GET /hosts?page=1&limit=40`
- `GET /hosts/sidebar-bootstrap`
- `GET /features`
- chamadas diferidas: `agents/status`, `bastions`, `pem-keys`, `forwardings`, `agents`

Oportunidades de melhoria identificadas:

- Evitar chamada duplicada de `/sessions/access-map` no primeiro carregamento.
- Garantir que `agents/status` rode somente quando houver hosts visiveis que dependam de agente.
- Manter chamadas diferidas fora do caminho critico do primeiro render.
- Separar indicador de carregamento da sidebar/lista para reduzir percepcao de "pagina inteira carregando".
- Considerar skeleton apenas na area da lista, mantendo sidebar responsiva quando bootstrap ja retornou.

### Regras de Implementacao para Nao Degradar

- Manter paginacao server-side.
- Nao carregar todos os hosts para montar a arvore.
- Contadores de grupo/pasta devem vir agregados do backend.
- Manter cache do bootstrap da sidebar.
- Evitar N+1 para pastas, tags ou links.
- Nao incluir segredo, senha ou PEM em payloads de listagem.
- Listagem de hosts deve continuar limitada por pagina.

## Plano de Implementacao

### Fase 1 - Preparacao e Medicao

- Medir `/hosts`, `/hosts/sidebar-bootstrap`, `/sessions/access-map` e renderizacao da tela `/hosts` com Chromium.
- Registrar baseline com 800 hosts.
- Simular ou preparar massa de 3k e 5k hosts antes de alterar UX.

### Fase 2 - Backend

- Criar migration de `FolderScope` e `group_id`.
- Adicionar indices.
- Ajustar repositorio/service de pastas.
- Validar integridade host/pasta/grupo ao atualizar host.
- Ajustar bootstrap da sidebar para retornar pastas pessoais e pastas por grupo.

### Fase 3 - Frontend

- Ajustar tipos de `FolderPublic`.
- Exibir pastas dentro de grupos.
- Implementar menu de contexto em grupo/pasta.
- Implementar criar/renomear/excluir pasta de grupo.
- Implementar mover host para pasta/raiz do grupo.

### Fase 4 - Validacao de Performance

- Repetir medicao com 800 hosts.
- Repetir medicao com 3k hosts.
- Repetir medicao com 5k hosts.
- Aceitar somente se:
  - primeiro render util da tela nao piorar de forma perceptivel;
  - endpoints principais ficarem dentro do SLA local definido;
  - scroll/loading nao crescer proporcionalmente ao total de hosts.

## Riscos

### Risco Medio - Confusao entre Pasta e Permissao

Mitigacao:

- microcopy clara: pasta organiza, grupo concede acesso;
- bloquear pasta de grupo em host fora do grupo.

### Risco Medio - Tela de Hosts Crescer em Complexidade

Mitigacao:

- manter sidebar como fonte da hierarquia;
- nao colocar arvore complexa dentro dos cards;
- extrair componente se a sidebar ficar grande demais.

### Risco Baixo - Banco

Mitigacao:

- indices dedicados;
- agregacoes no backend;
- paginacao mantida.

### Risco Medio - Primeiro Carregamento

Mitigacao:

- medir antes/depois com Chromium;
- adiar chamadas nao essenciais;
- reduzir payload da listagem se necessario;
- manter cache de bootstrap.

## Criterios de Aceite

- Admin consegue criar pasta dentro de um grupo.
- Admin consegue renomear pasta dentro de um grupo.
- Admin consegue excluir pasta sem excluir hosts.
- Hosts da pasta excluida voltam para raiz do grupo.
- Usuario sem acesso ao grupo nao enxerga a pasta.
- Host nao pode ser vinculado a pasta de outro grupo.
- Pastas pessoais continuam funcionando.
- `/hosts` continua paginado.
- Sidebar mostra contadores coerentes por grupo/pasta.
- Performance validada com baseline de 800, 3k e 5k hosts.
