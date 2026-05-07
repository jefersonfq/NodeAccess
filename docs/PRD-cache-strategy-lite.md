# PRD Cache Strategy Lite

## Objetivo

Definir uma estrategia de cache para o NodeAccess que melhore tempo percebido de resposta sem introduzir `stale state` perigoso, especialmente nas telas administrativas e de configuracao.

## Problema

Hoje o produto ja tem varios pontos com leituras repetidas:

- `settings`
- `features`
- `integrations`
- `folders`
- `groups`
- `bastions`
- `pem-keys`
- `tags`
- `hosts`

Mesmo quando cada endpoint responde rapido, o acúmulo de requests concorrentes piora a sensação de fluidez.

Ao mesmo tempo, aplicar cache sem criterio gera risco:

- UI desatualizada
- configuracao antiga persistindo por tempo demais
- estados operacionais mentindo para o usuario
- bugs dificeis de reproduzir

## Principios

- cache seletivo, nunca indiscriminado
- TTL curto por padrao
- invalidação explicita por mutacao
- quando possivel, atualizar o cache com o retorno da escrita
- dados vivos e operacionais devem permanecer frescos
- a estrategia precisa ser observavel

## Estado atual

Ja existe base de cache em memoria no frontend:

- `createTimedPromiseCache`
- `createKeyedTimedPromiseCache`

Ja aplicado ou iniciado em:

- `settings`
- `features`
- `integrations`
- `folders`
- `groups`
- `bastions`
- `pem-keys`
- `tags`
- `hosts`

Tambem ja existe evolucao para:

- `clear`
- `set`
- `update`
- leitura por chave de query quando necessario

## Tipos de dado e politica recomendada

### 1. Dado semi-estatico administrativo

Exemplos:

- `folders`
- `groups`
- `bastions`
- `pem-keys`
- `tags`
- `integrations`
- `settings`
- `features`

Politica recomendada:

- cache em memoria
- TTL de `15s` a `60s`
- update no write path
- invalidação seletiva quando o retorno nao trouxer payload suficiente

### 2. Listagens de trabalho

Exemplos:

- `hosts list`
- `audit list`
- `sessions list`

Politica recomendada:

- cache por chave de query
- TTL curto
- preferir `update` do cache local quando a mutacao afetar a listagem corrente
- limpar apenas os filtros impactados, nao tudo

### 3. Detalhes

Exemplos:

- `host detail`
- `integration detail`
- `session audit detail`

Politica recomendada:

- cache por `id`
- TTL curto
- atualizar com o retorno da mutation sempre que possivel

### 4. Dados vivos

Exemplos:

- `agents/status`
- sessoes ativas
- websocket
- terminal
- SFTP
- progresso ao vivo

Politica recomendada:

- nao usar cache tradicional de TTL como fonte principal
- usar polling ou stream controlado
- no maximo, cache efemero de curtissima duracao apenas para evitar requests duplicadas simultaneas

### 5. Dados sensiveis

Exemplos:

- secrets
- credenciais resolvidas
- conteudo sensivel operacional

Politica recomendada:

- nao persistir em cache do cliente
- evitar reter alem do necessario para a propria renderizacao imediata

## Tecnicas recomendadas

### TTL curto em memoria

Melhor para:

- reduzir fetch redundante
- manter implementacao simples
- facilitar rollback

### Update no write path

Ao criar, editar ou remover:

- usar o retorno da API para atualizar o cache local;
- evitar refetch total quando o payload retornado for suficiente.

Exemplos:

- `create bastion` adiciona item no cache da lista;
- `update host` atualiza cache de detalhe e cache da listagem corrente;
- `delete folder` remove item do cache da lista.

### Invalidação seletiva

Quando nao for seguro atualizar localmente:

- limpar apenas o cache afetado;
- evitar limpar caches nao relacionados.

Exemplos:

- mudar uma integracao limpa `integrations list` e o detalhe daquele provider;
- mudar tags de um host pode invalidar `hosts list` e `tags`, sem tocar `settings`.

### Cache por chave

Necessario para listas com filtros.

Exemplos:

- `hosts?page=1&limit=200`
- `hosts?search=db`
- `session-audits?status=failed`

Sem chave, um filtro sobrescreve o outro.

### Stale-while-revalidate local

Faz sentido como evolucao futura em telas administrativas:

- mostrar cache imediato
- atualizar em background
- trocar a tela silenciosamente quando a resposta nova chegar

Recomendado so onde a UX justificar e o stale state for aceitavel.

## O que evitar

- cache persistente amplo em `localStorage` sem politica de versao
- cache de dados vivos como se fossem semi-estaticos
- depender apenas de TTL sem invalidar no write path
- limpar tudo sempre que uma unica entidade mudar
- esconder latencia real com cache em cima de estado sensivel

## Estrategia recomendada por modulo

### Hosts

- `list`: cache por query
- `get`: cache por `id`
- `create/update/delete`: atualizar lista default e detalhe quando possivel
- filtros secundarios podem ser invalidados seletivamente se o impacto ficar ambíguo

### Bastions / Folders / Groups / Pem Keys / Tags

- cache simples de lista unica
- mutations atualizam o cache da propria lista

### Integrations

- lista com cache curto
- detalhe por provider com cache proprio
- mutacoes limpam ou atualizam apenas o provider afetado e a lista consolidada

### Settings / Features

- cache curto por tenant
- invalidação quando salvar license/settings ou ao expirar sessao

### Sessions / Agent status

- sem cache tradicional como fonte primaria
- tratar separadamente de acordo com polling e atualizacao ao vivo

## Observabilidade de cache

Se o cache vai ganhar importancia, ele precisa ser visivel.

## Metricas recomendadas

Por cache ou por modulo:

- `hits`
- `misses`
- `hitRate`
- `sets`
- `updates`
- `clears`
- `entries`
- `lastHitAt`
- `lastMissAt`

Tambem faz sentido:

- tempo poupado estimado por cache hit
- tamanho aproximado da entrada
- quantas invalidações vieram de mutation vs TTL expirado

## Gestao em Configuracoes

Faz sentido expor uma area simples de cache em `Configuracoes` ou `Administracao`.

### O que mostrar

- caches registrados por nome
- TTL configurado
- quantidade de entradas
- hit rate
- ultimo hit
- ultimo miss
- ultima limpeza

### O que permitir

- limpar cache especifico
- limpar todos os caches do frontend
- forcar refresh de um cache
- opcional futuro: habilitar modo debug de cache

### Regras

- comecar read-only + limpar
- renovacao/refresh manual pode vir depois
- nao misturar essa tela com caches do backend sem separar bem a origem

## Desenho tecnico recomendado

### Passo 1

Criar um pequeno `cache registry` no frontend.

Cada cache registra:

- nome
- tipo (`timed`, `keyed`)
- TTL
- contadores
- handlers `clear`
- opcionalmente `refresh`

### Passo 2

Instrumentar `service-cache.ts` para contar:

- hits
- misses
- sets
- updates
- clears

### Passo 3

Criar uma tela admin de cache com:

- tabela de caches
- acoes de limpar
- acoes de refresh quando suportado

## Proximos passos recomendados

1. consolidar `cache registry` no frontend
2. instrumentar hit/miss/update/clear no helper comum
3. aplicar o padrao primeiro em:
   - `hosts`
   - `folders`
   - `groups`
   - `bastions`
   - `pem-keys`
   - `tags`
4. revisar `integrations`, `settings` e `features` no mesmo modelo
5. criar tela de observabilidade/gestao de cache em `Configuracoes`
6. depois avaliar se alguma telemetria deve subir tambem para backend

## Recomendacao objetiva

Vale continuar nessa direcao.

O melhor caminho nao e apenas “ter cache”.

O caminho certo e:

- cache curto
- invalidação por mutação
- update no write path
- observabilidade
- gestao simples pelo admin

Isso melhora tempo percebido, reduz fetch redundante e mantém previsibilidade operacional.
