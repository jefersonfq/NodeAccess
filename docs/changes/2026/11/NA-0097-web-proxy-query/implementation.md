# NA-0097 — Registro de implementação

## Pedido e objetivo

Corrigir perda de query, fragmento e token em links reescritos, descoberta durante a validação autorizada das quatro pendências SonarQube.

## Implementação

SHA base: 155405123 (NA-0096). Branch `fix/NA-0097-20261103-web-proxy-query`. Alterados somente `web-access.service.ts` e seu teste, além da documentação.

A montagem de URL acrescentava ?token ao caminho já contendo query ou fragmento. Separados caminho/query/fragmento, atualizado o parâmetro reservado token com URLSearchParams e remontada a URL. Mesma correção aplicada ao script de compatibilidade inserido no HTML.

## Validação

Ran: quatro testes regressivos falharam antes da correção do servidor, enquanto os 31 anteriores passavam. Após isso, um teste adicional reproduziu o problema no script dinâmico e passou com a correção correspondente.

Ran: 36 testes dirigidos aprovados; cobertura 192/198 linhas (96,96%), 40/42 funções (95,23%), 103/123 branches (83,73%). O teste opt-in Chromium elevou a execução a 37 testes aprovados, sem pageerror, verificando parâmetros repetidos, token único e resposta. Captura do laboratório inspecionada visualmente: `browser-lab.png`. Não é captura de uma tela do produto nem prova de acesso SSH real.

Ran: lint e typecheck backend aprovados. Revisão independente reproduziu 36 testes e não encontrou regressão bloqueante. O navegador foi executado depois como validação complementar. Primeira captura revelou charset ausente na fixture; corrigido com meta UTF-8 e assertiva de título, sem alteração de produto.

Limites: URLSearchParams normaliza encoding preservando valores. HTML com entidades nos separadores, como &amp;, tem comportamento prévio ainda não resolvido por este lote; demanda própria para parsing/escape de atributos, sem aplicar decoder a CSS ou Location. Não alegar suporte completo a todos os documentos HTML.

Reprodução do navegador: `RUN_WEB_PROXY_BROWSER=1 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=<chromium> WEB_PROXY_SCREENSHOT=<arquivo.png> npx vitest run apps/backend/src/modules/web-access/web-access.service.test.ts`.

## Recuperação

Reverter patch de montagem de URL e script dinâmico. Sem migração, instalação ou alteração de autorização/transporte.

## Pendências

Consolidar na NA-0093, executar Sonar e homologar comportamento antes de merge. Parsing de entidades HTML é melhoria relacionada registrada, fora deste ajuste pontual de query/fragmento.

## Diário de interações

### 2026-11-03T16:22:00-03:00 — Investigação do proxy

Criada frente isolada para demonstrar falha antes de corrigir. Os testes confirmaram a causa identificada.

### 2026-11-03T19:31:04+00:00 — Correção e validação

Corrigidos helper e script dinâmico. Testes, revisão independente, lint/typecheck e ensaio Chromium executados. Preservado limite de escopo para entidades HTML; próximo passo é integração e gates globais.

### 2026-11-03T20:09:34+00:00 — Tipagem do fixture Chromium

Lint integrado encontrou acesso DOM sem tipos no tsconfig backend. Adicionado contrato estrutural apenas no callback do teste; produto intacto. Ran: ESLint focal PASS e 37 testes incluindo Chromium real PASS (/tmp/na0097-final-tests.log). Próximo passo integrar a correção de teste na NA-0093.
