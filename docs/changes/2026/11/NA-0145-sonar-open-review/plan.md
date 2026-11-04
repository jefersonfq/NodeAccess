---
change_id: NA-0145
title: Reavaliação individual dos 294 achados Sonar abertos
type: docs
status: ready-for-tests
created_at: 2026-11-04T09:10:40-03:00
base_branch: chore/NA-0093-20261103-sonar-delivery
base_sha: ee436402db8bcce7fab4378d6ba28c1673b282b5
branch: docs/NA-0145-20261104-sonar-open-review
owner: NodeAccess
planner: Codex
risk: medium
---

## Problema e objetivo

Usuário solicitou avaliar os 294 itens abertos. Reavaliar cada justificativa contra o código atual, sem presumir que context_reviewed significa falso positivo ou risco aceito pelo responsável.

## Escopo

Auditoria somente leitura do código e da instância Sonar; tabela individual com evidência, classificação proposta, prioridade e limitações. Não modificar aplicação, baseline, gates ou estados de issues no servidor. Fonte congelada no SHA base. Documentos canônicos na pasta docs do projeto principal.

## Critérios de aceitação

- [x] Cobrir exatamente os 294 IDs atualmente abertos, sem duplicação ou omissão.
- [x] Distinguir falso positivo, risco real a aceitar explicitamente, correção necessária e evidência insuficiente.
- [x] Verificar contexto de execução, entradas, permissões e exposição quando pertinentes.
- [x] Validar IDs, caminhos, linhas e completude; revisão independente das conclusões sensíveis.
- [x] Registrar limitações e próximos passos sem alegar testes não executados.

## Rollback ou recuperação

Validação documental e inspeção estática; testes focais ou simulações somente se necessários para resolver dúvida concreta. Sem alteração de runtime ou migração. Reversão limitada aos documentos desta frente. Merge e homologação NA-0093 permanecem independentes e pendentes.

## Contexto e situação anterior

294 issues permaneciam OPEN; tabela anterior usava context_reviewed para todas, sem distinguir falsos positivos de riscos condicionais ou evidência faltante.

## Estratégia técnica

Inspeção por domínio e por ID, fonte congelada, confronto com export atual. Simulações focais para resolver dúvidas concretas; revisão cruzada dos casos sensíveis. Relatório/CSV/HTML sem mudança de estado no servidor.

## Riscos e mitigações

Não inferir que uma regra falsa positiva torna o arquivo livre de defeitos; separar problemas adjacentes. Não elevar risco condicional de PATH a exploração demonstrada nem presumir aceite humano. Subprocessos com deadline para regex adversariais; nenhum teste contra VPS.

## Matriz de testes e evidências

Ran: 294 IDs/linhas/arquivos conferidos; 129 arquivos referenciados; probes de pager, highlights, teclado, IPv6, DCS, permissões temporárias e precedência TLS. Revisões cruzadas PASS_WITH_WARNINGS, limitadas ao escopo descrito. Relatório assessment.md e tabelas review.*. Skipped: CI de aplicação, novo Sonar, SSH/HTTP E2E, WCAG/leitor de tela — código de produto não alterado, limitações explícitas.

## Baseline

Base ee436402db8bcce7fab4378d6ba28c1673b282b5, servidor com294 IDs correspondentes. Fonte/accepted-findings/gates preservados. Resultado final:242 propostas FP,43 riscos a decidir,7 correções propostas,2 evidências insuficientes; dois defeitos adjacentes adicionais.

## Aprovação

Decisão: GO_WITH_RISKS para a avaliação documental autorizada pelo pedido do usuário. Não autoriza aceite de risco, fechamento de issues, merge da NA-0093 ou implantação. Correção P1 recomendada antes da homologação da entrega integrada.
