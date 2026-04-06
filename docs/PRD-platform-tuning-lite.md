# PRD Platform Tuning Lite

## Objetivo
Definir uma frente de tuning de plataforma focada em velocidade percebida, estabilidade operacional e menor custo de execução, sem alterar o comportamento funcional esperado do produto.

## Problema
O produto ja evoluiu em varias frentes e agora apresenta oportunidades de tuning em:
- cache de interface e dados
- indices de banco
- tempo e tratamento de expiracao de sessao
- recuperacao de telas apos deploys ou assets desatualizados
- ajustes de backend e frontend que melhorem latencia e robustez

Sem uma direcao clara, existe risco de:
- aplicar cache de forma insegura
- mascarar inconsistencias com hard reload manual
- criar indices sem ganho real
- piorar a experiencia de sessao expirada
- otimizar o lugar errado antes de medir

## Principios
- tuning nao deve quebrar fluxo de produto
- toda mudanca deve ser reversivel
- preferir ganhos de baixo risco antes de refactors grandes
- priorizar cache seletivo e invalidação clara
- sessao expirada deve ser tratada de forma previsivel e amigavel
- sempre que possivel, medir antes e depois

## Objetivos especificos
1. reduzir tempo de carregamento e recarga das telas mais usadas
2. reduzir custo de queries repetidas e polling desnecessario
3. melhorar robustez de expiracao de sessao e troca de versao do frontend
4. reduzir necessidade de hard reload manual no navegador
5. aumentar estabilidade de backend e frontend sob uso normal

## Escopo
### Frontend
- politica de cache para dados e assets
- invalidação de dados por tela
- reducao de chamadas redundantes
- tratamento melhor de `401`, `stale assets` e `chunk load errors`
- hard reload controlado apenas quando realmente necessario

### Backend
- indices
- queries quentes
- polling e jobs de background
- headers adequados para cache onde for seguro
- parametros operacionais de sessao

### Fora de escopo inicial
- refactor completo de arquitetura
- troca de stack
- CDN externa obrigatoria
- tuning prematuro sem evidencia minima

## Frentes recomendadas
### 1. Cache de interface e dados
#### Objetivo
Melhorar tempo percebido de navegacao e reduzir fetch redundante.

#### Recomendacoes
- usar cache curto em telas administrativas de leitura, com invalidação por acao de escrita
- manter dados criticos de sessao, auth e terminal sem cache agressivo
- aplicar `stale-while-revalidate` em listas administrativas quando fizer sentido
- evitar cache persistente de respostas sensiveis de usuario sem estrategia clara

#### Politicas sugeridas
- `settings`, `features`, `integrations`: cache curto em memoria no frontend
- listagens admin: cache por filtro/pagina com TTL curto
- detalhes de auditoria: reuso local temporario, invalidação ao reprocessar ou vincular ticket
- terminal, sessoes ativas, auth refresh: sempre frescos

#### Observacao
Se a plataforma so voltou ao normal apos hard reload, isso sugere problema de versao de assets ou estado stale demais no cliente. Nao e boa estrategia depender de limpeza manual de cache.

### 2. Sessao expirada e renovacao
#### Objetivo
Melhorar previsibilidade quando JWT/refresh/session expiram.

#### Recomendacoes
- parametrizar claramente tempos de `access token`, `refresh token` e expiracao de sessao web
- exibir mensagem clara quando refresh falhar
- redirecionar de forma controlada para login
- preservar rota de retorno quando fizer sentido

#### Melhor abordagem que hard reload forçado
- tratar `401` e `chunk load error` com recuperacao guiada
- recarregar a aplicacao apenas quando detectar versao invalida de bundle
- usar versionamento de assets e invalidação por build
- opcional: endpoint leve de `app version` para detectar mismatch entre frontend carregado e backend atual

### 3. Reload e invalidacao de assets
#### Problema observado
Em alguns casos, a pagina so carregou corretamente apos reload manual com cache limpo.

#### Hipoteses provaveis
- frontend com bundle antigo apos mudancas
- chunk stale em runtime
- estado local persistido incompatível com o build atual

#### Recomendacoes
- tratar `Failed to fetch dynamically imported module` / `ChunkLoadError`
- exibir alerta de nova versao disponivel
- oferecer `reload` guiado ao inves de depender de limpeza manual
- so usar `location.reload()` forçado em erro de versao comprovado

### 4. Indices no banco
#### Objetivo
Reduzir latencia de consultas quentes sem alterar modelo funcional.

#### Candidatos naturais para revisao
- `sessions(active, user_id)`
- `sessions(active)` com joins por tenant
- `session_audits(tenant_id, started_at desc)`
- `session_audits(tenant_id, ticket_key)`
- `session_audits(tenant_id, status)`
- `session_audit_ai_jobs(status, kind, created_at)`
- `integrations(tenant_id, provider)` se ainda nao estiver coberto de forma ideal
- tabelas de policy e relacionamentos por tenant/user/group

#### Regra
- validar com queries reais e `EXPLAIN`
- nao adicionar indice apenas por intuicao

### 5. Tuning de backend
#### Recomendacoes
- reduzir logs muito verbosos em polling e jobs de background
- revisar polling de worker para evitar carga desnecessaria
- consolidar queries repetidas em algumas telas
- revisar tempo de idle e reaproveitamento de recursos no web access
- revisar headers `Cache-Control` de assets estaticos e respostas dinamicas

### 6. Tuning de frontend
#### Recomendacoes
- evitar fetch duplicado em mounts concorrentes
- reaproveitar resultados de `settings`, `features` e integrações
- lazy-load controlado para telas admin menos frequentes
- reduzir watchers e refreshs automáticos desnecessarios
- tratar melhor estados de loading para reduzir sensação de travamento

## Ordem de implementacao recomendada
1. medir telas e endpoints mais lentos
2. corrigir expiracao de sessao e invalidação de assets
3. cache curto no frontend para configs/listagens
4. revisar e adicionar indices com `EXPLAIN`
5. reduzir polling/logs de background
6. ajustes finos em web access, auditoria e integrações

## Entregaveis esperados
### Fase 1
- mapeamento de endpoints e telas quentes
- proposta de TTL por tipo de dado
- politica de expiracao de sessao documentada
- tratamento de bundle stale e reload guiado

#### Status atual
- cache curto no frontend para `settings`, `features` e `integrations`
- limpeza desses caches quando a sessão expira
- tratamento de `ChunkLoadError` com reload controlado
- polling e logs de background reduzidos
- intervalos de worker/sync parametrizados por `.env`
- `prisma:query` passou a ser opt-in por `PRISMA_LOG_QUERIES`

### Fase 2
- indices aprovados e aplicados
- cache seletivo no frontend
- queda de chamadas redundantes

#### Status atual
- índices compostos adicionados para `users`, `hosts`, `sessions`, `session_audits`, `session_audit_ai_jobs`, `auth_logs` e `admin_logs`
- histórico do Prisma destravado mantendo o banco local
- schema e migrations alinhados com o primeiro corte de tuning de banco

### Fase 3
- dashboard simples de tempos e erros mais frequentes
- tuning continuo por dominio

## Medidas de sucesso
- menor tempo medio de carregamento nas telas admin principais
- menor quantidade de hard reload manual necessario
- menor volume de chamadas repetidas para os mesmos dados
- menor latencia em consultas de auditoria, integracoes e sessoes
- expiracao de sessao com comportamento previsivel

## Abordagens sugeridas adicionais
- criar uma pequena matriz de dados:
  - dado critico e sempre fresco
  - dado semi-estatico com TTL curto
  - asset versionado com cache forte
- adicionar telemetria minima de:
  - tempo de resposta por rota
  - erro de refresh/auth
  - erro de chunk load
  - tempo medio de carregamento por tela

## Proximos passos recomendados
1. PRD tecnico de tuning por camada
2. inventario de queries e telas mais usadas
3. proposta de indices com `EXPLAIN`
4. estrategia de sessao expirada e stale assets
5. backlog incremental de tuning sem quebra funcional
