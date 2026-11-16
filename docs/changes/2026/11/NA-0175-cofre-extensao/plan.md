---
change_id: NA-0175
title: VaultNAccess fase 1A — catálogo unificado de Secrets e PEM
type: feature
status: closed
created_at: 2026-11-15T16:28:40-03:00
base_branch: master
base_sha: ae188983d061a7bb5e6aaf855fd9d2f92416f3b8
branch: feature/NA-0175-20261115-vaultnaccess
owner: unassigned
planner: Codex
risk: medium
---

# NA-0175 — VaultNAccess fase 1A

## Contexto e situação anterior
Base consolidada pela PR65, master limpa ae188983d. Secrets e PEM possuem telas/APIs separadas. Planejamento amplo em assessment.md, vaultnaccess-addendum.md e hybrid-delivery-review.md; as restrições de avaliação inicial foram superadas pela autorização explícita de implementar itens1/2/3 fim a fim.

## Problema e objetivo
Entregar catálogo único VaultNAccess, preservando autorização/licenças, formulários e integrações operacionais existentes, com baseline e regressão verificadas.

## Escopo
Tela /vault, navegação única, catálogo tipado, busca/filtro por tipo e revogação, ações por tipo usando editores reutilizados. Rotas /secrets e /pem-keys continuam funcionais. Carregamento independente por origem, estados de erro parcial, falha fechada da licença Secrets e descarte de respostas antigas em troca de contexto. Sem novas APIs/backend/cripto/sessão, sem reveal/autofill/plugin nesta fase. SSH/RDP, terminal, snippets/aliases e resolução server-side preservados.

## Critérios de aceitação
- [x] Catálogo único com IDs compostos e metadados públicos; mesmo ID numérico entre tipos não colide.
- [x] Busca/filtros e estados loading/vazio/erro parcial/retry acessíveis em desktop/mobile.
- [x] Licença conferida antes de Secrets; falha de features não libera Secrets nem impede PEM autorizado.
- [x] Ações/formulários específicos reutilizados e rotas legadas preservadas, com ACL existente.
- [x] Contexto antigo não repopula catálogo/drafts após troca de tenant, revogação de feature ou unmount.
- [x] Testes de contratos e regressão terminal/snippets, build/typecheck/lint, manual e Sonar aplicáveis registrados.
- [x] Revisão independente e evidência visual antes de prontidão; nenhuma aprovação humana presumida.

## Estratégia técnica
Catálogo e carregamento separados da tela, união discriminada Secret/PEM, schemas públicos para retirar campos extras. Componentes de ações/modal específicos extraídos das telas atuais e reutilizados. Menu substitui as duas entradas por VaultNAccess mantendo os mesmos limites de visibilidade. Não modificar KeepAlive, transporte, auth ou cache global. API continua autoridade de acesso.

## Riscos e mitigações
| Risco | Mitigação |
|---|---|
| Exposição entre tenants/respostas antigas | Invalidação por geração/contexto, limpeza antes de reload, descarte após unmount e remount dos editores |
| Falha parcial confundida com catálogo vazio | Estado por origem, alertas e retry explícitos |
| Licença/ACL divergente | Gate anterior à consulta, ações consistentes com regras existentes, testes negativos |
| Regressão dos formulários | Extração focada e reutilização nas rotas legadas; testes de payload e browser |
| Terminal perder estado/foco | Layout/KeepAlive preservados e harness terminal-experience |

## Matriz de testes e evidências
| Critério | Testes |
|---|---|
| Contratos existentes | Secrets service/repository/controls, PEM service, snippets |
| Catálogo/estado | Unidade: colisões, campos privados extras, filtros, licença, falhas, corrida e unmount |
| Operações UI | Testes de editores e browser com API sintética, desktop/mobile/teclado/legado |
| Não regressão | terminal-experience e snippets; PTY somente se resize/transporte forem alterados |
| Manual | capture, revisão visual, test:manual e check-reviewed |
| Qualidade | typecheck, lint, build, validate:sonar e revisão independente |

## Baseline
SHA ae188983d061a7bb5e6aaf855fd9d2f92416f3b8, verificado por fetch e branch limpa. Baseline focal em .tmp/NA-0175/baseline.log. Não herdar aprovação de outras frentes para novo código.

## Rollback ou recuperação
Reverter somente UI/menu/rota e extração de editores; sem migração de dados, mudanças de serviços operacionais ou formato de armazenamento. Preservar branch e documentos da frente. Não restaurar backups de outras frentes sobre a base atual.

## Aprovação
- Decisão: GO_WITH_RISKS
- Aprovado por: usuário, implementação dos itens1/2/3 fim a fim e requisitos prévios de isolamento.
- Aprovado em: 2026-11-15T19:00:22-03:00
- Gates finais e homologação funcional não presumidos; segurança avançada/plugin seguem fases posteriores.

## Estado histórico antes dos gates finais
Itens1/2 implementados e validação focal do item3 executada; resultados em phase1a-evidence.md. Sonar completo pendente de execução no candidato autorizado; revisão estática PASS_WITH_WARNINGS, sem homologação/PR/merge desta frente. Critério de qualidade global permanece aberto.

## Correção necessária do gate
Primeiro candidato01f348977 falhou em timeout do bootstrap de fixtures, cobertura nova e cache local inacessível ao scanner. Ampliar testes comportamentais/SSR e reutilizar parsing porarquivo no harness é NECESSARY_CORRECTION da validação. Preservar timeout,44/10fixtures, denominador e threshold80%; produto permanece inalterado nesta remediação. Repetir gate integral em novo SHA; ver implementation.md.

## Correção necessária do check de fechamento

Após homologação confirmada, o check remoto de integração TLS expôs observação imediata do certificado durante reload assíncrono. Ajustar somente o harness para aguardar identidade exata dentro de5s, com handshake limitado, preservando validação CA/SNI, comparação com certificado anterior e sessãoSSH/WebSocket. Testes negativos e laboratório real obrigatórios; worker/produto inalterados. Classificação NECESSARY_CORRECTION do gate, revisão independente e nova validação do SHA antes do merge.

## Fechamento da fase 1A

PR66 integrada em f5bf34b148e64f5f18c4752c95cacf88978e67b7 e master local sincronizada em 2026-11-15T22:56:39-03:00. Homologação confirmada explicitamente pelo usuário; onze checks remotos e gate local aprovados no candidato 314e502ea7e049fb97ce38df04cd3286c1b3e807. Entrega somente do catálogo e editores; contrato e segurança futura seguem NA-0177. Evidências finais na PR66 e no registro.
