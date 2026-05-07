# PRD SSHS-like Host Switcher Lite

## Objetivo
Simular no NodeAccess o comportamento central do `sshs`: localizar rapidamente um host SSH e abrir a conexao sem sair do fluxo de terminal.

## Referencia
`sshs` e uma TUI para SSH que lista entradas do `~/.ssh/config` e conecta no host escolhido.

No NodeAccess, a equivalencia deve usar hosts cadastrados e autorizados pela plataforma, nao arquivos locais do usuario.

## Problema
Tecnicos alternam entre varios hosts durante uma operacao. Voltar para a tela de `Hosts` para cada nova conexao aumenta atrito, quebra foco e reduz o valor do terminal como centro operacional.

## Principios
- respeitar visibilidade e permissao existentes
- buscar somente hosts que o usuario autenticado pode acessar
- abrir conexao pelo fluxo normal do produto
- nao expor segredo, usuario, senha ou PEM no frontend
- manter revalidacao no gateway SSH
- priorizar teclado e baixa friccao
- preservar favoritos e recentes

## Escopo
### Em escopo inicial
- picker rapido dentro do terminal
- busca por nome e IP/hostname
- navegacao por teclado com setas, Enter e Esc
- destaque de favoritos e recentes
- abertura em nova aba/sessao de terminal
- estado vazio claro
- busca server-side para evitar limitar o usuario aos primeiros hosts carregados

### Fora de escopo inicial
- importar `~/.ssh/config`
- parsing de `ProxyCommand`
- split automatico
- fuzzy search avancada
- comandos automaticos ao conectar
- alteracao no gateway SSH

## Regras de seguranca
- A listagem deve usar `GET /hosts`, que ja filtra por tenant, escopo, dono, grupo e global.
- A abertura da sessao deve continuar usando `hostId`.
- O backend deve revalidar acesso no gateway antes da conexao SSH.
- O frontend nao deve receber senha, PEM ou secret resolvido.
- Hosts sem acesso nao podem aparecer no picker nem abrir via manipulacao manual.

## UX
- Entrada por botao na toolbar do terminal.
- Entrada por atalho configurado do terminal.
- Campo de busca focado ao abrir.
- Lista compacta, orientada a teclado.
- `Enter` abre o item selecionado.
- `Esc` fecha e devolve foco ao terminal ativo.
- Favoritos e recentes aparecem com badges, sem esconder a lista completa.

## Estados
- loading: enquanto carrega hosts
- vazio: nenhum host visivel ou nenhum resultado para busca
- sucesso: nova aba aberta e host marcado como recente
- erro: falha ao carregar hosts deve manter modal aberto com feedback claro

## Arquivos esperados
- `apps/frontend/src/views/TerminalView.vue`
- `apps/frontend/src/services/host.service.ts`
- `apps/backend/src/modules/hosts/*`
- `apps/backend/src/modules/ssh/ssh.gateway.ts`

## Validacao rapida
1. Abrir terminal.
2. Abrir o picker pelo botao `Hosts`.
3. Buscar por nome e IP.
4. Navegar com setas.
5. Pressionar `Enter`.
6. Confirmar abertura de nova aba.
7. Testar usuario sem acesso e confirmar que o host nao aparece.

## Riscos
- Se a busca ficar apenas no cliente, usuarios com muitos hosts podem nao encontrar itens fora do limite carregado.
- Se uma futura chamada direta a `GET /hosts/:id` for usada antes de abrir o terminal, validar acesso a hosts de equipe com grupos do usuario.
- Se o picker crescer demais, separar componente sem alterar o gateway.
