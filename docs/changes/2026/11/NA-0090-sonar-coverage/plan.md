---
change_id: NA-0090
title: Cobertura abrangente e testes por risco
type: test
status: in_progress
created_at: 2026-11-03T15:50:20-03:00
base_branch: chore/NA-0089-20261103-sonar-integration
base_sha: 4a77f7139600e70aa612e753418978d9b31b10ae
branch: test/NA-0090-20261103-sonar-coverage
owner: equipe NodeAccess
planner: Codex
risk: medium
---

# NA-0090 — Cobertura abrangente

## Contexto e situação anterior

Cobertura instrumenta apenas services backend, enquanto Sonar analisa backend, frontend Vue, shared, agent e ferramentas. Rotina existente falha o gate global; não ocultar esse resultado. Inventário inicial: 981 arquivos JS/TS/Vue executáveis, aproximadamente 227.850 linhas físicas, antes de medir linhas instrumentáveis.

## Problema e objetivo

Produzir LCOV real abrangente, identificar gaps por camada e implementar testes significativos por risco. Preservar mínimos legados lines/functions 70%, branches 60% no escopo original de services backend; nova cobertura >=80%. Não excluir código executável nem refatorar produto para facilitar teste.

## Escopo

Instrumentação e integração dos runners existentes, testes backend/frontend/shared/agent/tooling, relatório de gaps e cobertura de código novo. Sem scanner Sonar (frente raiz), produção, alteração de regras de auth/tenant ou documentos NA-0091/92.

## Critérios de aceitação

- [ ] LCOV inclui fontes executáveis de todas as camadas, incluindo arquivos não exercitados.
- [ ] Sem reduzir thresholds, criar exclusões para melhorar nota ou considerar skipped como cobertura.
- [ ] Gate legado 70/70/60 nos mesmos services e cobertura nova >=80% comprovados ou gap quantitativo explicitamente reprovado.
- [ ] Testes acrescentados validam comportamentos/erros/isolamento relevantes, sem mocks que apaguem o comportamento medido.
- [ ] Revisão independente, evidência reproduzível e documentação canônica.

## Estratégia técnica

Medir baseline antes de alterações; habilitar transformação Vue e fontes abrangentes; incorporar testes Node existentes com cobertura real e união conservadora; validar completude e caminhos do LCOV. Priorizar testes pelo risco e maior gap real. Gates devem falhar quando métrica ou camada estiver ausente. Percentual global abrangente é informativo; não substituir nem diluir o gate dos services. Definição inicial de cobertura nova: linhas e condições adicionadas em diff contra base, compatível com métrica de new coverage; confirmar coordenação com raiz.

## Riscos e mitigações

Denominador grande: ampliação deve reduzir a porcentagem inicial; não presumir viabilidade de 70% em lote curto. Runner Node e Vitest podem mapear branches diferentemente; não somar métricas incompatíveis nem duplicar fontes. Scripts live têm efeitos colaterais: não executar automaticamente sem fixture isolada. Componentes Vue precisam instrumentação de script/template e DOM apropriado, sem ocultar exceções.

## Matriz de testes e evidências

Baseline Vitest coverage; contrato de instrumentação/LCOV; suites unitárias existentes; suites Node opt-in explícitas; testes novos por risco; builds/typechecks pertinentes. Relatórios volumosos em caminhos locais ignorados, resumo versionado. Nenhum teste a serviços do usuário.

## Baseline

Base exata 4a77f7139600e70aa612e753418978d9b31b10ae. Node 24.21.0. Worktree isolado para concorrência e preservação do checkout canônico. node_modules raiz compartilhado, shared local por link no workspace backend/frontend.

## Rollback ou recuperação

Reverter apenas configuração e testes desta frente. Sem migração ou modificação de dados. Preservar evidência de falhas e gates abertos.

## Aprovação

Decisão: GO_WITH_RISKS. Usuário autorizou executar fim a fim as pendências de cobertura; commits locais autorizados ao fechar. Viabilidade dos percentuais depende da medição abrangente. Aprovação não implica atingir gate, homologação ou publicação.


## Evolução autorizada do escopo — coleta browser

A raiz solicitou executar os harnesses reais de revisão frontend e tabela dentro da coleta, porque cobertura de scripts novos permanecia insuficiente. A fase é obrigatória em `test:coverage`, com Vite loopback sem app/backend/proxy, Chromium real, outputs privados e NODE_V8_COVERAGE fresco; callbacks `page.evaluate` continuam descobertos no mapa Node. Não importar crédito de ensaios externos. Instalação Chromium na CI usa CLI da dependência fixada; override local explícito é registrado, nunca fallback silencioso.
