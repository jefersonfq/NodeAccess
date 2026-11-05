# NA-0164 — Registro da implementação

## Pedido e objetivo
Exigir reconhecimento explícito ao ativar TACACS legado.

## Implementação
Base SHA 025e82863d0a2cff49b29896dc283c7efdd00548. Preservar interoperabilidade MD5 e risco OPEN; exigir reconhecimento operacional antes de escutar, documentação e compose sem reconhecimento automático. Testes positivos/negativos e protocolo TCP real.

## Validação
Ran no worktree `/tmp/nodeaccess-NA-0164`, base SHA acima + diff LOCAL_WIP:
- Baseline: `node node_modules/vitest/vitest.mjs run apps/backend/src/modules/network-access/tacacs.test.ts apps/backend/src/modules/network-access/tacacs-resilience.test.ts apps/backend/src/modules/network-access/tacacs-health.test.ts`: 55/55 passaram.
- Após alteração: mesmo comando incluindo `tacacs-activation.test.ts`: 69/69 passaram (14 novos), incluindo TCP real em loopback descartável e bloqueio do bootstrap antes de construir listeners.
- Backend: `node ../../node_modules/typescript/bin/tsc --noEmit` em `apps/backend`: passou.
- `git diff --check`: passou.
- ESLint focal nos três arquivos tocados: falhou em `tacacs-main.ts` com quatro avisos de retorno e `_tenants` sem uso. Comparação via `git show HEAD:apps/backend/src/modules/network-access/tacacs-main.ts | eslint --stdin --stdin-filename apps/backend/src/modules/network-access/tacacs-main.ts --max-warnings 0` reproduziu os mesmos cinco achados na baseline. ESLint dos dois arquivos novos passou sem avisos.
- Runtime: `/tmp/na0093-owned-runtime/bin/node`; dependências compartilhadas por symlink. Avisos Vitest/Vite e TimeoutNaN já presentes na baseline.
Planned: revisão independente e `npm run validate:sonar` no candidato integrado pela orquestração; nenhum resultado Sonar novo declarado.

## Recuperação
Worktree separado para preservar alterações alheias na pasta principal.

## Pendências
Revisão independente, validação Sonar integrada, homologação humana e publicação. Risco MD5 continua OPEN, sem alteração de baseline/aceite/FP. Atualização da planilha canônica Roadmap 2027 e cópia dos documentos para o projeto atual delegadas à orquestração; ainda pendentes neste registro. Os cinco achados de lint reproduzidos na baseline foram corrigidos por autorização posterior; validação final registrada abaixo.

## Diário de interações

### 2026-11-04T17:40:41-03:00 — Autorização e decisão
Usuário pediu concluir pendências e avaliar economia de tokens. TACACS legado preservado por escolha explícita, sem aceite de achado. Código/fluxos afetados conforme plano; validações novas ainda não executadas.

### 2026-11-04T17:42:58-03:00 — Guard operacional e regressão

Implementado `assertTacacsActivation` testável, chamado em `tacacs-main.ts` antes de construir qualquer listener. Exige opt-in existente e reconhecimento operacional literal `true`; valores ausentes, falsos e ambíguos são recusados. `docker-compose.tacacs.yml` transmite a variável com default vazio, sem aceite automático. Guia operacional esclarece proteção do caminho/rede/túnel, diferença de TLS da RFC 9887, impacto em instalações existentes e manutenção do risco MD5 aberto. Fontes RFC 8907/9887 consultadas diretamente. Protocolo, autenticação, autorização e algoritmo preservados. Todos os diffs são IN_PLAN. Testes e limitações descritos acima; próximo passo é revisão independente e gates no candidato integrado. Sem commit ou publicação nesta etapa.

### 2026-11-04T17:45:39-03:00 — Correção localizada de lint e autorização de commit

Orquestração comunicou revisão independente do guard `PASS_WITH_WARNINGS` e autorizou corrigir os cinco achados preexistentes no arquivo tocado, como NECESSARY_CORRECTION, seguida de commit com trailers. Adicionadas anotações `Heartbeat`, `void` e `Promise<void>`; métricas substituem `tenants` por `undefined` na cópia serializada, preservando omissão do detalhamento no JSON sem variável inutilizada. Nenhuma política/protocolo alterado. Regressão repetida: 69/69 testes passaram; `git diff --check` passou. ESLint estrito dos três arquivos tocados passou (zero avisos); typecheck completo do backend passou. Sonar e governança do candidato integrado continuam gates independentes.
