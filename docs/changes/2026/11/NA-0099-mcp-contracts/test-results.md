# NA-0099 — Contratos MCP

Worktree `/tmp/nodeaccess-NA-0099`, Node24.21.0, base `4a77f7139600e70aa612e753418978d9b31b10ae`.

| Validação | Resultado |
|---|---|
| Novos contratos McpService |45 PASS |
| Módulo MCP completo |82 PASS,3 SKIP opt-in,6 arquivos |
| Cobertura focal McpService |326/335linhas97,31%;84/84funções100%;400/480branches83,33% |
| Gate focal70/70/60 |PASS, sem reduzir thresholds |
| ESLint novo arquivo |PASS |
| Typecheck backend |PASS após build shared isolado |
| Screenshots/SSH real |Não aplicável; apenas testes, sem alteração de UX ou transporte |

Comando focal: `node node_modules/vitest/vitest.mjs run apps/backend/src/modules/mcp --maxWorkers=1 --reporter=dot --coverage --coverage.include=apps/backend/src/modules/mcp/mcp.service.ts --coverage.reporter=json-summary --coverage.reportsDirectory=/tmp/NA0099-coverage`.

Os3 skips são cenários existentes dependentes de `MCP_SDK_ROOT`, `MCP_CLI_SMOKE` e `MCP_GEMINI_BIN`. Não foram acrescentados skips, exclusões ou mudanças de configuração. O HTTP loopback existente executou normalmente; emitiu aviso conhecido de schema unionType, sem falha de teste.

## Contratos

- Catálogos respeitam allowlist e associação de investigação a operação; filtros de busca preservam tenant, token, usuário, role e ACL efetiva antes de limitar resultados.
- Recursos JSON-RPC propagam escopo e normalizam status/channel/mode/AI summary, rejeitando filtros e URIs não suportados.
- Policies agregam safe/approval_required/blocked sem executar comandos; aprovar/rejeitar exige usuário admin.
- Sessões interativas propagam ator/token e convertem parâmetros, preservam opcionais e propagam recusas do serviço responsável.
- Solicitação de ação preserva DTO, evidências e contexto; auditoria/interações mantêm correlação e toleram falhas conforme política existente.
- Investigação exige serviço disponível e confirmação booleana explícita para concluir/abandonar; evidências malformadas são rejeitadas antes de persistir.

## Limites

McpService e seus normalizadores/dispatchers são reais. Banco, permissões efetivas, diagnóstico, ações, policy, transporte interativo e repositórios de auditoria são dependências simuladas. Os testes verificam delegação e regras próprias deste serviço; não comprovam banco real, SSH wire, criptografia, avaliação de comandos do serviço de policy ou ACL real. Autorização de rota é coberta pela suíte HTTP existente, não deve ser inferida apenas de chamadas diretas ao service.

A cobertura focal não substitui gate integrado do escopo legado. Revisão independente, integração, atualização de planilha e publicação cabem à coordenação. Nenhuma publicação ou homologação humana inferida.
