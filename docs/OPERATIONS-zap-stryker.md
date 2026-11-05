# ZAP e StrykerJS no NodeAccess

Frente: [NA-0170](changes/2026/11/NA-0170-zap-stryker/plan.md). Ferramentas executadas localmente; validação de publicação em andamento. O gate ZAP identificou um alerta médio real e permanece bloqueado. Resultados e limites em [test-results.md](changes/2026/11/NA-0170-zap-stryker/test-results.md).

## Quando executar

Use ZAP para observar respostas da aplicação em execução e Stryker para medir se os testes detectam alterações de comportamento. São controles complementares ao SonarQube, aos testes de regressão e à análise de dependências/imagens. Não substituem revisão de permissões ou pentest.

Os comandos trabalham em laboratório local, com dados sintéticos. O fluxo normal do usuário não executa scanner, mutações ou sondagens. Requisitos: Node24 compatível com o projeto, npm12, dependências do lockfile e Docker para ZAP. A instalação de Stryker é somente de desenvolvimento.

## ZAP

```bash
npm ci
npm run db:generate -w apps/backend
npm run build -w packages/shared
npm run test:zap:contracts
RUN_ZAP_REAL=true npm run security:zap
```

O comando constrói a aplicação atual e prepara recursos próprios para frontend, API, MySQL, Redis e ZAP. O tráfego sintético inclui autenticação e consultas selecionadas. A versão fixada é ZAP 2.17.0, por digest oficial. O scanner é passivo: não realiza uma varredura ativa genérica nem aceita apontar o comando padrão para uma VPS. Rotas e estados efetivamente observados devem ser conferidos no resumo; não se presume cobertura de todas as telas, APIs ou permissões.

O gate recusa achados High/Medium não revisados, relatório inválido/vazio e falhas de execução. Uma revisão deve identificar a regra e o contexto exatos, evidência e prazo. Nunca adicionar IGNORE global ou chamar timeout de aprovação. Avisos de menor severidade continuam visíveis para triagem.

Resumo sanitizado: `artifacts/security/zap/summary.json`. Não publicar sessões ZAP, corpos de respostas, Authorization, cookies ou credenciais. Recursos descartáveis são removidos ao terminar; uma interrupção deve ser diagnosticada antes de remover qualquer container alheio.

## StrykerJS

```bash
npm ci
npm run test:mutation:contracts
npm run test:mutation
```

Escopo inicial: políticas de autenticação e de ações MCP. O comando gera alterações temporárias em sandbox, executa os testes relacionados e mede quais alterações foram detectadas. Não modifica as fontes originais. O limiar inicial é de 80% global e por módulo, com dois workers e limite de 15 minutos. A versão instalada é StrykerJS 10.1.1, com Vitest 4.1.12. Relatório vazio ou execução incompleta não é resultado verde.

Confira mutantes sobreviventes e sem cobertura. Acrescente testes de comportamento quando houver uma lacuna real; registre equivalências justificadas. Não reduza o limiar ou exclua operadores/arquivos para esconder sobreviventes. A nota vale somente para os módulos selecionados, não para todo o produto.

Resumo: `artifacts/mutation/summary.json`. Relatórios detalhados locais: `artifacts/mutation/mutation.json` e `mutation.html`; podem conter fontes. Somente o resumo é publicado pelo CI.

## CI e custo

O workflow `security-assurance.yml` executa jobs separados de ZAP e mutação em pull requests e sob demanda. Execuções anteriores da mesma referência são canceladas quando um novo candidato é publicado. Há limites de tempo e escopo; não é feita mutação do monorepo inteiro. Os jobs não alteram os requisitos existentes do Sonar ou os rulesets do GitHub.

Durante desenvolvimento, execute contratos e testes dos arquivos alterados; no candidato final, execute os controles aplicáveis e confira os checks do SHA atual. Leia primeiro os resumos pequenos; abra relatórios completos somente para investigar achados. Não reutilize um resultado antigo como evidência de uma alteração nova.

## Evolução e recuperação

Ampliar o conjunto de rotas ZAP e módulos de mutação por risco e evidência. Varredura ativa, equipamentos reais e produção exigem plano próprio. Reverter esta frente remove ferramentas/configuração sem migrations ou alteração de dados de usuários. Mantenha o README atualizado ao mudar versões, comandos ou escopo.

## Fontes oficiais

- [ZAP Automation Framework](https://www.zaproxy.org/docs/automate/automation-framework/)
- [ZAP análise passiva/baseline](https://www.zaproxy.org/docs/docker/baseline-scan/)
- [Stryker Vitest runner](https://stryker-mutator.io/docs/stryker-js/vitest-runner/)
- [Configuração StrykerJS](https://stryker-mutator.io/docs/stryker-js/configuration/)

## Primeira medição local (05/11/2026)

Stryker: 75,68% antes e 97,30% após ampliar testes comportamentais (72/74 mutantes); duas verificações redundantes MCP permanecem contabilizadas. Nenhum código de produção alterado para obter a nota. ZAP: 12 cenários, 18 mensagens e 62 regras passivas em 93 segundos,limpeza completa; gateFAIL pelo alerta 10055-6(style-src unsafe-inline), além de dois alertas baixos e quatro informativos. Não houve revisão como falso positivo nem exceção para deixar verde. O alerta CSP requer decisão de escopo por impacto em estilos da interface/editor/terminal.

A coleta Sonar inclui Stryker real e testes Python do driver sob trace. Provas exigem UUID atual, SHA/fingerprint e hashes dos relatórios/fontes; a nota declarada é reconciliada com o raw. O teste de mutação não recebe crédito de cobertura do produto a partir das fontes alteradas no sandbox. As simulações de orchestration validam falhas/limpeza; não substituem o scan real separado.
