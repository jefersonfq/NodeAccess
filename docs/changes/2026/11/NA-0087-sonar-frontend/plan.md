---
change_id: NA-0087
title: Corrigir achados frontend com regressão e revisão por ocorrência
type: fix
status: in-development
created_at: 2026-11-03T14:10:00-03:00
base_branch: chore/NA-0085-20261103-sonarqube
base_sha: 3aa5513789d63ef24b3e268c5f2077fde7db616e
branch: fix/NA-0087-20261103-sonar-frontend
owner: unassigned
planner: Codex
risk: medium
issue: null
---

# NA-0087 — Remediação frontend SonarQube

## Contexto e situação anterior

A análise NA-0085 atribuiu 165 ocorrências ao frontend. Parte corresponde a controles Vue que o scanner não resolve; outra parte contém nomes acessíveis ausentes, expressões com retrocesso, papéis incorretos e mutação de estado em computed.

## Problema e objetivo

Corrigir os problemas reais e registrar revisão individual de todas as ocorrências, sem suprimir regras, excluir backups nem alterar protocolo terminal apenas para diminuir indicadores.

## Escopo

- Incluído: frontend, testes dirigidos/adversariais, simulações com dados sintéticos, capturas e manual mapeado.
- Excluído: backend, mudanças de autenticação/transporte SSH, dependências, regras/thresholds Sonar, marcação de falsos positivos na API, produção e publicação.

## Critérios de aceitação

- [x] 165 IDs únicos com decisão, justificativa específica, risco e evidência.
- [x] Controles revisados individualmente com DOM; regressão terminal, auditoria, licenças e snippets.
- [x] Testes, typecheck/build, capturas e manual; distinguir testes locais de homologação humana.
- [x] Commits locais por lotes de até cinco correções lógicas, documentos disponíveis no projeto canônico.

## Estratégia técnica

Varreduras lineares de texto com testes de equivalência e entradas adversariais; associação de nomes aos controles realmente renderizados pelo Naive UI; preservação do estado fonte antes de ordenar. Seletor filtrável recebe input-props para nomear o input interno. Checkbox usa label próprio para nome e clique; controles nativos recebem nome explícito. Papéis correspondem à interação real e métricas estáticas deixam a sequência Tab.

## Riscos e mitigações

| Risco | Impacto | Mitigação | Critério de parada |
|---|---|---|---|
| Divergência de reconhecimento | Auditoria/paste | Equivalência e entradas grandes; simulação de reconstrução | Resultado válido alterado sem justificativa |
| Associação apenas aparente | Leitor de tela/teclado | DOM por ocorrência com componentes reais | Controle sem nome ou foco |
| Regressão visual/terminal | Trabalho do usuário | Harness existente, screenshots desktop/mobile | Falha de geometria ou limite de performance |

## Matriz de testes e evidências

| Critério | Teste | Ambiente | Evidência | Obrigatório |
|---|---|---|---|---|
| Semântica/performance | Vitest frontend + text-boundaries | Node 24 / WSL | test-results.md | sim |
| Acessibilidade | sonar-frontend-review.cjs | Chromium / Vite 5197 | dom-label-evidence.json | sim |
| Fluxos | terminal, snippets, platform-settings, audit, observability | API/WebSocket simulados | screenshots / test-results.md | sim |
| Build/manual | build, manual:capture/check-reviewed/test | Worktree isolado | registro operacional/manual | sim |

## Baseline

- Base SHA: 3aa5513789d63ef24b3e268c5f2077fde7db616e.
- Achados: arquivo privado .sonar-reports/assigned.json; somente metadados sanitizados são publicados.
- DOM inicial confirmou checkbox sem nome e aria-label no contêiner NSelect sem nome no input interno.
- Nenhuma homologação humana deste lote foi declarada.

## Rollback ou recuperação

Reverter os commits locais desta frente. Sem banco, configuração persistente, instalação ou deploy. Reanálise Sonar agregada fica com a frente de integração NA-0089.

## Mudanças de escopo e decisões

O usuário autorizou tratar todos os achados com branches separadas e testes/simulações/prints. Contextos intencionais recebem context_reviewed, separados de fixed e de ausência no scanner. Sem autorização de publicação inferida.

## Aprovação

- Decisão: GO
- Aprovado por: usuário, no pedido explícito de tratar todos os achados e registrar branches separadas.
- Aprovado em: 2026-11-03; autorização de implementação local, não homologação humana nem publicação.

### Retorno da análise integrada — 2026-11-03

Incluídos os três alertas novos do harness e revisão dos cinco residuais. Refinamento de labels, parser literal sem execução, Git absoluto e cleanup após erro de captura foram testados. Canvas mantém o papel de aplicação remota com contexto residual e histórico rastreável; não foi suprimido no servidor.
