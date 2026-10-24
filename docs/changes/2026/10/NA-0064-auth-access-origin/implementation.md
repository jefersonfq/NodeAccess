# NA-0064 — Registro da implementação

## Pedido e objetivo
Implementar e validar indicação de origem no histórico de autenticação após a avaliação da ambiguidade gateway/site.

## Implementação
Base SHA: 66444a9dd4c167453004bb6089278548bdd2c0d9.
LogsView.vue ganha coluna independente de evento/IP/status. Helper auth-access-origin.ts classifica marcador exato, navegador reconhecível e dados inconclusivos. Agentes de API/bots conhecidos permanecem desconhecidos. Dica nativa única e aria-label informam limite da inferência; User-Agent técnico permanece acessível. Tabela recebe rolagem horizontal contida e skeleton com seis colunas. Locales pt-BR/en e scripts de teste dedicados adicionados. Sem mudanças no backend, schema, autenticação ou operação remota. Preservadas alterações anteriores do workspace.

## Validação
Ran: Vitest helper + log.service.test.ts — 21 testes aprovados.
Ran: Playwright — quatro combinações claro/escuro × 390/1440; cinco registros simulados (gateway, navegador, ausente, curl e texto HTML). IP/status preservados, foco, ausência de overflow na página, erro 503, retry e lista vazia passaram. Nenhum erro JavaScript.
Manual: capturas dark-1440 e light-390 inspecionadas; tabela rola internamente em celular. Evidências /tmp/nodeaccess-auth-access-origin/report.json e PNGs.
Ran: typecheck frontend e git diff --check passaram.
Skipped: banco/servidor KingHost e SSH real; não necessários para mudança de apresentação. Nenhuma publicação.

## Recuperação
Reverter somente coluna, helper, traduções e testes desta frente. Nenhuma migração ou transformação de dados históricos.

## Pendências
Nenhuma pendência de implementação. Limitação funcional conhecida: classificação histórica é inferida de dado potencialmente informado pelo cliente, não uma prova de canal. Campo de origem confiável no servidor fica fora deste escopo.

## Diário de interações
### 2026-10-23T09:11:36-03:00 — Implementação autorizada
Coluna e classificação implementadas; testes unitários/E2E e revisão visual passaram. Próximo passo: finalizar verificação de tipos e registrar entrega local.

### 2026-10-23T09:11:44-03:00 — Fechamento
Typecheck e diff check concluídos sem erros. Entrega local pronta para revisão; sem commit, deploy ou alteração no servidor KingHost.
