# NA-0059 — Cards compactos de acesso rápido

## Objetivo
Compactar Favoritos e Recentes em /hosts preservando identificação, permissões e acesso por teclado.

## Implementação
Nome preservado; endereço, pasta e relógio com data DD/MM agrupados. Pasta muda de linha quando necessário. Protocolo representado por SVG no canto superior direito do card, com tooltip por mouse, clique e foco no card. Sem selo/linha inferior para protocolo; sessão ativa permanece visível quando aplicável. Horário disponível por hover, foco no card e toque no relógio sem conectar; Esc fecha a dica. _root_ é exibido como Raiz, com dica de diretório raiz do inventário.

## Escopo
QuickAccessHostCard.vue e HostProtocolIcon.vue, regressão Playwright existente, capítulo de Hosts e evidências do manual. Sem mudanças em transporte, terminal, autorização ou dependências.

## Validação
Typecheck e lint do componente; regressão focada em 1440/1024/390 px, hover/foco/Esc/toque, permissão, sessão ativa, falha de metadados, IPv6 e ausência de pasta. Capturas do manual e gate editorial executados. A suíte completa de acessos recentes apresentou timeout no cenário de recuperação de pastas; a execução focada passou.

## Entrega
Alterações locais na branch feat/NA-0059-quick-access-compact, sem commit ou publicação.

## Caminho das pastas
Tooltip da pasta exibe a hierarquia carregada, por exemplo Raiz → Banco de dados → Dbs. Card mantém o nome imediato. Caminhos incompletos não inventam ancestrais; nenhuma chamada adicional à API.
