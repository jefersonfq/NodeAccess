---
change_id: NA-0092
title: SonarQube real e isolado no CI
type: chore
status: in_progress
created_at: 2026-11-03T16:00:00-03:00
base_branch: chore/NA-0089-20261103-sonar-integration
base_sha: 4a77f7139600e70aa612e753418978d9b31b10ae
branch: chore/NA-0092-20261103-sonar-ci
owner: Codex
planner: Codex
risk: high
issue: null
---

# NA-0092 — SonarQube real e isolado no CI

## Contexto e situação anterior

O CI executa testes das ferramentas Sonar, mas a análise real depende do servidor WSL. A revisão individual usa assinaturas de regra/caminho/hash e multiplicidade, portáveis entre servidores.

## Problema e objetivo

Executar scanner real em runner GitHub descartável, com projeto privado e credenciais efêmeras, preservando cobertura, revisão individual e gate. Não depender de conectividade ao WSL.

## Escopo

- Workflow, ferramentas `tools/sonarqube/ci*`, testes e documentação desta frente.
- Fora: produto, publicação, proteções GitHub, serviços locais existentes. NA-0090 é responsável por cobertura; NA-0091 por continuidade; coordenação atualiza planilha.

## Critérios de aceitação

- [x] Análises reais base/head isoladas e limpeza dos recursos próprios.
- [x] Gates de cobertura e baseline mantidos, inclusive falhas e bootstrap documentados.
- [x] Credenciais efêmeras, projeto privado e artefatos sanitizados.
- [x] Testes e ensaio real registrados; limites de validação no GitHub explícitos.

## Estratégia técnica

Runner Ubuntu hospedado, sem secrets externos ou `pull_request_target`. Imagens Sonar/Postgres fixadas por digest. Cobertura executada antes de subir Sonar para reduzir competição de memória. Uma análise da base inicializa a comparação e a análise do candidato usa specific analysis. SCM desativado somente nesse servidor efêmero: datas dos commits anteriores à execução não podem esconder alterações. Gate Git diff/LCOV de 80% independente evita confundir primeira análise ou condições ignoradas com aprovação. O gate legado 70/70/60 mantém exatamente seu escopo original; abrangência total é informativa.

Baseline versionado do candidato validado por assinatura e contagem; digest e diferença frente à base aparecem no resumo, exigindo revisão humana de alterações. Nenhum status de falso positivo é aplicado na API.

## Riscos e mitigações

| Risco | Impacto | Mitigação | Parada |
|---|---|---|---|
| Primeira análise ignora new code | Falso verde | Base/head e LCOV diff80 independente | Comparação não comprovada |
| PR executa código não confiável | Comprometimento de runner | Runner descartável, token read-only, sem secrets externos | Uso de runner persistente |
| Consumo de memória | Falha de análise | Cobertura antes do servidor; limites e timeout | OOM ou análise incompleta |
| Baseline adulterada | Ocultação de achados | Digest/diff explícitos; revisão PR | Schema inválido/ocorrência extra |

## Matriz de testes e evidências

| Critério | Teste | Ambiente | Evidência | Obrigatório |
|---|---|---|---|---|
| Política e gates | Node.test | Worktree | test-results.md | Sim |
| Servidor/scanner/cleanup | Ensaio Docker isolado | WSL, porta dinâmica | test-results.md | Sim |
| GitHub real | Execução após publicação autorizada | GitHub | Pendente | Sim antes de declarar operacional |

## Baseline

- SHA: `4a77f7139600e70aa612e753418978d9b31b10ae`.
- Imagens locais inspecionadas; servidor 9000 preservado.
- Cobertura ampliada em desenvolvimento na NA-0090; não presume global70 sobre novo denominador.

## Rollback ou recuperação

Reverter commit/workflow. Nenhuma migração ou alteração de produto. Contêineres efêmeros próprios removidos em finally; não reutilizar recursos de outra execução.

## Mudanças de escopo e decisões

2026-11-03: usuário autorizou fechar pendências; coordenação aprovou implementação local e CI-only SCM disabled com LCOV diff80. Não autoriza publicação nesta subfrente.

## Aprovação

- Decisão: GO_WITH_RISKS
- Aprovado por: usuário (escopo) e coordenação (execução local)
- Aprovado em: 2026-11-03
