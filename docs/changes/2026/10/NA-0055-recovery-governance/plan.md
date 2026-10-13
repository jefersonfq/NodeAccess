---
change_id: NA-0055
title: Rastreabilidade de implementações e recuperação de versões
type: process
status: ready-for-tests
created_at: 2026-10-11T08:00:00-03:00
base_branch: master
base_sha: 8eeef08b520a4ffde58cb0733b1e55ff7b247ef7
branch: process/NA-0055-20261011-recovery-governance
owner: jefersonfq
planner: codex
risk: medium
---
# NA-0055 — Rastreabilidade de implementações e recuperação de versões

## Contexto e situação anterior
A consolidação NA-0054 passou pelo CI e está na master. Existem planos, PRs e scripts de backup/rollback; não há tags nem rulesets. O resumo por interação depende da memória da conversa. FUT-001–011 registra trabalho posterior.

## Problema e objetivo
Manter uma trilha versionada e legível das implementações assistidas por IA, proteger referências recuperáveis e ensaiar recuperação sem afetar desenvolvimento ou produção.

## Escopo
- Diário por implementação: pedidos/decisões relevantes, mudanças, testes, limitações e recuperação; templates e validação para novas frentes.
- Guia e índice das mudanças; regras GitHub inspecionadas, exportadas e aplicadas de forma reversível, preservando branches e histórico.
- Checkpoints de código com tags anotadas protegidas, sem alegar homologação de release; ferramentas de inventário/recuperação que não alteram o checkout ativo.
- Revisão dos scripts de recuperação e correções necessárias com testes isolados.
- Auditoria redigida de segredos históricos; avaliar CSP/non-root e registrar ou executar em frente própria conforme risco.
- Fora: deploy em produção, upgrade de guacd, reescrita do histórico, remoção de branches, assinatura real sem credenciais, homologação humana fictícia.

## Critérios de aceitação
- [ ] Novas mudanças exigem resumo estruturado com conteúdo, diário e rollback; planos históricos permanecem válidos.
- [ ] Testes rejeitam registros ausentes/incompletos e recuperação de referências inválidas; recuperação real de commit conhecido em destino isolado preserva árvore original.
- [ ] GitHub impede alteração destrutiva de master/tags e exige os checks que efetivamente executam em todo PR; configuração anterior arquivada.
- [ ] Checkpoint inicial e final identificam SHAs completos e limites de recuperação.
- [ ] README/AGENTS/templates descrevem o registro por IA sem dados sensíveis nem resultados inventados.
- [ ] Pendências dependentes de pessoas/credenciais são explícitas; revisão independente e CI no SHA final.

## Estratégia técnica
Reutilizar change-governance, docs/changes e scripts existentes. Diário por frente, resumindo cada interação material, não transcrição integral. Tags checkpoint/NA-* para marcos de código; releases de produto continuam exigindo homologação e artefatos/bancos compatíveis. Nenhum serviço de IA externo ou nova dependência.

## Riscos e mitigações
| Risco | Impacto | Mitigação | Parada |
|---|---|---|---|
| Gate impossível em repositório individual | Bloqueio do fluxo | Verificar colaboradores; checks obrigatórios sem inventar revisor humano | Regra incompatível |
| Rollback com schema incompatível | Perda de dados | Backup/restauração em ambiente separado; sem downgrade automático | Ausência de backup compatível |
| Segredos em evidências | Exposição | Scan redigido, relatórios privados, sem copiar valores | Achado válido exige rotação |
| Alteração em histórico existente | Perda de rastreabilidade | Não reescrever nem excluir; tags anotadas | Referência divergente |

## Matriz de testes e evidências
| Critério | Teste | Ambiente | Evidência | Obrigatório |
|---|---|---|---|---|
| Governança/diário | node --test, casos inválidos e legado | Local/CI | reports/NA-0055 e Actions | sim |
| Recuperação | Git temporário e árvore/hash original | Local/CI | relatório sem segredos | sim |
| Regras remotas | GET pós-aplicação e avaliação de PR | GitHub | snapshots privados | sim |
| Regressões | gates existentes do PR | CI | SHA do candidato | sim |

## Baseline
- Base SHA: 8eeef08b520a4ffde58cb0733b1e55ff7b247ef7; master limpa, origin/master igual.
- GitHub público; administrador disponível; rulesets vazio; nenhuma tag.
- NA-0054: 16 checks e 5 harnesses de navegador aprovados; publicação Windows ignorada por não ser release.

## Rollback ou recuperação
Reverter este PR por nova branch/PR. Configuração GitHub anterior preservada em relatório privado; restaurar somente campos alterados. Checkpoints nunca são movidos/reutilizados. Recuperar código em pasta nova; dados/configurações exigem backup próprio e compatibilidade antes de troca operacional.

## Mudanças de escopo e decisões
Pedido atual autoriza implementação fim a fim, GitHub organizado e registros por IA. Configuração de proteção sem exigir aprovação de participação obrigatória de outra pessoa será explicitada; revisão técnica independente continua obrigatória no fluxo assistido.

## Aprovação
- Decisão: `GO_WITH_RISKS`
- Aprovado por: jefersonfq, autorização explícita no pedido desta frente para ajustes autônomos e organização do GitHub.
- Aprovado em: 2026-10-11; não implica homologação humana de release.
