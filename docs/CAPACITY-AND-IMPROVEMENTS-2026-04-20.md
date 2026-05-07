# Capacidade, melhorias recentes e recomendacao de hardware

Data: 2026-04-20

## Escopo

Este documento consolida as melhorias recentes no fluxo SSH/auditoria e os resultados de carga obtidos com o ambiente local de teste.

Os testes usam:

- gateway SSH WebSocket do NodeAccess;
- mock SSH local em `127.0.0.1:2222`;
- tenant `loadtest`;
- auditoria de sessao habilitada;
- metricas Prometheus habilitadas;
- cache Redis da politica de auditoria;
- armazenamento de chunks de auditoria com gzip.

Importante: os numeros abaixo sao bons para dimensionamento inicial e comparacao entre mudancas, mas ainda nao substituem benchmark em ambiente produtivo com rede, banco, Redis e storage reais.

## Status da fase 1

Status: **concluida como baseline aprovado**.

A fase 1 teve como objetivo validar se o NodeAccess consegue sustentar o alvo inicial de ate 300 sessoes SSH simultaneas em onda curta, com auditoria de sessao, cache da politica e metricas internas habilitadas.

Criterios atendidos:

- 100 sessoes simultaneas com zero falhas;
- 300 sessoes simultaneas com zero falhas;
- auditoria habilitada durante a carga;
- cache Redis da politica ativo e mensurado;
- compressao gzip dos chunks ativa e mensurada;
- relatorios JSON gerados em `tools/load-tests/reports/`;
- documento de capacidade e hardware criado para orientar o proximo ciclo.

Decisao:

- considerar a fase 1 encerrada;
- usar os resultados abaixo como baseline inicial;
- tratar novos testes longos, separacao de recursos e cenarios de producao como fase 2.

## Melhorias recentes

### 1. Cache Redis da politica de auditoria

A decisao "esta sessao deve ser auditada?" agora usa cache Redis curto por tenant.

- TTL padrao: `SESSION_AUDIT_POLICY_CACHE_TTL_SECONDS=30`
- chave por tenant: `nodeaccess:session-audit-policy:{tenantId}:v1`
- invalidacao ao salvar politica
- metodo interno pronto para futura limpeza manual
- exposicao do status do cache na tela de Configuracoes
- metricas:
  - `nodeaccess_session_audit_policy_cache_hits_total`
  - `nodeaccess_session_audit_policy_cache_misses_total`
  - `nodeaccess_session_audit_policy_cache_errors_total`

Ganho esperado:

- reduz leitura no banco durante abertura massiva de sessoes SSH;
- melhora previsibilidade em picos de conexao;
- prepara futura tela para ajuste de TTL e limpeza manual.

### 2. Compressao gzip dos chunks de auditoria

Os chunks de auditoria passaram a ser gravados em gzip.

Ganho observado na onda de 300 sessoes:

- bytes brutos de auditoria: `71.361.924`
- bytes comprimidos: `2.393.831`
- tamanho comprimido equivalente: cerca de `3,35%` do bruto
- reducao aproximada: `96,65%`

Impacto:

- reduz uso de disco;
- reduz custo de leitura/exportacao futura;
- reduz pressao de I/O em auditorias com muito output.

### 3. Metricas internas do gateway e auditoria

Foram adicionadas metricas Prometheus para:

- sessoes SSH iniciadas;
- conexoes SSH ativas;
- duracao de conexao SSH;
- chunks de auditoria;
- bytes brutos e comprimidos;
- duracao de flush dos chunks;
- sessoes com buffer de auditoria;
- hit/miss/error do cache da politica.

Ganho:

- facilita correlacionar carga, latencia e comportamento interno;
- permite detectar gargalo antes de virar erro de usuario;
- melhora reproducibilidade dos testes.

### 4. Redacao defensiva de tokens nos logs

O logging HTTP foi ajustado para evitar vazamento de tokens em URL, headers e cookies.

Ganho:

- reduz risco operacional em logs de gateway/API;
- melhora seguranca durante testes de carga com JWTs temporarios;
- protege melhor cenarios de WebSocket com query string.

### 5. Runner de carga com correlacao de maquina e metricas

O script `tools/load-tests/scripts/run-gateway-with-metrics.js` agora consolida:

- resumo do teste WebSocket;
- CPU/memoria da maquina;
- snapshots Prometheus;
- deltas de metricas internas;
- deltas de cache da politica.

Ganho:

- cada execucao gera um JSON reproduzivel em `tools/load-tests/reports/`;
- facilita comparar ondas de 100, 200 e 300 sessoes;
- reduz analise manual.

## Resultados consolidados

### Onda curta: 100 sessoes

Relatorio:

`tools/load-tests/reports/gateway-load-2026-04-20T14-30-06-951Z.json`

| Metrica | Resultado |
|---|---:|
| Concorrencia | 100 |
| Conectadas | 100 |
| Falhas | 0 |
| Comandos enviados | 604 |
| Bytes recebidos pelo cliente | 17.605.400 |
| p95 conexao | 627 ms |
| p95 primeiro output | 627 ms |
| CPU media | 2,6% |
| CPU pico | 12,5% |
| Memoria usada max. da maquina | 4.717 MB |
| Cache hits | 99 |
| Cache misses | 1 |
| Cache errors | 0 |
| Chunks de auditoria | 303 |
| Auditoria bruta | 23.927.502 bytes |
| Auditoria comprimida | 802.446 bytes |

Leitura:

- teste passou limpo;
- cache teve comportamento esperado: 1 miss inicial e 99 hits;
- compressao manteve auditoria em cerca de 3,35% do tamanho bruto.

### Onda curta: 300 sessoes

Relatorio:

`tools/load-tests/reports/gateway-load-2026-04-20T14-42-09-236Z.json`

| Metrica | Resultado |
|---|---:|
| Concorrencia | 300 |
| Conectadas | 300 |
| Falhas | 0 |
| Comandos enviados | 1.801 |
| Bytes recebidos pelo cliente | 52.816.200 |
| p95 conexao | 652 ms |
| p95 primeiro output | 652 ms |
| CPU media | 4,4% |
| CPU pico | 16,6% |
| Memoria usada max. da maquina | 5.142 MB |
| Cache hits | 297 |
| Cache misses | 3 |
| Cache errors | 0 |
| Chunks de auditoria | 900 |
| Auditoria bruta | 71.361.924 bytes |
| Auditoria comprimida | 2.393.831 bytes |

Leitura:

- teste passou limpo no alvo de 300 sessoes;
- cache teve 99% de hit rate;
- nenhuma falha de cache foi registrada;
- p95 ficou estavel, com pequena degradacao entre 100 e 300 sessoes;
- CPU ficou baixa no ambiente local, indicando que o gargalo real em producao tende a ser rede, banco, storage, bastions ou hosts de destino antes do processo Node em si.

## Comparacao resumida

| Cenario | Conectadas | Falhas | p95 conexao | CPU media | CPU pico | Cache hit rate |
|---|---:|---:|---:|---:|---:|---:|
| 100 sessoes | 100 | 0 | 627 ms | 2,6% | 12,5% | 99% |
| 300 sessoes | 300 | 0 | 652 ms | 4,4% | 16,6% | 99% |

## Ganhos observados

### Estabilidade

O gateway sustentou 300 sessoes simultaneas auditadas com zero falhas na onda curta validada.

### Latencia

A latencia p95 de conexao saiu de 627 ms em 100 sessoes para 652 ms em 300 sessoes. A degradacao foi pequena para o aumento de 3x na concorrencia.

### Banco de dados

O cache da politica remove a necessidade de consultar a politica no banco para cada nova sessao dentro do TTL.

Na onda de 300 sessoes:

- sem cache, seriam esperadas ate 300 leituras de politica;
- com cache, houve 3 misses e 297 hits;
- reducao observada de leituras efetivas: cerca de 99%.

### Storage de auditoria

A compressao gzip teve ganho expressivo.

Na onda de 300 sessoes:

- bruto: 71,36 MB;
- comprimido: 2,39 MB;
- economia aproximada: 68,97 MB em apenas 60s de teste.

Em ambiente com alto volume de output, esse ganho e relevante para custo, backup, retencao e I/O.

## Recomendacao de hardware

As recomendacoes abaixo assumem:

- ate 300 sessoes SSH simultaneas;
- auditoria habilitada;
- compressao gzip habilitada;
- cache Redis habilitado;
- margem operacional para picos;
- banco MySQL e Redis com baixa latencia;
- storage SSD/NVMe.

### Cenario A: tudo em uma maquina

Indicado para ambiente pequeno, piloto, homologacao ou producao inicial controlada.

| Carga alvo | vCPU | RAM | Disco | Observacao |
|---|---:|---:|---:|---|
| Ate 100 sessoes | 4 vCPU | 8 GB | 100 GB SSD/NVMe | Suficiente para API, gateway, MySQL e Redis com folga moderada. |
| Ate 200 sessoes | 6 vCPU | 16 GB | 150 GB SSD/NVMe | Melhor equilibrio para operacao unica com auditoria. |
| Ate 300 sessoes | 8 vCPU | 24 a 32 GB | 200 GB+ NVMe | Recomendado para margem, MySQL local, Redis local e retencao de auditoria. |

Configuracao recomendada para 300 sessoes em single-node:

- 8 vCPU;
- 32 GB RAM;
- NVMe;
- MySQL no mesmo host com limite de conexoes ajustado;
- Redis local;
- backup/retencao de auditoria dimensionados pelo volume real;
- monitoramento de CPU, memoria, conexoes MySQL, Redis, disco e latencia dos bastions.

Risco do single-node:

- banco, Redis, API, gateway e storage competem pelos mesmos recursos;
- manutencao ou falha derruba tudo;
- crescimento de auditoria pode pressionar disco e I/O;
- menos margem para picos de output pesado.

### Cenario B: recursos separados

Indicado para producao com maior previsibilidade e crescimento.

#### Gateway SSH

| Carga por instancia | vCPU | RAM | Observacao |
|---|---:|---:|---|
| Ate 150 sessoes | 2 a 4 vCPU | 4 a 8 GB | Bom para escala horizontal. |
| Ate 300 sessoes | 4 a 6 vCPU | 8 a 12 GB | Recomendado por instancia se API/DB/Redis estiverem fora. |

Recomendacao:

- manter gateway separado da API quando possivel;
- escalar horizontalmente por afinidade/sticky session ou roteamento consistente de WebSocket;
- monitorar conexoes ativas, p95 de conexao, memoria e backpressure.

#### API

| Carga | vCPU | RAM | Observacao |
|---|---:|---:|---|
| Ate 300 usuarios/sessoes | 2 a 4 vCPU | 4 a 8 GB | API tende a ser menos pressionada que gateway em sessoes SSH longas. |

#### MySQL

| Carga | vCPU | RAM | Disco |
|---|---:|---:|---:|
| Ate 300 sessoes com auditoria | 4 vCPU | 16 GB | NVMe |

Recomendacao:

- manter pool de conexoes controlado;
- monitorar queries de auditoria, sessoes, hosts e politicas;
- avaliar particionamento/retencao de auditoria conforme volume real.

#### Redis

| Carga | vCPU | RAM | Observacao |
|---|---:|---:|---|
| Cache e sessoes auxiliares | 1 a 2 vCPU | 2 a 4 GB | Baixa latencia e persistencia conforme politica operacional. |

#### Storage de auditoria

Recomendacao inicial:

- NVMe local ou volume de baixa latencia;
- separar storage de auditoria quando o volume crescer;
- definir retencao por tenant;
- considerar object storage no futuro para arquivos antigos.

## Arquiteturas recomendadas

### Inicial robusta

- 1 maquina para API + gateway;
- 1 maquina para MySQL;
- 1 Redis gerenciado ou separado;
- storage NVMe para auditoria.

Uso recomendado:

- ate 300 sessoes com margem melhor que single-node;
- bom equilibrio entre simplicidade e isolamento.

### Producao escalavel

- N instancias de gateway SSH;
- API separada;
- MySQL dedicado;
- Redis dedicado;
- storage de auditoria separado ou object storage;
- observabilidade centralizada.

Uso recomendado:

- mais de 300 sessoes;
- multiplos tenants com auditoria intensa;
- necessidade de manutencao sem indisponibilidade total.

## Fase 2 recomendada

A fase 2 deve aproximar o teste de um ambiente produtivo e validar duracao, separacao de recursos e gargalos externos ao processo Node.

Escopo sugerido:

1. Repetir 300 sessoes por 15 minutos com cache ativo.
2. Rodar 300 sessoes com perfil `heavy-output`.
3. Medir MySQL separadamente: conexoes, slow queries e I/O.
4. Medir Redis: latencia, hits, misses e erros.
5. Testar alteracao de politica durante carga para validar invalidacao do cache.
6. Testar gateway separado da API.
7. Testar MySQL e Redis em hosts separados.
8. Definir retencao de auditoria por tenant e simular crescimento de disco.
9. Reduzir logs `DEBUG` durante carga para evitar ruido e possivel gargalo de I/O em producao.

Criterios sugeridos para encerrar a fase 2:

- 300 sessoes por 15 minutos com zero falhas ou erro dentro do limite definido;
- p95 de conexao sem degradacao progressiva;
- memoria sem crescimento continuo ate o fim do teste;
- Redis sem erros de cache;
- MySQL sem saturacao de conexoes ou slow queries recorrentes;
- storage de auditoria com I/O estavel;
- recomendacao final de topologia validada: single-node, recursos separados ou gateway escalado.

## Conclusao

Com as melhorias recentes, o NodeAccess atingiu o alvo de 300 sessoes simultaneas auditadas em onda curta, com zero falhas, p95 proximo de 652 ms, cache de politica com 99% de hit rate e compressao de auditoria reduzindo o volume gravado em cerca de 96,65%.

Para producao inicial ate 300 sessoes, a recomendacao conservadora e:

- single-node: 8 vCPU, 32 GB RAM e NVMe;
- separado: gateway 4 a 6 vCPU/8 a 12 GB, API 2 a 4 vCPU/4 a 8 GB, MySQL 4 vCPU/16 GB/NVMe, Redis 1 a 2 vCPU/2 a 4 GB.

O caminho mais seguro para evolucao e repetir o teste sustentado de 15 minutos com cache ativo e, em seguida, validar banco/Redis separados.

A fase 1 esta encerrada como baseline aprovado. A partir deste ponto, novas validacoes de carga devem ser registradas como fase 2.
