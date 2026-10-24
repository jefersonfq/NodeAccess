# NA-0057 — Evidências locais

Base/HEAD: `1755022aa2e8d884ddf295e3e2470acfdcb5ad24`, acrescido do WIP local
na branch `docs/NA-0057-20261013-mcp-onboarding-review`. Não é um SHA candidato
publicado; repetir checks ao preparar commit/PR. Sem migrations ou dependências
novas no produto. Serviços e credenciais dos testes são descartáveis.

## Matriz executada

- Ran: suites MCP backend e geradores/probe frontend: 76 testes em 7 arquivos,
  incluindo as três integrações opt-in, no Node 24.21.0 preparado em /tmp.
- Ran: HTTP real em loopback com rotas, controller, service e guards reais;
  repositório de tokens, banco, Redis e licença simulados. Cobre initialized/202,
  ping, ID preservado, versões, Accept, Origin, métodos 405, entradas inválidas,
  consultas concorrentes, capability, tenant e allowedHostIds. Repositório simula
  rejeição de tokens inválidos/expirados/revogados; não certifica persistência real.
- Ran: SDK MCP 1.27.1 conecta, descobre tools/resources/prompts, executa search_hosts
  e ping. Claude Code 2.1.296 confirma Connected com .mcp.json e configuração
  temporários. Codex CLI 0.162.0 lê configuração HTTP por override, sem escrita
  na configuração do usuário. Diretório temporário Claude é removido pelo teste. Gemini CLI 0.64.0 também
  confirma Connected e initialized com preset gerado e pasta confiável descartável.
- Ran: navegador Chromium via Playwright, desktop 1440x1000 e mobile 390x844: três
  agentes, seis combinações agente/shell, quatro cenários de probe, erro RPC,
  isError, 401, clipboard negado, foco/labels, ausência de overflow, token
  temporário, criação/retorno, criação atrasada após fechar/reabrir e troca de
  tenant via Pinia. APIs simuladas; não certifica autenticação real da troca.
- Ran: typecheck backend/frontend/shared e build frontend. Avisos de loader
  futuro Vite e chunk vendor-ui acima de 950 kB; build concluído.
- Ran: lint dos arquivos novos e services/probe frontend: zero erros/warnings.
- Ran (falhou): lint amplo dos arquivos afetados; dívida preexistente confirmada
  com git show HEAD e ESLint stdin: routes 4 erros/7 warnings; controller 0/25;
  backend service 55/26; view 2/376. Não houve supressão de regras. Esses números
  são da base, não uma alegação de lint total aprovado.
- Ran: git diff --check.
- Ran: revisão independente reproduziu bypass por espaços em method/name,
  corrigido e retestado; resultado PASS_WITH_WARNINGS no WIP.
- Skipped: sessão interativa Codex com inferência, SSH,
  banco real, produção/deploy e testes de terminal (área útil/transporte SSH
  não alterados).
- Manual: homologação humana e CI no futuro SHA; ainda não realizados.

## Reprodução

```bash
# Runtime Node 24.21+; SDK é opcional e fica fora do projeto:
npm install --prefix /tmp/nodeaccess-na0057-mcp-sdk --no-audit --no-fund @modelcontextprotocol/sdk@1.27.1
MCP_SDK_ROOT=/tmp/nodeaccess-na0057-mcp-sdk/node_modules/@modelcontextprotocol/sdk MCP_CLI_SMOKE=1 \
  npx vitest run apps/backend/src/modules/mcp apps/frontend/src/services/mcp.service.test.ts apps/frontend/src/services/mcp-agent-setup.test.ts
npm run typecheck
npm run build -w apps/frontend
# Com frontend local em execução:
FRONTEND_BASE=http://127.0.0.1:5189 npm run test:mcp-agent-onboarding:web
```

Sem variáveis opt-in, somente as três integrações SDK/CLI/Gemini são ignoradas; os
contratos HTTP permanecem na suíte normal. CLI smoke requer codex e claude no PATH. Gemini requer MCP_GEMINI_BIN apontando
para bundle/gemini.js da instalação isolada.
Vite isolado usado pelo harness foi encerrado. Artefatos locais descartáveis de
lint/build ficam em /tmp/na0057-*; decisões e resultados duráveis estão aqui.

## Refinamento UX — rodada final de 2026-10-14

Ran: 76 testes/7 suítes, nenhum skipped, com as três integrações habilitadas no
Node 24.21.0. Gemini 0.64.0 instalado em /tmp, sem mudança de dependências ou
configuração real. A primeira tentativa encontrou pasta não confiável; a fixture
passou a confiar apenas no diretório temporário e a ler stdout+stderr. O guia
agora orienta revisar o projeto antes de confiar nele; não recomenda desativar
proteções. Teste confirma initialize e notifications/initialized no backend.

Ran: matriz Chromium em 1440x1000, 768x1024 e 390x844, três agentes e seis
combinações agente/shell; cinco modos de probe (inclui consulta não executada),
clipboard negado, disclosures/menus por teclado, alvo externo sem chamadas,
resumo antigo limpo ao digitar outro token, endpoint preservado na criação e
cancelamento, reset no tenant, criação tardia, estado vazio único e limpeza
de filtros. Sem pageerror ou overflow horizontal. Vite encerrado ao concluir.

Ran: lint estrito de McpAgentSetup.vue, mcp-agent-setup.ts e mcp-http.test.ts
sem erros/warnings; typecheck completo aprovado. Build final registrado abaixo.
A dívida de lint legado descrita acima permanece; nenhuma supressão adicionada.
Revisão independente final PASS para o refinamento, limitada ao WIP.

Inspeção comparável (Codex/Bash HTTP local, viewport com 900px de altura): conteúdo
do guia inicialmente visível passou de aproximadamente 1423px para 1043px em
1440px de largura e de 2048px para 1458px em 390px. Há dois blocos de código
visíveis em vez de três; alternativa e teste opcional ficam recolhidos. Estas
são medidas de fixtures, não métricas de produção. Capturas finais:
/tmp/na0057-ux-initial-1440.png, /tmp/na0057-ux-initial-390.png e
/tmp/na0057-ux-page-1440.png, /tmp/na0057-ux-page-390.png.

Reprodução com Gemini adicional:

```bash
npm install --prefix /tmp/nodeaccess-na0057-gemini --no-audit --no-fund @google/gemini-cli@0.64.0
MCP_SDK_ROOT=/tmp/nodeaccess-na0057-mcp-sdk/node_modules/@modelcontextprotocol/sdk \
MCP_CLI_SMOKE=1 \
MCP_GEMINI_BIN=/tmp/nodeaccess-na0057-gemini/node_modules/@google/gemini-cli/bundle/gemini.js \
  npx vitest run apps/backend/src/modules/mcp apps/frontend/src/services/mcp.service.test.ts apps/frontend/src/services/mcp-agent-setup.test.ts
```

Manual: homologação humana e uso interativo com inferência; testes de listagem
de clientes não são apresentados como homologação de tarefas executadas por IA.

Build final após os últimos ajustes de UX: `npm run build -w apps/frontend`
aprovado (inclui vue-tsc), 28,73s. Permanece o aviso conhecido de vendor-ui acima
de 950 kB. Log local: /tmp/na0057-ux-final-build.log. `git diff --check` aprovado.

## Permissões compactas — 2026-10-14

Base/HEAD 1755022aa2e8d884ddf295e3e2470acfdcb5ad24 + WIP na mesma branch.
Ran: regressão frontend (mcp.service.test.ts e mcp-agent-setup.test.ts), 36 testes
em 2 arquivos aprovados. Typecheck completo backend/frontend/shared aprovado.
Build frontend incluindo vue-tsc aprovado em 29,89s; aviso conhecido vendor-ui
acima de 950 kB. Logs /tmp/na0057-permissions-typecheck.log e
/tmp/na0057-permissions-build.log. Lint dos dois novos componentes aprovado.

Escopo: apresentação de permissões e seletor compartilhado, sem alterações em
payload/defaults/backend. A lista herdada depende do ambiente; o catálogo admin
não é apresentado como acesso efetivo. Chaves sem metadados permanecem visíveis
com risco não informado. A preservação destas chaves no formulário não garante
aceitação no backend: validação de catálogo da API permanece existente.
Skipped: nova rodada de banco/SSH/terminal/CLI real (não afetados por este ajuste).
Manual: homologação humana; resultados automatizados não a substituem.

Ran: lint estrito final dos dois componentes e novo build frontend após revisão
de microcopy aprovados; build em 29,09s, mesmo aviso de chunk. Log final:
/tmp/na0057-permissions-build-final.log. Revisão independente estática PASS;
validação de navegador registrada na continuação deste documento.


Ran: matriz final Playwright PASS em 1440x1000, 768x1024 e 390x844, incluindo
guia anterior. Resumo com 22 permissões medido em 89,58px nas fixtures; shell,
alto risco, risco desconhecido e herança explícitos. Modal Enter/Escape, foco
restaurado, scroll contido, grupos por teclado, busca preservando seleção e
payloads POST/PATCH, remoção de permissões desconhecidas validados. Zero pageerror
ou overflow do documento; tabela mantém scroll horizontal próprio.
Falha inicial do harness no uncheck de item removido corrigida para clique e
asserção de ausência; nenhum teste suprimido. APIs simuladas.
Ran: 36 testes frontend, typecheck completo, lint dos dois componentes, build final
29,09s, node --check do harness e diff-check aprovados. Revisão independente PASS.
Log /tmp/na0057-permissions-browser.log; capturas
/tmp/na0057-permissions-{table,details,create}-{1440,768,390}.png.
Executor inspecionou visualmente tabela desktop e formulário mobile. Vite isolado
encerrado. Manual: homologação humana. Skipped: nova rodada CLI/banco/SSH/terminal,
sem mudanças nesses fluxos. Preservar chave desconhecida na UI não garante aceitação
no backend; validação de catálogo existente permanece.
