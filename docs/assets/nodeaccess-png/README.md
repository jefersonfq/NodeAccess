# NodeAccess — assets PNG

Exportações PNG da identidade visual do NodeAccess para documentação, apresentações e integrações que não aceitam SVG.

Os arquivos canônicos para uso geral são:

- símbolo: `nodeaccess-mark-512.png`, reduzido proporcionalmente conforme necessário;
- logo horizontal em fundo escuro: `nodeaccess-wordmark-dark-1024x256.png`;
- logo horizontal em fundo claro: `nodeaccess-wordmark-light-1024x256.png`;
- contratos e documentos brancos: `nodeaccess-logo-stylized-contract-white.png`.

Prefira o SVG existente no frontend quando o canal suportar formato vetorial. Não amplie PNGs além da dimensão nativa.

## Inventário

| Arquivo | Dimensão | Fundo/canal | Uso recomendado |
|---|---:|---|---|
| `favicon-16.png` | 16 × 16 | transparente (RGBA) | favicon legado 16 px |
| `favicon-32.png` | 32 × 32 | transparente (RGBA) | favicon padrão |
| `favicon-48.png` | 48 × 48 | transparente (RGBA) | atalhos e navegadores |
| `nodeaccess-mark-64.png` | 64 × 64 | transparente (RGBA) | símbolo pequeno |
| `nodeaccess-mark-128.png` | 128 × 128 | transparente (RGBA) | integrações e perfis |
| `nodeaccess-mark-192.png` | 192 × 192 | transparente (RGBA) | atalhos e PWA |
| `nodeaccess-mark-256.png` | 256 × 256 | transparente (RGBA) | apresentações |
| `nodeaccess-mark-512.png` | 512 × 512 | transparente (RGBA) | símbolo canônico raster |
| `nodeaccess-sidebar-mark-64.png` | 64 × 64 | transparente (RGBA) | referência da sidebar compacta |
| `nodeaccess-sidebar-mark-256.png` | 256 × 256 | transparente (RGBA) | referência ampliada da sidebar |
| `nodeaccess-wordmark-dark-1024x256.png` | 1024 × 256 | transparente (RGBA) | texto claro em fundo escuro |
| `nodeaccess-wordmark-light-1024x256.png` | 1024 × 256 | transparente (RGBA) | texto escuro em fundo claro |
| `nodeaccess-logo-stylized-transparent.png` | 1794 × 441 | transparente (RGBA) | sites, propostas e apresentações |
| `nodeaccess-logo-stylized-contract-white.png` | 1794 × 441 | fundo branco opaco (RGB) | contratos e documentos brancos |

## Marca principal

- `nodeaccess-mark-64.png`
- `nodeaccess-mark-128.png`
- `nodeaccess-mark-192.png`
- `nodeaccess-mark-256.png`
- `nodeaccess-mark-512.png`

Fonte: `apps/frontend/public/favicon.svg`. O mesmo símbolo de dois servidores é usado no favicon e no login.

## Favicons

- `favicon-16.png`
- `favicon-32.png`
- `favicon-48.png`

## Sidebar compacta

- `nodeaccess-sidebar-mark-64.png`
- `nodeaccess-sidebar-mark-256.png`

Representação PNG do ícone de um servidor renderizado diretamente em `AppLayout.vue`.

## Logo horizontal

- `nodeaccess-wordmark-dark-1024x256.png`: texto branco para fundo escuro.
- `nodeaccess-wordmark-light-1024x256.png`: texto escuro para fundo claro.

O frontend atual renderiza `NodeAccess` como texto HTML, não como imagem. Estes dois arquivos são exportações equivalentes para documentação, apresentações e integrações externas.

## Logo estilizada

- `nodeaccess-logo-stylized-transparent.png`: versão principal com transparência para sites, propostas e apresentações.
- `nodeaccess-logo-stylized-contract-white.png`: versão pronta sobre fundo branco para contratos e documentos.

Esta proposta foi gerada com apoio de IA a partir da marca oficial, preservando o símbolo de dois servidores, o gradiente azul/índigo e a grafia exata `NodeAccess`. Antes de substituir a identidade oficial em produção, recomenda-se aprovação de marca e validação de impressão.

Não use a versão com fundo branco sobre superfícies coloridas. Não recorte o símbolo, altere a proporção, aplique efeitos adicionais ou troque as cores sem uma revisão de identidade visual.

## Cores

- Azul inicial: `#3b82f6`
- Índigo final: `#6366f1`
- Texto escuro: `#18181c`
- Texto claro: `#ffffff`

Os PNGs foram rasterizados pelo Chromium para preservar a aparência do SVG no navegador.
