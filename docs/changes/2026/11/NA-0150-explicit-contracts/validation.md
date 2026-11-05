# NA0150 — Evidências e limites

Base: c07ca673c4f61a127635aeca21e7790ec875599e. Worktree /tmp/nodeaccess-NA-0150. Runtime Node24.22.1; dependências existentes compartilhadas somente para leitura, sem npm ci.

| Validação | Resultado real | Evidência |
|---|---|---|
| Baseline Node | 66 PASS | /tmp/NA0150-baseline-node.log |
| Baseline Vitest | 71 PASS | /tmp/NA0150-baseline-vitest.log |
| Node final | 81 PASS | /tmp/NA0150-final-node.log |
| Vitest importadores/TACACS | 74 PASS | /tmp/NA0150-vitest.log |
| Independente Node/TACACS | 16+31 PASS_WITH_WARNINGS | /tmp/NA0150-independent-node.log; /tmp/NA0150-independent-tacacs.log |
| Tipos backend/frontend | exit0 ambos | /tmp/NA0150-types-backend.log; /tmp/NA0150-types-frontend.log |

Comando Node: node --test tools/shared/explicit-contracts.test.mjs apps/agent/src/local-listeners.test.js scripts/change-governance.test.mjs scripts/deploy/runtime-permissions.test.mjs scripts/trial-lab/provider.test.mjs tools/deploy/release-provenance.test.mjs tools/tls/manager.test.mjs.

Comando Vitest: node node_modules/vitest/vitest.mjs run apps/frontend/src/services/guacamole-import.service.test.ts apps/frontend/src/services/guacamole-import.fixtures.test.ts apps/frontend/src/services/mobaxterm-import.service.test.ts apps/backend/src/modules/network-access/tacacs.test.ts apps/backend/src/modules/network-access/tacacs-resilience.test.ts.

Os testes AST executam funções reais extraídas (comparador, viewport, digest), sem substituir fontes ou fabricar cobertura. Diferenciais usam Unicode, surrogate isolado, duplicatas, paths, hashes e serialização. Suites complementares executam consumidores e TLS/replay reais com adaptadores simulados; TACACS usa loopback descartável. Não foram repetidos browser, Docker, SQL real, scanners ou CI hospedado. Sem mudança visual/procedimento, sem inferir homologação. TimeoutNaNWarning é preexistente na baseline. A primeira edição TACACS colidiu com contador operations e falhou transformação; corrigida com alias e repetida com sucesso.

Resolução por18 IDs em resolution.json é proposta de implementação; análise integrada determinará desaparecimento. Nenhuma transição Sonar/baseline ou aceitação automática de risco.

Após correção necessária de lint:31/31TACACS PASS, tsc backend exit0 e lint final0erros/9warnings preexistentes (retornos implícitos), logs /tmp/NA0150-tacacs-lint-fix.log, /tmp/NA0150-types-backend-final.log, /tmp/NA0150-lint-final.log. Revisor independente leu minidelta e manteve parecer; não afirmou rerun próprio. git diff --check PASS.

## Incremento SQ0014
Baseline recent-access2PASS; novos11contratos mais2existentes13PASS antes/depois.216combinações exercitam findVisible real e mockam somente seletores/Prisma. Revisor independente13PASS (/tmp/NA0150-filters-independent.log). Ordem/multiplicidade/nenhumseletor/negaçãovazia/tenant/user conferidos. Sem DBreal. Primeira checagem TS exigiu assertion de não-nulidade no seed após guarda length>0; efeito sótipos, testes13PASS repetidos.

Final incremental: tsc backend exit0, ESLint2arquivos0problemas e git diff --check PASS. Logs /tmp/NA0150-host-types-final.log e /tmp/NA0150-host-lint.log.

## Incremento dos nove retornos explícitos
Lint estrito2fontes0erros/0warnings, typesbackend/frontend exit0,65testesVitest PASS (Guacamole service/fixtures + TACACS/resilience), emissãoJS byte-idêntica ao30e7 porTypeScriptES2022/ESNext. Revisor independente também transpiliou e confirmou igualdade. Logs /tmp/NA0150-return-types-{tests,lint,backend,frontend}.log; evidence emit-equivalence.json. NenhumaexecuçãoDocker/browser repetida para mudança apagada naemissão.
