---
change_id: NA-0084
title: Passagem de plantão 3A e central de notificações
type: feature
status: in-development
created_at: 2026-10-30T10:58:23-03:00
base_sha: f4a44b4b7ae87a8f688b1246d9e52a31f9a104bc
risk: medium
---

# Plano — corte 3A

Pedido: explicar fase3, pesquisar práticas de mercado e recomendar formato prático. Escopo inicial foi descoberta documental; pedido posterior autorizou implementação3A e central de notificações conforme apêndice. Sem commit/publicação. ID reservado localmente após busca sem colisão; issue não criada.

Artefato: [PRD em descoberta](../../../../PRD-shift-handover-lite.md). Hipótese recomendada: registros de pendências/avisos com contexto/evidência e aceite, agrupados posteriormente por turno. MVP3A, resumo3B, assistência/integrações3C. Regras propostas, ainda não homologadas.

Aceite da descoberta: fontes primárias citadas e limites separados de recomendações; exemplo operacional; diferença entre aceite e resolução/ACL; matriz de cortes e testes futuros; decisões pendentes explícitas.

Ran: consulta à documentação pública e referências locais, revisão de links relativos e git diff --check. Skipped: testes de aplicação, pois só documentação. Planned: piloto com operadores, protótipo e especificação técnica após alinhamento. Esse resultado pertence à descoberta inicial; o corte 3A foi posteriormente autorizado e implementado conforme registro abaixo.

NA-0083 preservada LOCAL_WIP, sem commit/merge. Documentos desta descoberta ficam no workspace atual para não misturar a implementação em seu checkout. Rollback apenas dos documentos da NA-0084 e seus links; sem alteração de banco/configuração.

## Escopo aprovado para implementação — 2026-10-30T11:33:07-03:00

Usuário autorizou 3A fim a fim, UX simplificado, capturas entre usuários e central de notificações reutilizável, preparada para chat/tarefas/Jira futuros. GO_WITH_RISKS: pendência ligada a host com dono e destinatário, encaminhar/aceitar/devolver/cancelar/concluir e histórico; links de evidência autorizados; central in-app com não lidas/lidas e navegação para assunto. Leitura não aceita responsabilidade. Eventos duráveis e notificações persistidos atomicamente com mudança de estado, contratos versionados sem broker adicional. Futuras integrações podem consumir eventos; chat e sincronização Jira não implementados nesta entrega.

Código: /tmp/nodeaccess-NA-0084, branch feature/NA-0084-20261030-shift-handover. Base remota conferida via ls-remote e master tracking origin/master, SHA igual ao base acima; sem fetch/publicação. Worktree isolado para preservar dirty NA0081/82/83 e permitir implementação/revisão independente. Documentos canônicos permanecem docs do projeto atual.

Critérios: destinatário vê notificação e assume somente após ação; antigo dono permanece até aceite; transações/concorrência/retries não duplicam passagem/notificação; tenant/ACL revalidados inclusive notificações e evidências; erros locais preservam rascunho; mobile/teclado legíveis; sem alteração transporte SSH. Testes: baseline direcionado; unitários/rotas; MySQL real para migração e transação; browser2usuários com prints; builds/lint; revisão independente. AppLayout mapeado no manual exige revalidação/manual:capture; verificar área útil terminal e executar regressão pertinente. Rollback código preserva tabelas aditivas, sem apagar histórico/dados; não fazer rollback destrutivo.

## Resultado local

Implementação e validações técnicas concluídas; status LOCAL_WIP, aguardando homologação humana e publicação. Ver [evidências](test-results.md), [UX entre usuários](ux-walkthrough.md) e [registro](implementation.md). Nenhuma publicação/deploy executada.

## Evolução autorizada — 2026-10-30T14:08:33-03:00

Continuação da mesma frente NA-0084, sem commit/publicação, preservando baseline 3A. GO_WITH_RISKS. Usuário autorizou implementação fim a fim, prints/simulações e avaliação de fluxo, didática e densidade visual, incluindo quadro consolidado por tenant/grupo, relatório e integração nos dashboards.

Corte: filtros pessoais existentes com host/prioridade/status; revisar até opcional e vencimento; lembrete agrupado configurável de passagens sem aceite (sem disparos externos); histórico com snapshot de contexto/próximo passo nos novos eventos; quadro de gestão com totais, pessoas, hosts, pendentes/vencidos/aguardando aceite e histórico, filtros por grupo/pessoa/host; relatório CSV do mesmo recorte autorizado; resumos compactos no dashboard pessoal e do host.

Permissões: ADMIN do tenant acessa quadro geral e delega leitura via concessões explícitas por usuário para tenant ou grupo existente. Concessão de grupo cobre registros cujo responsável atual ou destinatário pendente pertence ao grupo; não amplia ACL do host nem auditoria; gestor autorizado pode ler contexto mas não editar/aceitar em nome de outro. Revogação vale na próxima requisição; contagens/exportação usam a mesma seleção autorizada. Grupos referem-se a grupos de usuários, não à pasta/equipe do host.

Relatório útil como fotografia operacional, não como ranking de produtividade; CSV evita fórmulas, informa filtros/data/limites e exclui segredos e texto livre de auditoria. Dashboard mostra contadores e poucos itens com acesso ao quadro/histórico; não duplicar a tabela completa. Chat, comentários, sincronização Jira, escala de turnos e envio externo permanecem fora deste corte, conforme priorização anterior.

Aceite: nenhum vazamento entre tenants/grupos/ACL; concessão só por admin e sem elevar permissão de ação; filtros/composição corretos e datas com timezone; lembrete não transfere dono nem cria ruído por item; snapshots antigos ausentes identificados; CSV e contagens consistentes; estados vazio/erro/carregamento/sem permissão, mobile e teclado; dashboards discretos; simulação entre operador, gestor e admin, com capturas e revisão independente.

Testes: baseline core, unitários de filtros/acesso/snapshot/prazos, API/MySQL real com concessão/revogação/grupos/exportação, browser e capturas desktop/mobile, builds/lint/manual/regressão terminal. Documentos canônicos em docs do projeto atual. Migração aditiva em laboratório; rollback preserva dados.

## Resultado da evolução — 2026-10-30T14:35:29-03:00

Critérios implementados e tecnicamente validados; LOCAL_WIP, humano/publicação pendentes. [Evidências atuais](evolution-test-results.md), [capturas e UX](evolution-ux.md). Nenhuma integração Jira/chat/envio externo implementada.

## Integração no terminal autorizada — 2026-10-30T14:53:06-03:00

GO_WITH_RISKS. Continuação NA-0084 no mesmo branch/base; usuário autorizou implementar a avaliação terminal-indicator-assessment.md fim a fim com testes, simulações, prints e UX. Sem publicação/commit/VPS.

Corte: indicador discreto de pendências abertas autorizadas do host ativo na barra existente, consulta compacta HTTP com limite explícito, janela flutuante somente leitura com descrição do host/contexto/próximo passo/responsável/prazo e link detalhe nova aba. X/Escape e foco restaurado; fechar não conclui. Host/tenant/identidade/ACL revalidados; cache curto só em memória e resposta atrasada descartada. Sem timer por sessão, consulta não bloqueia SSH e não busca histórico completo. Split acompanha painel ativo. Overlay dentro do fullscreen sem alterar geometria/xterm/PTY/transporte.

Aceite: indicador não revela notas sem participação/grant/ACL; uma consulta deduplicada por host/contexto no TTL; painel força atualização; troca dehost limpa/fecha; erro não ézero; teclado não vaza input SSH; geometria/rows/cols/conexão mantidas; foco/copy/Escape/fullscreen/mobile testados; componentes desacoplados e densidade baixa. Nova migração/dependência não prevista.

Validações: baseline core128, baseline/regressão terminal-experience:web, unidades de seleção/cache/contexto; API/MySQL real isolamento/limite/grant/host; harness terminal com websocket simulado e interceptação de input/resize/reconexão; capturas desktop/mobile/fullscreen; builds/lint/manual e revisão independente. PTY real somente se o trabalho alterar resize/transporte, o que o desenho evita. Rollback reverte apenas componente/consulta nova, preservando dados.
