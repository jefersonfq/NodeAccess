# Recursos do desenvolvimento local

O workspace ativo é `/home/jeferson/projects/NodeAccess-current`. Execute
`npm run dev` como seu usuário, com Node 24.21.x selecionado. O wrapper
`/home/jeferson/nodeaccess-workspace/bin/dev npm run dev` seleciona o toolchain
gerenciado neste WSL. Não execute o desenvolvimento com sudo.

## MySQL

Somente `docker-compose.yml` de desenvolvimento sobrescreve os recursos:
buffer pool 512 MiB, uma instância, redo 256 MiB, log buffer 16 MiB e
100 conexões. O arquivo comum e o compose de produção permanecem inalterados.
Flush de commit, doublewrite e demais garantias de persistência são mantidos.
Não há limite rígido de memória do container: o uso total supera o buffer pool.

Para bases locais maiores, ajuste no `.env` do compose:

```dotenv
NODEACCESS_DEV_MYSQL_BUFFER_POOL=1G
NODEACCESS_DEV_MYSQL_REDO_CAPACITY=512M
NODEACCESS_DEV_MYSQL_MAX_CONNECTIONS=150
```

Faça backup antes de aplicar `docker compose up -d --no-deps mysql`.
Isso reinicia apenas o MySQL; Redis e guacd não precisam ser recriados.

## Pool do Prisma

O launcher de `npm run dev` adiciona em memória `connection_limit=5` e
`pool_timeout=10` quando ausentes na URL. API e gateway possuem pools próprios;
dois processos ativos têm orçamento padrão de até dez conexões. Workers extras
e comandos Prisma podem abrir pools adicionais. Isso não dimensiona produção.

Parâmetros explícitos na DATABASE_URL sempre prevalecem, inclusive zero.
Sem parâmetro explícito, `NODEACCESS_DEV_DB_CONNECTION_LIMIT` aceita 1–100 e
`NODEACCESS_DEV_DB_POOL_TIMEOUT` aceita 1–300 segundos. O arquivo local prevalece
sobre o ambiente herdado. Defaults não são aplicados com NODE_ENV=production/test.
Reinicie o dev após alterar esses valores. O launcher não regrava o arquivo .env.

## Medição opt-in

```bash
RUN_DEV_RESOURCE_BENCH=1 node tools/performance/dev-db-pool.mjs before
RUN_DEV_RESOURCE_BENCH=1 node tools/performance/dev-db-pool.mjs after
```

`before` usa a URL local explícita; `after` aplica os defaults do launcher.
O harness aceita apenas banco em loopback, lê páginas de IDs de hosts sem
expor os resultados e usa dois clientes Prisma, concorrência 20/50, quatro
rodadas e dez consultas por worker. Saída: p50/p95, tempo e códigos de erro.
Não faz escrita nem substitui um teste de carga de API, ACL, SSH ou produção.
Compare condições equivalentes; descarte a primeira rodada ao avaliar aquecimento.
Não copie URLs, tokens, dumps ou payloads para os relatórios versionados.

## Carregamento

As preferências do terminal são um módulo leve compartilhado. Sincronizá-las
na entrada da aplicação não deve carregar o renderer xterm. Os exports de
`useTerminal` permanecem compatíveis. Rotas já usam imports dinâmicos.

O warmup existente foi mantido: medir inicialização antes de ampliar sua lista.
Sem evidência de gargalo de consultas, não adicionar índices nem caches.

Valide a entrada do build em Chromium com APIs simuladas, sem sessões reais:

```bash
npm run build -w apps/frontend
node tools/performance/frontend-entry.cjs
# Comparação opcional com um dist anterior preservado:
node tools/performance/frontend-entry.cjs /caminho/do/dist-anterior
```

O teste verifica o formulário inicial, ausência de exceções e ausência de download
de vendor-terminal no login. Registra bytes JS recebidos e gzip calculado por
arquivo, não latência de rede nem gzip observado em um proxy real. O relatório
padrão é `/tmp/nodeaccess-frontend-entry.json`; pode ser alterado com
`FRONTEND_ENTRY_REPORT`. `PLAYWRIGHT_EXECUTABLE_PATH` seleciona o Chromium.
