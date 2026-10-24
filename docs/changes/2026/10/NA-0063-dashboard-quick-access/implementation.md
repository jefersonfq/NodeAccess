# NA-0063 — Registro da implementação

## Pedido e objetivo
Aplicar ao dashboard do usuário o padrão visual e de interação do acesso rápido de /hosts.

## Implementação
Base SHA: 66444a9dd4c167453004bb6089278548bdd2c0d9.
DashboardView.vue reutiliza QuickAccessHostCard, carrega pastas por inventoryService/hostService e resolve caminhos com hostFolderBreadcrumb. Favoritos e recentes recebem os mesmos metadados. Remover favorito fica em botão separado para evitar botões aninhados. Hosts sem permissão de conectar ficam desabilitados. Nenhuma dependência ou endpoint novo; outras mudanças do workspace preservadas.
Manual Hosts passa a mapear também DashboardView; harness recent-host-access recebe verificações do dashboard.

## Validação
Ran: typecheck frontend passou.
Ran: Vitest datas e caminhos — 10 testes passaram.
Ran: test:manual — 2 testes Node e 18 Vitest passaram.
Ran: Playwright claro e escuro — desktop 1440, tablet 1024 e mobile 390 passaram com fixtures HTTP/WebSocket. Rodada clara também confirmou falhas de datas/pastas, remoção sem conectar e favoritos vazios. Evidências /tmp/nodeaccess-recent-host-access e /tmp/nodeaccess-dashboard-light.
Ran: manual:capture passou (cinco imagens, manual, compartilhamento e troca de tenant). Rodada inicial interrompida por variável de versão incorreta; repetida com MANUAL_EXPECTED_VERSION=dev.
Limitações: testes de navegador simulados; nenhuma conexão SSH ou escrita em produção.

## Recuperação
Reverter apenas os trechos desta frente em DashboardView, harness e documentação. Sem migration ou mudança de configuração. Nenhum commit/publicação.

## Pendências
Nenhuma pendência de implementação. Sem validação contra produção.

## Diário de interações
### 2026-10-23T08:56:08-03:00 — Padronização solicitada
Implementação e testes concluídos. Próximo passo: finalizar revisão visual e evidências.

### 2026-10-23T08:56:38-03:00 — Fechamento
Capturas claro/escuro desktop/mobile e cinco capturas do manual inspecionadas. manual:check-reviewed e git diff --check passaram. Registro editorial atualizado apenas para Hosts. Implementação disponível no workspace, sem commit ou publicação.
