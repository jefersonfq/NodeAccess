# PRD Lite - Platform Adoption

Versao curta para melhorias de aderencia em Windows, Linux e macOS.

## Objetivo
- reduzir friccao de entrada por sistema operacional
- aproximar a UX das expectativas de quem vem de clientes desktop
- aumentar adocao sem aumentar complexidade de operacao

## Escopo inicial
- detectar plataforma no frontend
- adaptar textos de atalhos e hints por SO
- oferecer presets de terminal por plataforma
- salvar preferencias de UX por usuario
- mostrar onboarding curto no primeiro uso

## Perfis de plataforma
- Windows: foco em `Ctrl`, `Ctrl+Insert`, `Shift+Insert`, PowerShell e OpenSSH do Windows
- Linux: foco em `Ctrl+Shift+C/V`, fontes monospace comuns e comportamento classico de terminal
- macOS: foco em `⌘`, `⌥`, fontes Apple e convencoes de Terminal/iTerm

## Regras de produto
- comportamento base deve continuar consistente entre plataformas
- diferencas por plataforma devem ficar em camada de UX, nao em regra de negocio
- a deteccao de plataforma nao pode bloquear uso manual de preferencia customizada
- usuario deve poder trocar preset depois do onboarding
- defaults devem ser seguros; nada de expor segredos ou facilitar paste acidental em modo sensivel

## Quick Wins
- atalhos renderizados dinamicamente por plataforma
- preset inicial de fonte e tema por SO
- card de onboarding com dicas curtas por plataforma
- preferencia persistida para copy mode, fonte, tema e atalhos
- mensagens de erro e ajuda com linguagem mais proxima do ecossistema do usuario

## O que adicionar para aumentar adocao
### 1. Favoritos e recentes
- permitir favoritar hosts
- mostrar `Recentes` e `Favoritos` no topo da tela de hosts
- reduzir tempo entre abrir a ferramenta e entrar no host mais usado
- manter implementacao desacoplada da regra de host:
  - preferencia por usuario
  - persistencia propria

### 2. Home operacional curta
- criar uma visao inicial simples para o usuario com:
  - hosts recentes
  - favoritos
  - sessoes abertas
  - acessos locais recentes
- objetivo:
  - fazer o usuario sentir valor antes mesmo de navegar pela arvore completa
- evolucao natural:
  - tratar essa frente como `dashboard pessoal`, separada do dashboard admin
  - detalhe curto em `docs/PRD-user-dashboard-lite.md`

### 3. Fluxo de primeiro sucesso
- apos login inicial, guiar o usuario para conseguir uma primeira conexao com o menor numero de cliques
- exemplos:
  - `conectar no host recomendado`
  - `abrir minha ultima sessao`
  - `ver como usar snippets`
- foco em `time-to-first-success`, nao em tutorial longo

### 4. Descoberta de produtividade
- destacar melhor funcoes que aceleram o dia a dia:
  - snippets
  - acessos locais
  - fullscreen
  - sessao propria
  - sessao ao vivo
- usar hints pequenos e contextuais, nao tour intrusivo

### 5. Preferencias de UX por usuario
- continuar evoluindo preferencias locais de forma modular:
  - modo de exibicao dos hosts
  - densidade visual
  - comportamento de terminal
  - modo de acoes rapidas
- objetivo:
  - fazer a ferramenta se adaptar ao perfil do usuario

### 6. Templates de trabalho por time
- permitir assets de produtividade por grupo ou tenant:
  - snippets recomendados
  - hosts favoritos do time
  - acessos locais frequentes
- isso acelera onboarding de novos usuarios e reduz dependencia de conhecimento informal

### 7. Busca e acesso rapido melhores
- reforcar busca global e command palette como atalho primario
- objetivo:
  - permitir que usuario experiente use a plataforma quase sem mouse

### 8. Estados vazios e mensagens de ajuda melhores
- cada tela principal deve explicar o proximo passo natural
- exemplos:
  - sem hosts
  - sem acesso ao grupo
  - sem snippets
  - sem forwardings
- ajuda curta e orientada a acao aumenta conversao de uso

### 9. Retomada e continuidade
- se fizer sentido para a politica segura:
  - mostrar claramente o que estava aberto por ultimo
  - facilitar voltar para hosts/sessoes recentes
  - reduzir sensacao de "preciso recomeçar tudo"

### 10. Visibilidade de valor para o admin
- criar sinais simples de adocao:
  - usuarios ativos por periodo
  - hosts mais acessados
  - uso de sessao ao vivo
  - uso de snippets e acessos locais
- isso ajuda patrocinio interno e priorizacao do produto

## Prioridade sugerida
### Agora
- favoritos e recentes
- descoberta de produtividade
- melhorias de estados vazios

Status atual:
- primeiro corte de `Favoritos` e `Recentes` pode ser local por navegador, sem dependencia de backend
- exibicao recomendada:
  - secoes proprias na sidebar de `Hosts`
  - marcacao por estrela no item do host
  - lista de recentes atualizada ao conectar
- se o uso provar valor, a persistencia server-side por usuario pode vir depois
- estado atual implementado:
  - `Favoritos` e `Recentes` na sidebar de `Hosts`
  - bloco de `Acesso rapido` no topo da tela
  - destaque por estrela no host
  - `Recentes` atualizado ao conectar
  - estados vazios melhores para `Favoritos`, `Recentes` e falta de acesso
  - bloco de `Atalhos de produtividade` no topo da tela
  - blocos superiores com UX de `recolher/expandir`, evitando poluicao visual
  - hints curtos de copy/paste por plataforma no topo do terminal
  - atalho visivel para reaplicar o preset recomendado do SO atual no terminal
  - preferencias de terminal e hosts sincronizadas por usuario autenticado, com cache local no navegador

### Curto prazo recomendado
- avaliar persistencia em banco para:
  - favoritos do usuario
  - recentes do usuario
  - preferencia de exibicao da tela de hosts
- recomendacao de arquitetura:
  - manter cache local no frontend para resposta imediata
  - usar backend como fonte de verdade por usuario autenticado
  - nao misturar isso com regra de host; tratar como preferencia/uso do usuario
- isso faz sentido principalmente para:
  - continuidade entre dispositivos
  - menor perda de contexto ao trocar navegador
  - aumento de adocao em uso recorrente

Status deste item:
- preferencia de exibicao da tela de hosts ja persistida no backend por usuario
- preferencias de terminal agora persistidas no backend por usuario:
  - preset
  - tamanho/familia de fonte
  - tema
  - botao direito / copy mode
  - confirmacao de colagem multilinha
  - auto fullscreen
  - atalhos de snippets e host switcher
- preferencia de tema da interface web agora persistida no backend por usuario:
  - claro
  - escuro
- favoritos e recentes agora persistidos no backend por usuario:
  - lista de favoritos
  - ultimos hosts acessados
  - cache local mantido para resposta imediata
- estado de UX da tela de hosts agora persistido no backend por usuario:
  - bloco de `Acesso rapido` recolhido/expandido
  - bloco de `Atalhos de produtividade` recolhido/expandido

### Depois
- home operacional curta / dashboard pessoal
- templates de trabalho por time
- sinais de adocao para admin

### Mais tarde
- continuidade mais forte entre sessoes
- densidade visual e preferencia por dispositivo mais refinadas

## Adoção para perfil tecnico de terminal
### Objetivo
- reduzir a estranheza de quem vem de terminal nativo no Windows, Linux e macOS
- aumentar confianca em copiar, colar, navegar e operar sem friccao

### Itens com maior impacto percebido
#### 1. Copy/paste por plataforma
- reforcar comportamento natural por SO:
  - Windows: `Ctrl+Insert` / `Shift+Insert`, `Ctrl+C` em contexto adequado
  - Linux: `Ctrl+Shift+C` / `Ctrl+Shift+V`
  - macOS: `⌘C` / `⌘V`
- mostrar hints curtos e contextuais, sem poluir a tela
- evitar conflito entre selecao de texto e colagem no terminal

#### 2. Colagem multilinha com guardrail
- ao detectar paste com varias linhas:
  - mostrar confirmacao curta antes de enviar
  - opcionalmente destacar quantidade de linhas
- objetivo:
  - evitar envio acidental de blocos perigosos
  - aumentar confianca do tecnico sem tirar velocidade

#### 3. Onboarding curto de terminal
- focar em operacao, nao em explicacao de produto
- pontos principais:
  - copiar
  - colar
  - buscar no terminal
  - fullscreen
  - snippets
  - arquivos

#### 4. Reaplicar preset por plataforma com facilidade
- deixar visivel no perfil e no terminal:
  - qual preset esta ativo
  - como reaplicar o recomendado para o SO atual
- isso ajuda especialmente quem alterna de maquina ou mexe nas preferencias
- primeiro corte implementado:
  - hint discreto no topo do terminal com `copiar`, `colar` e `buscar`
  - botao curto de `preset` para reaplicar o recomendado do sistema atual

#### 5. Estados operacionais muito claros
- indicador confiavel de:
  - conectado
  - desconectado
  - sessao ao vivo
  - input espelhado
  - controle ativo por outro participante
- tecnico adota mais quando confia no estado da ferramenta

#### 6. Qualidade de renderizacao
- manter experiencia forte em:
  - `htop`
  - `top`
  - `watch`
  - `vim`
  - `less`
- fullscreen, resize e foco precisam parecer naturais

#### 7. Snippets e produtividade de time
- destacar melhor snippets pessoais e do time
- permitir que times tenham comandos-base recomendados
- isso acelera onboarding e gera valor no primeiro uso
- proximo corte recomendado:
  - abrir snippets do terminal com um atalho rapido
  - objetivo:
    - reduzir cliques para comandos recorrentes como login em MySQL, acesso a usuario especifico e sequencias operacionais salvas
  - proposta de UX:
    - manter o atalho atual como default seguro
    - oferecer `Ctrl+Espaco` como opcao configuravel, no estilo MobaXterm
    - permitir desativar o atalho no perfil por usuario
  - ressalva tecnica:
    - `Ctrl+Espaco` pode conflitar com IME, troca de idioma e autocomplete em alguns ambientes
    - por isso, o desenho recomendado e:
      - preset de atalho
      - fallback configuravel
      - implementacao desacoplada do terminal base
  - decisao validada:
    - default continua no atalho atual do terminal
    - `Ctrl+Espaco` entra como preferencia opcional do usuario
    - preferencia fica local no curto prazo, junto das demais preferencias do terminal

## Proposta adicional validada
### Atalho rapido para snippets no terminal
- faz sentido como frente de adocao para publico tecnico
- comportamento desejado:
  - abrir um seletor/painel leve com snippets permitidos para aquele usuario
  - filtrar snippets pessoais e de equipe que ele realmente pode usar
  - permitir Enter para enviar direto ao terminal ativo
  - manter foco em produtividade, nao em navegacao para outra tela
- recomendacao de implementacao:
  - camada propria de `snippet quick picker`
  - reaproveitar fonte de dados existente de snippets
  - nao acoplar ao fluxo principal de conexao SSH
  - esconder completamente a UX se snippets estiverem desabilitados ou vazios
- primeiro corte implementado:
  - quick picker de snippets no terminal
  - busca, preview e envio rapido por `Enter`
  - atalho configuravel por usuario

### Quick switcher de hosts no terminal
- faz sentido como frente de adocao e UX para usuarios tecnicos
- comportamento desejado:
  - abrir uma busca simplificada de hosts sem sair do terminal
  - destacar favoritos e recentes
  - permitir abrir host em nova sessao com poucos cliques ou so pelo teclado
- recomendacao de UX:
  - entrada principal por atalho e botao explicito
  - hover no canto superior apenas como opcional futuro
  - preferencia por usuario para habilitar/desabilitar a experiencia
- recomendacao de implementacao:
  - reaproveitar o padrao do quick picker de snippets
  - reaproveitar favoritos/recentes de hosts
  - manter a abertura de host pelo fluxo normal do terminal
  - evitar backend novo no primeiro corte
- detalhe curto em `docs/PRD-terminal-host-switcher-lite.md`
  - o atalho de snippets no terminal abre um `quick picker`
  - o painel lateral de snippets continua disponivel como fluxo secundario
  - o picker faz busca local, mostra nome, escopo e preview do comando
  - `Enter` envia o primeiro resultado para o terminal ativo

## Prioridade sugerida para esse perfil
### Agora
- copy/paste por plataforma mais claro
- guardrail de colagem multilinha
- onboarding curto focado em terminal

### Depois
- persistencia server-side de favoritos/recentes/preferencias
- snippets recomendados por time
- retomada visual de contexto de sessao

### Mais tarde
- refinamentos finos de renderizacao por SO
- preferencias mais avancadas por dispositivo

## Arquivos provaveis
- `apps/frontend/src/composables/useTerminal.ts`
- `apps/frontend/src/components/TerminalPane.vue`
- `apps/frontend/src/views/TerminalView.vue`
- `apps/frontend/src/views/HostsView.vue`
- `apps/frontend/src/views/auth/LoginView.vue`
- `apps/frontend/src/stores/ui.ts`
- `apps/frontend/src/services/settings.service.ts`
- `apps/frontend/src/locales/pt-BR.json`
- `apps/frontend/src/locales/en.json`

## Fora do escopo inicial
- suporte funcional a RDP ou WinRM
- shell remoto especifico por SO no backend
- deteccao profunda de layout de teclado
- sincronizacao de preferencia por dispositivo

## Ordem recomendada de implementacao
1. atalhos e labels por plataforma
2. presets e preferencias persistidas
3. onboarding curto
4. diagnostico rapido por plataforma
