---
change_id: NA-0150
title: Preservar ordenação canônica e completar defaults por propriedade
type: fix
status: ready-for-tests
created_at: 2026-11-04T10:36:15-03:00
base_branch: fix/NA-0149-20261104-tooling-boundaries
base_sha: c07ca673c4f61a127635aeca21e7790ec875599e
branch: fix/NA-0150-20261104-explicit-contracts
owner: tooling
planner: tooling
risk: medium
issue: null
---

# NA-0150 — Contratos explícitos de ordenação e defaults

## Contexto e situação anterior
A reconciliação NA0145 identificou recomendações válidas antes propostas como FP. Dez sort sem comparador têm ordem canônica intencional; defaults de objeto inteiro deixam propriedades ausentes em objetos parciais. A autorização da raiz limita esta frente a 18 ocorrências propostas.

## Problema e objetivo
Explicitar a ordem UTF16 existente e garantir defaults individuais sem modificar valores explícitos, protocolo, autorização, transporte ou política Sonar.

## Escopo
Incluídos SQ-0265,0274,0275,0280,0282,0285,0286,0287,0506,0530 (sort); SQ-0404 (viewport), SQ-0001 (LocalListeners policy), SQ-0031 (limites TACACS).
Incluídos após revisão somente leitura SQ-0137/0138/0139/0140 (guacamole-import) e SQ-0144 (mobaxterm-import): arrays de strings de protocolos/principals, não ordem dos hosts. Comparador UTF16 preserva saída e testes de importação serão obrigatórios.
Excluídos baseline aceita, transições no servidor, MD5 do protocolo, demais refatorações e integração congelada.

## Critérios de aceitação
- [x] Quinze sort preservam exatamente ordem UTF16, seleção, serialização e digest, incluindo strings Unicode e hashes.
- [x] Viewport omitido/completo/parcial mantém defaults1440x900 apenas nas propriedades undefined.
- [x] Política omitida/vazia nega sem abrir listener; callback explícito preservado. Não ampliar autorização.
- [x] TACACS completa connections64/perSource8/operations32/timeoutMs5000 em objeto parcial; valores explícitos preservados, sem mudar protocolo.
- [x] Testes dos importadores (XML/JDBC/MobaXterm) incluem diferenciais de Unicode e preservam ordem dos hosts.
- [x] Testes reais existentes passam, negativos e diferenciais demonstram contratos; revisão independente antes checkpoint.

## Estratégia técnica
Comparadores locais `(left, right)` com relação `<`/`>` e empate0, evitando dependência de locale e abstração global. Defaults por destructuring em parâmetros, mantendo formas públicas e propriedades internas necessárias. Inspecionar callback policy para preservar receiver quando relevante; não introduzir binding diferente sem teste. TACACS mantém uso de objeto limits ou nomes existentes, sem reescrever fluxo.

## Riscos e mitigações
| Risco | Impacto | Mitigação | Parada |
|---|---|---|---|
| Ordem diferente | Hash/replay/manifest incompatível | Diferencial contra sort nativo UTF16 e digest real | Divergência |
| Default sobrescrever valor explícito | Limites alterados | Omitido/completo/parcial/zero/undefined; sem truthy fallback | Divergência fora undefined |
| Callback perder receiver | Política quebrada | Inspeção consumidor e teste receiver quando aplicável | Contrato não preservado |
| Ampliação de escopo auth | Regressão crítica | Só normalização inicial; suítes TACACS/listener | Falha nova |

## Matriz de testes e evidências
| Critério | Validação | Ambiente | Obrigatório |
|---|---|---|---|
| Ordem e hashes | Diferenciais Unicode/ASCII/caminhos/manifest/digest; testes provider/release/TLS/governança | Node24.22.1 local | sim |
| Defaults | Testes função/classe reais e suites TACACS/listeners | Node/Vitest loopback descartável | sim |
| Compatibilidade | ESLint nos arquivos suportados, typecheck backend se TS alterado | Worktree isolado | sim |
| Revisão | Agente independente com plano/diff/provas | Sem scanner concorrente | sim |

## Baseline
Base c07ca673c4f61a127635aeca21e7790ec875599e; worktree criado limpo. Baseline antes de fontes:66/66 Node e71/71 Vitest PASS; logs /tmp/NA0150-baseline-{node,vitest}.log. Vitest emitiu TimeoutNaNWarning preexistente (registrado, não silenciado). Provas anteriores de objeto parcial em /tmp/NA0149-default-object-probes.json; serão reproduzidas nesta frente antes da correção.

## Rollback ou recuperação
Reverter checkpoint isolado; sem migração, dado ou configuração operacional alterados. Preservar NA0149 na base.

## Mudanças de escopo e decisões
2026-11-04: raiz autorizou plano revisável antes de produto e implementação dos13 itens; proposta adicional de cinco importadores solicitada pela raiz, aguardando GO; sem push/merge.

## Aprovação
- Decisão: GO_WITH_RISKS.
- Aprovado por: raiz, autorização explícita dos18 itens.
- Aprovado em: 2026-11-04.

Correção necessária aprovada pela raiz: quatro erros legados de lint no teste TACACS tocado, provados na baseline; unknown, remoção de assertions redundantes e Promise.resolve preservam contratos.

## Incremento autorizado SQ-0014 (19º item)
2026-11-04: GO_WITH_RISKS explícito da raiz para S6959 em HostRepository.findVisible. Após baseline recent-access, trocar apenas idFilters.reduce sem inicial por idFilters.slice(1).reduce(callback,idFilters[0]), preservando guarda length>0, ordem e duplicatas. Testes função real com dependências de seleção simuladas para conjuntos nenhum/um/múltiplos/vazios, equivalência ao reducer anterior e isolamento tenant. Não alterar algoritmo de ACL nem consultas além inicial explícito. Revisão backend independente e lint/types obrigatórios.

## Incremento de lint estrito integrado
Raiz autorizou eliminar9warnings de retorno explícito em tacacs-server.ts e guacamole-import.service.ts, já documentados na baseline. Apenas tipos/aliases, semJSnovo/refactor/wrapper. Critério adicional: emissãoJS byte-idêntica ao30e7 com mesmosparâmetros TypeScript, lint2fontes--max-warnings0, typechecksbackend/frontend e suitesfocais. Incremento necessário paraCI, não altera18+1IDs/gates.
