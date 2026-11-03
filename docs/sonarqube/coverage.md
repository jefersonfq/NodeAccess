# Cobertura executável — NodeAccess

A rotina coleta cobertura real de Vitest/V8 e do runner nativo Node/V8. Requer Node 24.21+ e dependências instaladas. Não inicia SonarQube, banco de produção, VPN ou SSH real.

```sh
npm run test:coverage -- --base "$(git merge-base HEAD origin/master)"
```

Sem `--base`, a coleta aplica somente o gate legado e informa `newCoverage.status=not_requested`; não comprova o requisito de novo código. A rotina `npm run validate:sonar` usa o agregador com base explícita: `SONAR_BASE_SHA` ou, na ausência, o merge-base com `origin/master`. Os tokens de análise/leitura permanecem separados e não são enviados aos coletores.

## Três medidas distintas

| Medida | Escopo | Regra |
| --- | --- | --- |
| Legado | Mesmo glob `apps/backend/src/modules/**/*.service.ts` | Linhas ≥70%, funções ≥70%, branches ≥60% |
| Novo código | Linhas e condições executáveis adicionadas no diff Git em todas as fontes mensuráveis | `(linhas cobertas + condições cobertas) / (linhas + condições)` ≥80% |
| Global abrangente | Backend, frontend Vue, shared, agent, scripts e tools | Informativa; não substitui nem dilui os limites legados |

Fontes JS/TS/Vue inteiras entram no inventário, inclusive sem execução. Excluem-se somente testes/specs e declarações `.d.ts`. JSON importado e transformado por Vite é dado; seus mapas aparecem em `dataArtifacts`, fora do inventário executável. Python, shell e SQL não são medidos por V8/LCOV nesta rotina; não há alegação de cobertura dessas linguagens.

A comparação local inclui alterações não commitadas e fontes novas não ignoradas pelo Git. Na CI, o checkout é limpo. Linhas somente removidas não são código novo. Arquivo novo sem mapa de cobertura reprova, assim como inventário incompleto, mapa inesperado, LCOV inválido ou fonte modificada durante a coleta.

## Artefatos e interpretação

`coverage/summary.json` registra SHA base/head, timestamps, fingerprint das fontes, resultados dos coletores, limites, métricas por camada e motivos de falha. `coverage/lcov.info` e `coverage/coverage-final.json` são relatórios consolidados. Logs e ranges V8 ficam em `coverage/`; não publicar logs brutos sem revisão. A execução limpa relatórios anteriores antes de coletar.

Vitest fornece mapas TS/Vue e fontes restantes. Para arquivos JS executados pelo runner Node, o AST do código original é autoritativo: mapas transformados pelo Vite não são somados ao mapa Node, pois isso duplicaria condições incompatíveis. Crédito Vitest descartado conservadoramente fica explícito em `collectorAuthority.discardedVitestCredit`; a fonte e todos os ramos do AST original permanecem no denominador.

`ast-v8-to-istanbul@1.0.7` pode produzir hit negativo em um `else` implícito por subtração de contagens de ranges aninhados. Apenas esse caso recebe zero, sem conceder cobertura ou remover ramo. `conversionAnomalies` preserva coletor, arquivo, linha, branch, contagem original, zero normalizado e versão. Contagem não inteira e demais inconsistências reprovam. Testes reproduzem o defeito com V8 real em cópia descartável da política local de acesso.

Um Sonar verde não substitui falha de testes/cobertura. A validação normal pode analisar LCOV fresco e válido mesmo com limites reprovados, para diagnóstico; seu resultado final permanece reprovado. Pipeline incompleto, metadados antigos, fingerprint divergente ou LCOV corrompido impedem o scanner.

## Testes e limites

A rotina executa suites Vitest existentes, descobre testes Node em agent/scripts/tools e depois executa dois harnesses reais Chromium em Vite loopback isolado. Essa fase é obrigatória e qualquer falha impede aprovação. Testes de orquestração usam fixtures isoladas para provocar falhas; esses dados sintéticos não são incorporados como cobertura de produção. O crédito do projeto vem dos ranges reais dos processos que executaram seus módulos. Testes de serviços exercitam implementações reais com I/O simulado; bcrypt, crypto e armazenamento de avatar têm exercícios reais locais. Ensaios opt-in SSH/Docker/browser continuam separados e não são alegados como executados por uma coleta comum.

Os testes do próprio gate cobrem inventário completo, fontes novas, base inválida, LCOV inconsistente, falha de coletores, drift das fontes, preservação dos limites, autoridade dos mapas e rejeição de metadados antigos. O histórico factual e os resultados de cada lote estão em [NA-0090](../changes/2026/11/NA-0090-sonar-coverage/implementation.md).


## Pré-requisito browser e isolamento

Instalar o browser da dependência fixada antes da coleta em um sistema suportado:

```sh
node node_modules/playwright/cli.js install --with-deps chromium
```

A CI Ubuntu24 realiza essa instalação após `npm ci`. O WSL Ubuntu20.04 usado nesta frente não é suportado pelo Chromium1248 esperado pelo Playwright instalado; a tentativa de instalação falhou explicitamente. O ensaio local foi executado com `PLAYWRIGHT_EXECUTABLE_PATH=/root/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome` (Chrome for Testing151.0.7922.34), como override consciente do ambiente de automação. Não há downgrade da dependência nem fallback automático. Esse ensaio local não substitui a validação do browser fixado no runner GitHub.

A fase browser usa HTML sintético e componentes reais selecionados; não inicia a aplicação completa nem conecta backend, VPN ou hosts. O servidor responde404 em `/api/` e encerra no `finally`. Os dois scripts herdam ranges V8 da coleta; funções executadas exclusivamente dentro de `page.evaluate` permanecem não cobertas no Node. `coverage/browser/summary.json`, logs e cinco capturas guardam a evidência local. Requisições de módulo e subprocessos têm deadline; falhas de preparação, execução e cleanup reprovam o gate.

## Git confiável e entrada CI local

As operações Git da cobertura e da validação usam `/usr/bin/git`, com argumentos separados e sem shell. O contrato suportado é Linux/WSL e CI Ubuntu com Git instalado pelo sistema; um `git` colocado antes no `PATH` não é executado. O ambiente e a configuração Git continuam confiáveis, como o próprio checkout. Sem esse binário, a rotina falha; não há fallback automático para outro executável.

Para executar o fluxo CI completo num checkout limpo, com Node24.21+, Docker e browser preparados:

```sh
SONAR_CI_BASE=<SHA-base-completo> npm run sonar:ci
```

Execute pela entrada npm: ela fornece `npm_execpath` ao processo, inclusive quando Node e npm estão em instalações diferentes. A chamada direta ao arquivo JavaScript depende de npm adjacente ao Node e pode falhar nesse ambiente. O fluxo coleta cobertura e inicia SonarQube/PostgreSQL descartáveis para analisar base/head; os pré-requisitos e limites são distintos de `npm run test:coverage`. Não use a instância persistente como destino desse ensaio.
