---
change_id: NA-0147
title: Isolar execução de destaques do terminal com cancelamento real
type: fix
status: in-development
created_at: 2026-11-04T09:40:54-03:00
base_branch: fix/NA-0093-sonar-delivery
base_sha: ee436402db8bcce7fab4378d6ba28c1673b282b5
branch: fix/NA-0147-20261104-terminal-highlight-budget
owner: equipe NodeAccess
planner: Codex
risk: medium
---

# NA-0147 — Execução limitada dos destaques

## Contexto e situação anterior
NA-0145 SQ-0069: detector backend superlinear limitado a160 caracteres/40 regras; regex aceita (a|aa)+$ bloqueia matcher síncrono antes de budget8ms. Consumidores incluem terminal, previews e exportação de auditoria.

## Problema e objetivo
Interromper trabalho custoso sem bloquear UI, mantendo semântica JS das regras válidas, prioridade, estilos e preferências/tenants.

## Escopo
Motor puro em Worker, cliente assíncrono cancelável, migração de TODOS consumidores produtivos. Scanner linear equivalente no backend preserva rejeições existentes sem alegar segurança universal. Testes de regras/concorrência/cleanup, browser adversarial e terminal UX. Sem transporte SSH/WS, migrações, novas dependências ou alterações de gates.

## Critérios de aceitação
- [ ] Regex patológica termina por cancelamento real, UI continua respondendo.
- [ ] Literais/curingas/regex válidas, prioridade, Unicode e limite120 preservados.
- [ ] Resultados antigos não aplicados após novo texto/configuração/descarte; filas e workers limitados.
- [ ] Worker indisponível falha fechado sem fallback síncrono; feedback discreto de timeout.
- [ ] Todas as chamadas produtivas usam fronteira isolada, incluindo previews e exportação.
- [ ] Scanner backend linear equivalente e isolamento tenant/preferences mantidos.
- [ ] Lint/typecheck/build, testes dirigidos, browser real e capturas, revisão independente.

## Estratégia técnica
Um Worker compartilhado lazy por página; cliente leve por consumidor, fila limitada a32 pendências com substituição latest-wins, handshake de inicialização separado do watchdog de resposta50ms no event loop principal solicitando terminate (não garante50ms de CPU física). Softbudget8ms mantido no motor. Uma requisição ativa e última pendente por consumidor; alterações invalidam resultados. Primeiro timeout/erro solicita terminate e suspende TODO o engine pela vida da página, rejeitando fila, reconfigurações e novos consumidores; só recarregar reinicia. Cancelamento comum invalida resultado sem criar worker sobreposto: aguarda resposta ou watchdog. Regras inválidas sintaticamente não derrubam terminal. Motor e protocolo sem Vue/DOM; composable para previews limita debounce e descarte.

## Riscos e mitigações
Cold-start e CPU modesta podem exceder orçamento; medir Chromium real e separar startup. Timer de browser não é hard realtime em aba suspensa. Prova real detectou CPU nativa residual~2s após terminate (Chromium151), consistente com kForcibleTerminationDelay2s do Chromium. A suspensão global evita acumulação, sem prometer prazo universal de outros navegadores. Uma instância compartilhada reduz custo de memória e exige testes de justiça: consumidorB válido funciona antes do timeout; após timeout deA também é rejeitado explicitamente. Fila cheia rejeita explicitamente sem expandir memória. Payload limitado antes de structured-clone; exportação usa batches e falha explicitamente se um batch exceder. Worker contém somente regras/texto, sem rede ou credenciais. Exportação assíncrona precisa abortar explicitamente em timeout, não entregar resultado incompleto como completo. Nenhum teste automatizado representa homologação humana.

## Matriz de testes e evidências
Ran baseline NA0145: subprocesso matcher patológico excede1500ms. Planned: suites existentes; equivalência scanner; worker realdeadline; disposed/stale/erro/queue; previews e exportação; terminal-experience:web comprints. PTYreal não aplicável sem mudança de resize/SSH/WS; reavaliar se escopo mudar.

## Baseline
SHA ee436402db8bcce7fab4378d6ba28c1673b282b5. Worktree isolado por concorrência; dependências ligadas somente leitura à integração. Sem install/prisma/generate. Baseline dirigido Ran:63 testes PASS em3arquivos (highlighter, presets, backendservice), Node24.22.1; /tmp/na0147-baseline.log.

## Rollback ou recuperação
Reverter apenas commit da frente; sem dados migrados. Reversão reintroduz execução síncrona vulnerável; alternativa operacional desligar destaques enquanto corrige.

## Aprovação
Decisão: GO_WITH_RISKS. Usuário autorizou correções/testes; raiz delegou frente, arquitetura submetida à revisão antes de edição de produto. Commit local autorizado após gates; sem push/merge direto.
