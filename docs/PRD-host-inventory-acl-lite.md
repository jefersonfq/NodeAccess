# PRD Lite - Inventario Corporativo de Hosts e ACL por Arvore

## Objetivo

Evoluir o modelo de organizacao e permissao de hosts do NodeAccess para separar tres camadas que hoje tendem a se misturar:

- inventario corporativo: arvore oficial de diretorios e hosts do tenant;
- seguranca: ACL por pasta/host, com heranca;
- produtividade pessoal: favoritos, recentes, atalhos e saved views.

A direcao de produto e:

```text
A organizacao da empresa deve ser unica.
A visao do usuario pode ser personalizada.
```

## Contexto atual

O modelo atual usa:

- host `PERSONAL`;
- host `TEAM`;
- host `GLOBAL`;
- pastas pessoais;
- grupos como segmentacao direta de acesso.

Esse modelo e simples e funcional, mas mistura:

- onde o host aparece;
- quem pode ver;
- quem pode conectar;
- quem pode editar;
- como o usuario organiza seu trabalho.

Em ambientes corporativos, isso dificulta responder perguntas como:

- quem tem acesso a este host?
- de onde esta permissao veio?
- quais usuarios de um time conseguem conectar neste diretorio?
- um host pessoal ainda e recurso gerenciado pela empresa?

## Principios

- A arvore oficial pertence ao tenant, nao ao usuario.
- A arvore representa a forma como a empresa enxerga sua infraestrutura.
- A ACL e a fonte de seguranca para recursos do inventario.
- Views pessoais nao concedem permissao.
- Backend sempre valida permissao efetiva.
- Frontend apenas reflete a permissao calculada.
- Admin do tenant deve conseguir auditar todos os recursos do tenant.
- Ausencia de permissao deve negar por padrao.
- Toda mudanca de ACL deve gerar auditoria.

## Relacao com RBAC

Este PRD nao substitui o RBAC.

O modelo recomendado combina:

- RBAC de plataforma;
- ACL de recurso.

RBAC responde:

```text
Este usuario pode administrar seguranca?
Este usuario pode criar hosts?
Este usuario pode ver auditoria?
Este usuario pode gerenciar integracoes?
```

ACL responde:

```text
Este usuario pode ver esta pasta?
Este usuario pode conectar neste host?
Este grupo pode editar esta subarvore?
Este fornecedor pode conectar somente neste host?
```

Exemplo:

- `security.permissions.manage` no RBAC permite abrir a administracao de permissoes.
- `host_acl.admin` na pasta `Producao/Banco` permite alterar ACL daquele ramo.

## Modelo conceitual

### Arvore de inventario

Cada tenant possui uma raiz logica unica.

Essa raiz pode ser invisivel na UI, mas deve existir no modelo para manter:

- heranca consistente;
- hosts sem pasta;
- auditoria;
- migracao;
- calculo de permissao efetiva.

Exemplo:

```text
Tenant Root
+-- Producao
    +-- Infra
    +-- Produto X
        +-- DevOps
        +-- Containers
        +-- Banco
            +-- DBA
            +-- mysql-01
```

Host sem pasta deve ser tratado como filho da raiz logica do tenant.

### ACL

A ACL nasce preferencialmente na pasta.

Host pode ter ACL local apenas para excecoes justificadas.

Permissoes iniciais recomendadas:

- `view`: pode ver pasta/host na arvore;
- `connect`: pode abrir sessao ou usar acesso operacional;
- `edit`: pode editar metadados, credenciais, conectividade e associacoes do host;
- `admin`: pode administrar ACL local daquele recurso/subarvore.

Principals suportados:

- usuario;
- grupo interno;
- role interna, quando o RBAC estiver consolidado;
- no futuro, grupos externos apenas depois de sincronizados/mapeados para grupos internos.

### Heranca

A UI deve diferenciar claramente:

- permissao herdada;
- permissao local;
- origem da permissao herdada;
- excecao local.

Exemplo de painel:

```text
Produto X
--------------------------
Permissoes herdadas:
Pasta: Producao
   Team Infra: visualizar, conectar
   Team DevOps: visualizar, conectar, editar
   Lucien: visualizar
--------------------------
Permissoes locais:
Fornecedor XPTO: visualizar, conectar
--------------------------
Adicionar...
```

### Deny explicito

Nao incluir `deny` explicito no primeiro corte.

Motivo:

- aumenta muito a complexidade de suporte;
- dificulta explicar permissao efetiva;
- pode gerar conflito com heranca;
- exige ferramenta forte de diagnostico antes de ser seguro para usuarios.

Primeiro corte recomendado:

- heranca positiva;
- permissoes locais adicionais;
- opcao futura de quebrar heranca em casos controlados.

## Views pessoais

Views pessoais sao produtividade, nao seguranca.

Incluido:

- favoritos;
- recentes;
- saved views;
- filtros salvos;
- atalhos pessoais para pastas/hosts permitidos;
- ordenacao/preferencias pessoais.

Excluido:

- conceder acesso;
- ocultar recurso de auditoria/admin;
- criar inventario paralelo invisivel para o tenant.

## Hosts privados

### Decisao recomendada

Em um ambiente gerenciado pela empresa, host privado nao deve ser o padrao.

Diferenca importante:

- segredo privado, como no 1Password, pode fazer sentido;
- recurso de infraestrutura privado dentro de um tenant corporativo deve ser excecao governada.

Um host "privado" ainda representa:

- destino de rede;
- credencial ou referencia de credencial;
- risco operacional;
- potencial acesso lateral;
- trilha de auditoria;
- consumo de licenca e suporte.

Portanto, o host nunca deve ser realmente privado contra administradores do tenant.

### Modelo recomendado

Substituir "host privado" por uma politica controlada:

```text
Personal managed hosts
```

Ou seja:

- recurso pertence ao tenant;
- visibilidade operacional inicial pode ser restrita ao criador;
- administradores e seguranca conseguem auditar e assumir governanca;
- toda sessao e alteracao continua auditada;
- a funcionalidade pode ser habilitada ou desabilitada por politica.

### Politicas recomendadas

Configuracao por tenant:

- `disabled`: usuarios nao podem criar hosts pessoais;
- `enabled_for_groups`: apenas grupos autorizados podem criar;
- `enabled_for_all`: todos os usuarios podem criar, se tiverem permissao RBAC;
- `approval_required`: criacao exige aprovacao ou revisao posterior.

Configuracao por grupo/time:

- permitir criar host gerenciado pessoal;
- limitar protocolos permitidos;
- limitar uso de agentes/conectores;
- limitar tags ou pastas de destino;
- exigir expiracao/revisao periodica;
- exigir credencial via vault/1Password, quando aplicavel.

Regras minimas:

- admin do tenant sempre pode localizar o host;
- auditoria sempre registra conexoes;
- host pessoal nao deve aparecer como "fora do tenant";
- usuario nao deve conseguir esconder host de compliance;
- exportacoes e relatorios administrativos devem incluir esses hosts com badge clara.

### Quando faz sentido permitir

Faz sentido em cenarios como:

- laboratorio individual;
- sandbox temporario;
- host de desenvolvimento local/remoto;
- acesso operacional de curta duracao;
- ambiente de fornecedor sob responsabilidade de um usuario interno.

Nao faz sentido como padrao para:

- producao;
- infraestrutura compartilhada;
- ativos permanentes da empresa;
- hosts com credenciais sensiveis fora de governanca;
- recursos que deveriam pertencer a um time ou sistema.

## UX proposta

### Tela de Hosts

Remover a dependencia principal dos menus:

- Personal;
- Team;
- Global.

Substituir por:

- arvore oficial do tenant;
- busca;
- filtros de protocolo/status/tag;
- favoritos;
- recentes;
- saved views;
- modo admin de simulacao.

### Menu de contexto

Em pasta ou host:

- abrir;
- favoritar;
- propriedades;
- permissoes;
- mover, se tiver permissao;
- editar, se tiver permissao;
- excluir, se tiver permissao e regra permitir.

### Painel de permissoes

Botao direito ou acao "Permissoes".

Deve mostrar:

- quem pode visualizar;
- quem pode conectar;
- quem pode editar;
- quem pode administrar;
- o que e herdado;
- o que e local;
- origem da heranca;
- impacto em quantidade de hosts abaixo, quando aplicavel.

### Visualizar como

Na tela de Hosts, adicionar modo administrativo:

- visualizar como usuario;
- visualizar como grupo/time.

Objetivo:

- validar o que uma pessoa ve;
- diagnosticar permissoes;
- ajustar ACL sem sair do contexto da arvore.

Esse modo exige permissao RBAC propria, por exemplo:

```text
security.permissions.simulate
```

### Mapa de permissoes

Nova tela:

```text
Administracao -> Seguranca -> Mapa de Permissoes
```

Consultas principais:

- quem acessa este host ou diretorio?
- onde este usuario tem acesso?
- onde este grupo tem acesso?
- quais acessos sao locais vs herdados?
- quais hosts possuem excecoes locais?
- quais recursos estao sem owner/grupo responsavel?

## Modelo de dados inicial sugerido

Entidades conceituais:

```text
InventoryNode
  id
  tenantId
  parentId
  type: ROOT | FOLDER | HOST
  hostId?
  name
  path
  depth
  createdById
  updatedById
  deletedAt?

ResourceAclEntry
  id
  tenantId
  resourceType: INVENTORY_NODE | HOST
  resourceId
  principalType: USER | GROUP | ROLE
  principalId
  permissions: view/connect/edit/admin
  inheritToChildren
  createdById
  createdAt

PersonalView
  id
  tenantId
  userId
  type: FAVORITES | SAVED_VIEW | SHORTCUT
  payload
```

Observacoes:

- pode ser mais simples manter `host.folder_id` no primeiro corte e evoluir para `InventoryNode` depois;
- se a arvore crescer, avaliar closure table ou materializacao de path para consultas de heranca;
- calculo de permissao efetiva deve ser centralizado no backend;
- listagens devem continuar paginadas e filtradas no servidor.

## Performance

Regras:

- nao carregar catalogo completo no browser;
- sidebar deve usar resumo leve;
- contadores devem respeitar ACL efetiva;
- contadores administrativos podem ter modo total vs "visivel para X";
- permissao efetiva precisa ser resolvida de forma indexavel;
- cache de permissao deve invalidar em mudanca de ACL, grupo, usuario ou arvore.

Para o volume alvo inicial, uma solucao com SQL bem indexado e cache curto deve ser suficiente.

Antes de escala maior, avaliar:

- closure table de arvore;
- tabela de permissoes efetivas materializada;
- Redis para cache por `tenantId:userId`;
- invalidacao por versao de ACL do tenant.

## Auditoria

Auditar:

- criacao/edicao/exclusao de pasta;
- movimentacao de host;
- alteracao de ACL;
- quebra futura de heranca;
- simulacao "visualizar como";
- criacao de host pessoal gerenciado;
- conversao de host pessoal para inventario oficial;
- acesso negado relevante em host sensivel.

## Migracao do modelo atual

Mapeamento sugerido:

- `GLOBAL`: mover para arvore oficial do tenant, com ACL de visualizacao/conexao conforme politica padrao;
- `TEAM`: mover para pasta oficial ou raiz do tenant, com ACL para o grupo atual;
- `PERSONAL`: migrar conforme politica do tenant:
  - converter para host gerenciado pessoal;
  - mover para pasta oficial com ACL local para o usuario;
  - exigir revisao/admin antes de migrar;
  - arquivar/desativar se for recurso legado sem governanca.

Durante a transicao:

- manter compatibilidade de leitura com `scope`;
- exibir aviso administrativo de modelo legado;
- criar relatorio de hosts pessoais e de equipe a revisar;
- nao quebrar sessao existente nem auditoria historica.

## Fases recomendadas

### Fase 0 - Decisao e politica

- Definir se hosts pessoais gerenciados serao permitidos.
- Definir politica padrao por tenant.
- Definir permissoes RBAC para administrar ACL e simular visualizacao.

### Fase 1 - Modelo de arvore oficial

- Criar raiz logica do tenant.
- Permitir pastas corporativas.
- Limitar profundidade inicial.
- Manter host sem pasta na raiz logica.

### Fase 2 - ACL positiva com heranca

- ACL por pasta.
- Excecao local por host.
- Resolver permissao efetiva no backend.
- Painel simples de permissoes.

### Fase 3 - Migracao de Personal/Team/Global

- Migrar `TEAM` para ACL de grupo.
- Migrar `GLOBAL` para ACL padrao.
- Tratar `PERSONAL` conforme politica.
- Remover menus principais Personal/Team/Global da UI depois da migracao.

### Fase 4 - Views pessoais

- Favoritos.
- Saved views.
- Atalhos pessoais.
- Consultas salvas por filtro.

### Fase 5 - Mapa de permissoes e simulacao

- Visualizar como usuario.
- Visualizar como grupo.
- Tela administrativa de mapa de permissoes.
- Relatorios de excecoes.

## Fora do escopo inicial

- `deny` explicito estilo NTFS;
- ABAC completo por horario/IP/device posture;
- workflow completo de aprovacao;
- delegacao temporaria de permissao;
- sincronizacao direta de ACL com grupos externos sem grupo interno;
- permissao por arquivo SFTP;
- permissao por comando SSH.

## Questoes em aberto

- Qual deve ser a profundidade maxima da arvore?
- Hosts pessoais gerenciados devem nascer desabilitados por padrao?
- A criacao de host pessoal exige aprovacao?
- Admin pode mover host pessoal para arvore oficial sem consentimento do criador?
- Quais permissoes efetivas devem aparecer para usuarios comuns vs admins?
- Contador de hosts por pasta mostra apenas visiveis ou total administrativo?

## Decisao atual

Direcao aprovada para estudo e PRD.

Nao implementar diretamente sobre o modelo atual sem antes fechar:

- politica de hosts pessoais gerenciados;
- modelo minimo de ACL;
- estrategia de migracao;
- impacto em RBAC;
- UX de administracao de permissoes.
