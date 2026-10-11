# Auditoria: simulações operacionais e consultas na tela

## Escopo

Esta revisão amplia a validação do [TXT legível](2026-09-29-readable-audit-txt.md) com sessões sintéticas e reproduzíveis que passam pelo **processador, serviços, controladores e rotas reais da API** antes de chegar à tela Vue real no Chromium/Playwright.

A autenticação das rotas da auditoria é real, com token efêmero de laboratório. Apenas o repositório/storage e os serviços periféricos da aplicação usam dados de teste. Não há execução dos comandos do corpus em máquinas Linux ou bancos reais; os pares entrada/saída são simulados. Também não se usa o ambiente de produção nem gravações privadas nos testes de tela.

## Corpus

| Sessão | Comandos | Exemplos |
| --- | ---: | --- |
| Linux | 40 | arquivos, permissões, processos, systemd, rede, logs, Docker, Kubernetes, Git, Unicode |
| Shell scripts | 20 | pipes, aspas, variáveis, loops, condições, funções, here-doc, colagem multilinha, exit code, timeout, stderr, ANSI |
| MySQL interativo | 27 | SELECT, agregação, CTE, window function, JSON, EXPLAIN, índices, transação/rollback, SQL colado e editado, cancelamento, erros |
| Clientes de bancos | 15 | psql -c, sqlite3, redis-cli, mongosh, sqlcmd, falha de conexão e script de backup |
| PostgreSQL interativo | 8 | prompt psql, metacomandos, SQL multilinha colado, erro, cancelamento e saída |
| Carga Linux | 600 | repetição determinística do corpus Linux para paginação, busca e exportação |

São 110 comandos nos cenários funcionais e mais 600 na carga. Eventos são fragmentados de forma determinística, inclusive em escapes e texto Unicode. As entradas alternam a autoria registrada entre dois usuários; os testes de reconstrução comparam também essa autoria.

## Correção encontrada

O cenário psql expôs dois problemas:

1. O prompt padrão `reporting=>`/`reporting=#` não era reconhecido como fronteira. Uma colagem SQL multilinha ficava pendente sem a saída corretamente associada e podia ser descartada pela regra de plausibilidade.
2. Metacomandos válidos sem saída, especialmente `\q`, podiam ser descartados como entrada sem significado.

A correção em `session-audit-normalizer.ts` reconhece o prompt padrão psql e os metacomandos previstos. Prompts de continuação, como `reporting->`, não são tratados como fim de comando. O teste compara os oito comandos exatamente, incluindo SQL multilinha e `\q`.

A versão passou para **`ssh-readline-2026-09-29.2`**, preservando reconstruções anteriores pela arquitetura de versões já existente. Não houve troca do interpretador, alteração do transporte SSH ou nova migração. Para uma auditoria já aberta, “Reprocessar” permite verificar a interpretação atual e compará-la com a versão anterior.

## Validação pela interface

Resultado final: **262 testes do módulo em 11 arquivos passaram**, assim como **11 cenários de navegador**, **260 buscas por comando**, **21 buscas por saída** e **33 downloads**. Um reset de conexão foi provocado e recuperado pela nova tentativa. Typecheck do backend e lint do normalizador/teste operacional passaram. O tempo inicial de abertura observado ficou entre 1,8 e 4,5 segundos neste laboratório; não é SLA de produção.

A preparação inicial de Fastify/AJV foi movida para `beforeAll` no teste de rotas, mantendo o limite de cinco segundos das verificações individuais. Isso separa o carregamento da infraestrutura do teste de retenção após renderização, que continuou exercitando uma aplicação nova e passou.

`tools/frontend/audit-operational-playwright.cjs` faz chamadas HTTP às rotas reais servidas por `tools/session-audit/operational-api.mts`. Os comandos e os TXT **não são respostas prontas do mock do navegador**.

Para cada sessão funcional, em desktop e celular:

- Busca cada comando e compara seu texto integral no DOM, incluindo colagens multilinha.
- Pesquisa por saída, abre o bloco correspondente e confere mensagens de erro e Unicode.
- Consulta sem resultados e recuperação da lista ao limpar a busca.
- Confere os três downloads: nome, conteúdo e presença de todos os comandos esperados.
- Abre o playback, avança ao final e verifica o último comando.
- Verifica ausência de overflow horizontal e de erros JavaScript inesperados.
- Exibe uma saída com `<img ...>` como texto, sem gerar elemento HTML ou diálogo executável.

Na sessão de 600 comandos: paginação até o comando 600, no máximo 100 linhas de comandos no DOM, busca após mudança de página, exportação integral e playback até o final.

Também é simulado um reset de conexão durante o download: o erro é apresentado, a lista permanece disponível e uma nova tentativa utiliza a API real para baixar o arquivo.

## Arquivos e reprodução

- `tools/session-audit/operational-corpus.ts`: pares sintéticos e gravações JSONL em memória.
- `apps/backend/src/modules/session-audit/session-audit-operational.test.ts`: reconstrução exata, autoria, integridade, erros e formatos TXT.
- `tools/session-audit/operational-api.mts`: API restrita a localhost, sem banco ou storage de produção.
- `tools/frontend/audit-operational-playwright.cjs`: consultas e downloads na tela real.
- `session-audit-normalizer.ts` e `session-audit-reconstruction.ts`: correção localizada e versão.

```sh
# Terminal 1: aguarde a confirmação de disponibilidade antes do navegador.
npx tsx tools/session-audit/operational-api.mts
# Terminal 2: inicie o frontend de desenvolvimento na porta 5182.
cd apps/frontend
npx vite --host 127.0.0.1 --port 5182 --strictPort
# Terminal 3, na raiz:
FRONTEND_BASE=http://127.0.0.1:5182 node tools/frontend/audit-operational-playwright.cjs
# Opcional: repetir somente o PostgreSQL e salvar seu relatório separadamente.
AUDIT_SCENARIO_ID=4182 REPORT_PATH=/tmp/postgres-review.json FRONTEND_BASE=http://127.0.0.1:5182 node tools/frontend/audit-operational-playwright.cjs
AUDIT_EXPORT_REVIEW_DIR=/caminho/privado npx vitest run apps/backend/src/modules/session-audit --maxWorkers=2 --minWorkers=1
```

A API cria `/tmp/nodeaccess-operational-api.json` com token efêmero e expectativas sintéticas. Não adicionar esse arquivo ao Git. Encerre a API de teste após a execução. Evidências sanitizadas ficam em `docs/reviews/evidence/2026-09-29-audit-operational`.

## Limites

Esta bateria aumenta a cobertura; não garante compatibilidade com todos os programas, prompts personalizados, encodings ou modos de edição. O caso PostgreSQL multilinha usa colagem bracketed paste; não certifica todas as formas de digitação manual, funções com dollar quoting ou configurações personalizadas de psql. O teste também não certifica conectividade SSH, execução SQL nem desempenho dos bancos: esses caminhos exigem testes de integração próprios com hosts/bancos descartáveis.

Continuam valendo as limitações documentadas do TXT para tela cheia, corrupção já presente na captura e fontes com lacunas. A regressão das sessões privadas usa os eventos preservados da análise anterior; os bytes dos JSONL originais não estavam disponíveis. Não houve deploy em produção.
