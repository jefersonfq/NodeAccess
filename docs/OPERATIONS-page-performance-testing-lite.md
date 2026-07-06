# Operations - Teste de Performance de Paginas

## Objetivo

Padronizar como medir carregamento de paginas do NodeAccess usando navegador real, tempos de API, payloads, renderizacao e comportamento percebido.

Use este procedimento antes/depois de mudancas que possam afetar:

- telas com listas grandes;
- dashboards;
- mapas em tempo real;
- telas administrativas;
- filtros, sidebar, cards ou tabelas;
- polling, cache ou chamadas paralelas;
- alteracoes em queries, indices ou payloads.

## Principio

Medir com navegador real sempre que o problema envolver UX percebida.

`EXPLAIN`, logs de API e tempo de banco ajudam, mas nao substituem:

- tempo ate primeira renderizacao util;
- quantidade de requests;
- peso dos payloads;
- renderizacao da lista/tabela;
- skeleton/loading ainda visivel;
- chamadas duplicadas no boot da pagina.

## Quando Rodar

Rodar este teste em pelo menos estes casos:

- antes de otimizar uma tela;
- depois de otimizar uma tela;
- antes de adicionar hierarquia, agrupamento ou filtros em listas;
- quando houver relato de loading perceptivel;
- quando a massa de dados puder chegar a 3k, 5k ou mais registros;
- antes de aceitar mudanca que adiciona polling ou novos endpoints no `onMounted`.

## Metricas Minimas

Para cada pagina testada, registrar:

- URL testada;
- volume de dados;
- modo de exibicao relevante, exemplo: lista/cards;
- tempo de navegacao do browser;
- tempo de `DOMContentLoaded`;
- tempo de `load`;
- endpoints chamados;
- duracao por endpoint;
- status HTTP por endpoint;
- payload por endpoint;
- quantidade de linhas/cards renderizados;
- skeleton/loading ainda visivel apos janela de espera;
- chamadas duplicadas ou inesperadas;
- erros de console/rede.

## Padrao de Cenario

### Baseline

Medir com a massa atual do ambiente.

Exemplo:

- 800 hosts;
- 180 grupos;
- poucos links/tags;
- usuario admin;
- pagina `/hosts`;
- modo lista.

### Escala Simulada

Criar massa temporaria e identificavel.

Regra obrigatoria:

- usar prefixo claro, exemplo `PERF_TEST_`;
- registrar volume antes/depois;
- limpar ao final;
- validar que nao sobrou massa temporaria.

Exemplo de validacao:

```sql
SELECT COUNT(*) AS remaining_perf_hosts
FROM hosts
WHERE name LIKE 'PERF_TEST_%';
```

O resultado esperado apos limpeza e `0`.

## Procedimento com Chromium Headless

Usar Chromium real com DevTools Protocol quando Playwright/Puppeteer nao estiverem instalados.

Fluxo:

1. Confirmar que API e frontend estao rodando.
2. Abrir Chromium headless com `--remote-debugging-port`.
3. Injetar token local de dev no `localStorage`.
4. Navegar para a pagina alvo.
5. Coletar recursos via Performance API e Network CDP.
6. Esperar uma janela fixa apos carregamento, normalmente 2,5s a 5s.
7. Registrar recursos de API, linhas/cards renderizados e skeletons.
8. Repetir com massa maior.
9. Limpar massa temporaria.

Flags recomendadas:

```bash
chromium \
  --headless=new \
  --remote-debugging-port=9226 \
  --user-data-dir=/tmp/nodeaccess-page-perf \
  --disable-gpu \
  --disable-dev-shm-usage \
  --no-sandbox \
  --no-first-run \
  --no-default-browser-check \
  --window-size=1440,1000 \
  about:blank
```

Observacao:

- `--no-sandbox` pode ser necessario quando o teste roda como root no ambiente de automacao.
- usar perfil temporario por execucao evita cache/localStorage contaminado.

## Coleta no Browser

Dentro da pagina, coletar:

```js
const nav = performance.getEntriesByType('navigation')[0]
const resources = performance.getEntriesByType('resource')
  .filter((r) => r.name.includes('/api/v1/'))
  .map((r) => ({
    name: r.name,
    startTime: Math.round(r.startTime),
    duration: Math.round(r.duration),
    transferSize: r.transferSize || 0,
    encodedBodySize: r.encodedBodySize || 0,
  }))

const rows = document.querySelectorAll('[data-host-id]').length
```

Para telas sem `data-host-id`, definir um seletor estavel antes de medir.

## Template de Resultado

Usar este formato no fechamento da analise:

```md
Pagina: /hosts
Modo: lista
Ambiente: dev local
Janela pos-load: 3s

| Volume | Endpoint principal | Payload | Itens renderizados | Observacao |
|---:|---:|---:|---:|---|
| 815 | /hosts?page=1&limit=40 em 109ms | 23KB | 40 | baseline |
| 3.015 | /hosts?page=1&limit=40 em 58ms | 23KB | 40 | massa temporaria |
| 5.015 | /hosts?page=1&limit=40 em 48ms | 23KB | 40 | massa temporaria |

Achados:
- listagem principal escala bem por paginacao;
- payload nao cresce com total de registros;
- loading percebido vem de chamadas paralelas/inicializacao;
- investigar chamadas duplicadas de X.

Limpeza:
- PERF_TEST_* restantes: 0.
```

## Interpretacao

### Bom sinal

- endpoint paginado mantem payload constante;
- numero de DOM nodes renderizados fica limitado;
- `DOMContentLoaded` e `load` nao crescem com volume total;
- endpoints principais ficam abaixo de 200ms em dev local;
- nao ha chamadas duplicadas no boot.

### Sinal de alerta

- payload cresce junto com total de registros;
- tela renderiza todos os itens em vez de pagina atual;
- skeleton permanece apos endpoints concluirem;
- chamadas de polling disparam antes da primeira renderizacao util;
- mesmo endpoint aparece duplicado no primeiro segundo;
- sidebar depende de listagem completa para montar contadores;
- `POST` de telemetria/produtividade falha e aparece no caminho critico.

## Regras para Massa Temporaria

Massa de teste deve ser:

- identificavel por prefixo;
- criada em lote;
- sem credenciais reais;
- preferencialmente `GLOBAL` ou em grupo dedicado de teste;
- removida no final;
- validada com contagem de sobra.

Nao usar:

- nomes reais de clientes;
- IPs reais sensiveis;
- senhas, PEM ou segredos;
- massa que altere auditoria ou sessoes reais.

## SLA Inicial Sugerido para Telas de Lista

Em ambiente dev local, como referencia inicial:

- endpoint principal paginado: ate 200ms;
- payload da pagina: ate 100KB;
- primeira renderizacao util: ate 1,5s;
- tela estabilizada: ate 3s;
- zero chamadas duplicadas desnecessarias no boot;
- zero massa temporaria restante apos o teste.

Esses numeros nao sao contrato de producao. Servem como baseline para comparar antes/depois no mesmo ambiente.

## Backlog Padrao quando Houver Regressao

Classificar o achado em uma das frentes:

- Query/indice;
- Payload;
- Renderizacao;
- Polling;
- Cache;
- Estado/loading;
- Chamada duplicada;
- Telemetria no caminho critico.

Cada item deve ter:

- evidencia do teste;
- impacto percebido;
- arquivo/endpoint suspeito;
- proposta de menor correcao;
- validacao esperada.
