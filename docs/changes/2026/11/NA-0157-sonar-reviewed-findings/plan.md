---
change_id: NA-0157
title: Reproduzir revisões técnicas de falsos positivos no Sonar
type: fix
status: ready-for-tests
created_at: 2026-11-04T12:22:35-03:00
base_branch: chore/NA-0093-20261103-sonar-delivery
base_sha: 28a77996deb4c004690e828c4a3a1f6dd292d198
branch: fix/NA-0157-20261104-sonar-reviewed-findings
owner: NodeAccess
planner: Codex
risk: high
---

# NA-0157 — Revisões técnicas reproduzíveis no Sonar

## Contexto e situação anterior

A análise 28a779 apresentou 10 novos alertas, incluindo controles ANSI deliberados, guard CommonJS e permissões de nonce ACME público. O projeto temporário do CI perde decisões individuais. O usuário autorizou tratar todos os achados com testes; nenhuma autorização de aceite dos três riscos operacionais foi inferida.

## Problema e objetivo

Reproduzir somente falsos positivos tecnicamente demonstrados, com correspondência exata e evidência individual, preservando código necessário e critérios de qualidade. Não alterar código apenas para esconder padrões legítimos do scanner.

## Escopo

Reconciliador, manifesto versionado, ator efêmero exclusivo do CI, verificação local somente GET e testes negativos/reais. Exclusivamente transição falsepositive; accept, wontfix e hotspots fora do escopo. Não ampliar accepted-findings.json, desativar regras, reduzir cobertura ou aceitar riscos. As fontes do manifesto dependem da integração NA0155/NA0156.

## Critérios de aceitação

- [x] Conferir projeto, análise, revisão Git, árvore rastreada limpa, blob da fonte, versão/regra instalada, hash e range completo.
- [x] Paginação completa, identidade única, negativa de fonte/range/regra/extra/duplicata e manifestação removida.
- [x] Dry run sem escrita; decisões humanas divergentes bloqueiam o lote; idempotência sem duplicar comentário.
- [x] Journal síncrono com fsync registra intenção antes do POST; falha parcial permanece falha.
- [x] Ensaiar em projeto descartável falha parcial, retomada, gate atual e substituição real de análise, com cleanup.
- [ ] Confirmar o manifesto contra análise fresca do candidato integrado.
- [ ] Executar gates completos e CI no candidato final, sem inferir homologação humana.

## Estratégia técnica

Manifesto com 206 registros: 194 propostas anteriores ainda presentes, três de UI após correção de teclado/foco e nove novas. Cada entrada exige justificativa, evidência, arquivo, hash integral, regra com definição canônica e range. Fonte não rastreada ou diferente do blob Git da análise é rejeitada. Todo lote é validado antes de qualquer escrita. Ausência só é registrada após inventário completo; nunca encerra outro achado.

O CI cria ator separado com browse e issueadmin somente no projeto efêmero, preservando tokens existentes. A validação local verifica as revisões exclusivamente por GET. Aplicação local dependerá de concessão temporária específica sobre candidato revisado; ainda não houve transição ou grant no projeto principal. Reconsulta de análise/fonte/estado ocorre antes das escritas; export e gate atuais são conferidos depois, sem inferir aprovação do retorno da transição.

## Riscos e mitigações

Classificação incorreta pode ocultar defeito: manifesto restrito a provas individuais e revisão independente, sem regra genérica de aceitação. Alteração de fonte/regra exige nova revisão. API não oferece CAS; a reconsulta reduz, mas não elimina, corrida entre último GET e POST. Journal privado registra chaves/estado para recuperação; resumo público mantém apenas IDs, ações e estados. Nenhuma credencial é incluída nos logs.

## Matriz de testes e evidências

Ran: 222 contratos Sonar, lint estrito e revisão independente. Ensaio real com commits Git, scanner base/head, dois achados ANSI, falha parcial e retry, gate atual ERROR→OK sem rescan e nova análise invalidando lote anterior. Conta temporária desativada, token revogado e projeto removido. Tentativas que falharam foram preservadas. Planned: integração e nova análise; Manual: homologação funcional e concessão local específica.

## Baseline

Base SHA 28a77996deb4c004690e828c4a3a1f6dd292d198: testes de produto e cinco harnesses aprovados; cobertura nova 73,00% e 10 novos achados bloqueavam o gate. NA0155 ampliou os cenários; NA0156 removeu credenciais/Secret morto. A análise antiga não corresponde a cinco ranges do manifesto final.

## Rollback ou recuperação

Preservar a branch e reverter por PR. Sem migração do banco do produto. Reabrir somente chaves registradas por esta execução após conferir estado; nunca desfazer automaticamente decisão humana concorrente. Falha de limpeza mantém resultado reprovado. Projeto principal/VPS não são alterados por ensaios.

## Aprovação

Decisão: GO_WITH_RISKS, revisada por agentes backend e tooling antes da implementação. Implementação e manifesto foram revisados independentemente. Aprovação técnica do mecanismo não autoriza aplicar o lote na análise antiga nem presume homologação humana.
