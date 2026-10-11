---
change_id: NA-0053
title: Isolar chamadas privadas de destaques no terminal JIT
type: fix
status: ready-for-tests
created_at: 2026-10-10T17:00:00-03:00
base_branch: performance/NA-0052-20261009-dev-resources
base_sha: aed55fad68e5cf535f4573672ffc148951652fe7
branch: fix/NA-0053-20261010-jit-private-requests
owner: jeferson
planner: Codex
risk: medium
issue: null
---

# NA-0053 — Terminal público JIT

## Contexto e situação anterior

NA-0052 local commitado/testado; publicação, PR, merge e master continuam
pendentes de login GitHub. Base local conhecida; master rastreia origin/master.
Ressalva concreta: sharing-flows falha após PIN válido, redirecionando para login
tanto na baseline quanto no candidato. mount chama endpoint privado de destaques
antes de connect identificar token externo. Token JIT só autoriza seu destino.

## Problema e objetivo

Manter visitante no terminal autorizado pelo link e impedir consultas privadas
de preferências/telemetria em contexto JIT, inclusive com sessão de usuário no
navegador. Preservar destaques e erros de autenticação no uso normal.

## Escopo

Inicialização/ciclo de destaques no composable e testes de regressão. Revisar
ressalvas NA-0052 e preparar login GitHub no WSL como operação local separada.
Fora: produção, guacd, schema, permissões de endpoints, contratos de tokens,
transporte SSH, resize, refatoração de bundles e migração adicional de versões.

## Critérios de aceitação

- [x] PIN válido monta terminal JIT sem login nem requisições privadas.
- [x] PIN incorreto permite retry; expirado/revogado bloqueia acesso.
- [x] Invalidação de destaques e saída SSH não enviam telemetria privada no JIT.
- [x] Sessão normal conserva destaques; respostas obsoletas não contaminam contexto.
- [x] Suite compartilhamento antes/depois, unitários, terminal completo e build.
- [x] Ressalvas restantes e estado GitHub registrados sem afirmar homologação humana.

## Estratégia técnica

Carregar destaques apenas após determinar contexto em connect; negar por padrão
antes disso. Restringir invalidação/telemetria ao contexto autenticado e ignorar
respostas obsoletas. Não mudar interceptor 401 nem liberar endpoint a anônimos.

## Riscos e mitigações

Timing de inicialização e respostas concorrentes: testes de lifecycle e browser.
Mudança sem alteração de marcação, área útil, WebSocket ou transporte. Preservar
testes negativos e fluxo normal. Não imprimir credenciais no login GitHub.

## Matriz de testes e evidências

| Área | Verificação |
|---|---|
| JIT | sharing-flows-playwright em dev e build, requests allowlisted |
| Destaques | unitário do composable e terminal-experience completo |
| Regressão | typecheck/build, entry payload e manual check |
| Governança | plano, diff, SHA, revisão independente |

## Baseline

SHA aed55fad68e5cf535f4573672ffc148951652fe7, árvore limpa.
Falha reproduzida no ensaio anterior e repetida antes da correção nesta frente.
Artefatos: /home/jeferson/nodeaccess-workspace/reports/NA-0053.

## Rollback ou recuperação

Reverter somente commit NA-0053; não há migrations, deploy ou alteração de dados.
Configurações GitHub fora do repositório e sem credenciais em arquivos versionados.

## Mudanças de escopo e decisões

IN_PLAN: corrigir JIT já autorizado explicitamente pelo usuário. O warning de
vendor-ui grande e limites de benchmarks são ressalvas de medição, não falhas
que justifiquem nova refatoração. Ensaios PTY/produção e homologação humana não
serão alegados como executados. GitHub exige aprovação interativa da conta.

## Aprovação

- Decisão: GO_WITH_RISKS
- Aprovado por: usuário ao pedir revisão das ressalvas, correção JIT e login GitHub.
- Aprovado em: 2026-10-10, conversa.

NECESSARY_CORRECTION: lint do arquivo tocado apresentou os mesmos 24 erros e
40 avisos na baseline. Corrigir tipos de retorno, assertions redundantes,
payload JSON tipado como unknown e adaptação de callbacks async para void no
mesmo composable. Sem desabilitar regras ou modificar protocolo/ordem de envio.
Revalidar lint, TypeScript, unitários e harnesses após essa correção.

## Resultado local e ressalvas revisadas

- Ran: 57 suítes / 446 testes unitários do frontend, incluindo sete casos novos
  do ciclo de destaques; lint dos dois arquivos TypeScript sem erros/avisos;
  typecheck e build frontend; manual:check-reviewed.
- Ran: sharing-flows em dev e build (PIN, erro/retry, expiração/revogação,
  eventos de invalidação, nova saída SSH, ausência de HTTP privado); terminal
  completo em dev; smoke do terminal compilado; login compilado sem carregar
  vendor-terminal. O contador de saída deve aumentar após a nova mensagem.
- Baseline: sharing falhava com Successful JIT terminal triggered login.
  Lint preexistente tinha 24 erros/40 avisos, todos corrigidos neste arquivo.
- Tentativa interrompida: ERR_CONNECTION_REFUSED na porta 5173; Vite foi
  restabelecido e os ensaios repetidos. Não foi falha funcional do aplicativo.
- Revisão independente: PASS_WITH_WARNINGS sobre o diff e evidências fornecidos
  pelo implementador. O revisor não conseguiu executar ferramentas no WSL;
  não alegar execução independente. Gate depende dos checks no SHA final.
- Skipped: PTY real e produção; não houve alteração funcional do protocolo,
  transporte ou resize. Callbacks mantêm comportamento e tipos foram explicitados.
- Manual: homologação humana do JIT/terminal e revisão de release completa.

As evidências após o commit ficam em reports/NA-0053/final-summary.json, fora
do Git, com SHA, comandos, tempos, resultados e limites. Alterar o commit
exige reexecutar os checks. Publicação/PR não significam merge ou entrega.

## Ressalvas NA-0052 e acompanhamento

- Bundle vendor-ui permanece em aproximadamente 1.001 kB minificado; sua divisão
  adicional exige medição de carregamento/cache antes de uma mudança separada.
  A carga inicial continua sem baixar o renderer do terminal.
- Vite/Vitest avisam sobre compatibilidade com um futuro configLoader nativo.
  A configuração atual funciona; adaptar configuração em uma frente própria
  antes da migração major, sem ocultar o aviso por variável de ambiente.
- Benchmarks Prisma anteriores são sintéticos; a observação de memória não
  equivale a soak automatizado nem prova causal de ganho de produção.
- Smoke compilado não executa injeção por módulo /src; esses cenários são
  cobertos pela suíte completa em Vite dev.
- GitHub: login jefersonfq concluído, acesso ao repositório/fetch validados,
  origin HTTPS e helper gh configurados. Diretório gh 0700, credencial 0600.
  Token fica fora do repositório. Master remota contém merges adicionais;
  preservar a cadeia local NA-0039–NA-0052 e publicar NA-0053 sobre a branch
  NA-0052. Integração dessa cadeia e homologação continuam gates pendentes.
- Consulta remota encontrou master sem proteção. Configurar regras de PR,
  revisão e checks requer decisão separada; nenhuma configuração remota foi
  alterada por esta correção.
