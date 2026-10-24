# NA-0063 — Acesso rápido consistente no dashboard

## Objetivo
Padronizar favoritos e recentes do dashboard do usuário com o acesso rápido de Hosts.

## Escopo
Reutilizar QuickAccessHostCard com ícone de protocolo, pasta/caminho, data compacta e sessão ativa. Preservar navegação, permissões e remoção de favorito. Carregar pastas pelos serviços existentes, tolerando falhas sem ocultar hosts. Atualizar manual e testes existentes.

## Validação
Playwright em desktop, tablet e mobile, temas claro/escuro, tooltip, ACL, caminho de pastas, falhas de metadados e remoção de favoritos. Typecheck, testes de datas/caminhos e manual. Nenhuma alteração de transporte/terminal.
