# PRD Lite - Platform Adoption

Versao curta para melhorias de aderencia em Windows, Linux e macOS.

## Objetivo
- reduzir friccao de entrada por sistema operacional
- aproximar a UX das expectativas de quem vem de clientes desktop
- aumentar adocao sem aumentar complexidade de operacao
- medir jornadas completas, distinguindo descoberta, compreensao, falha operacional e valor recorrente
- usar evidencias sanitizadas de uso para orientar melhorias continuas de UX e produto

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

## Inteligencia continua de adocao e experiencia

### Objetivo
- evoluir da contagem de telas e acoes isoladas para jornadas com inicio, resultado e recuperacao
- identificar onde o usuario abandona, repete uma acao, encontra erro ou demora alem do esperado
- recomendar melhorias com evidencia, tamanho de amostra e criterio de sucesso
- reaproveitar a telemetria e os relatorios existentes sem misturar analytics de produto com auditoria de seguranca

### Principio de medicao
Cada fluxo prioritario deve ser representado por quatro momentos:

`Intencao -> Acao -> Resultado -> Recuperacao`

Uma visita de tela ou clique nao representa sucesso. O resultado da jornada deve ser confirmado pelo estado real do backend sempre que possivel.

Exemplos:
- agente: criar -> escolher plataforma -> baixar/instalar -> ficar online -> validar primeiro uso
- importacao: abrir -> enviar arquivo -> revisar conflitos -> corrigir credenciais -> importar
- terminal: escolher host -> iniciar conexao -> operar -> encerrar ou recuperar falha

### Jornadas piloto
#### 1. Instalacao e ativacao de agentes
Jornada recomendada:
1. agente criado
2. plataforma e metodo de instalacao escolhidos
3. pacote baixado ou comando copiado
4. instalacao iniciada
5. agente detectado online pelo backend
6. conexao validada
7. primeiro recurso associado ou utilizado

Metricas principais:
- taxa de agentes que chegam ao primeiro estado online
- tempo mediano e p95 ate o primeiro online
- abandono por etapa e metodo de instalacao
- erros por categoria, plataforma e versao
- tentativas antes do sucesso
- taxa de recuperacao apos erro
- adocao e atualizacao do pacote MSI

Diretrizes de UX:
- manter um CTA principal: `Adicionar agente`
- apresentar fluxo guiado em modal ou wizard, separado de filtros e listagem
- recomendar MSI no Windows e manter PowerShell como alternativa
- persistir progresso e oferecer `Continuar instalacao`
- detectar o estado online automaticamente, sem depender apenas de confirmacao manual
- mostrar diagnostico e proxima acao de acordo com a etapa e o erro
- apos sucesso, orientar para `Associar servidor`, `Testar conexao` ou `Concluir`
- exibir versao instalada, versao disponivel e caminho de atualizacao guiada

Detalhes funcionais do onboarding ficam em `docs/PRD-agents-onboarding-lite.md`.

#### 2. Importacao de servidores
Jornada recomendada:
1. importacao aberta
2. origem escolhida e arquivo enviado
3. preview processado
4. conflitos e duplicidades revisados
5. credenciais ou PEM corrigidas sem sair do fluxo
6. itens validos importados
7. resultado e pendencias apresentados

Metricas principais:
- taxa de conclusao da importacao
- tempo ate a primeira importacao valida
- conflitos por categoria
- itens bloqueados e recuperados
- abandono durante revisao ou correcao de credencial
- sucesso parcial versus bloqueio total

### Sinais de friccao
Registrar apenas sinais com utilidade definida:
- erro de validacao
- repeticao de tentativa
- retorno para etapa anterior
- abandono de modal ou wizard
- tempo excessivo por etapa, sempre agrupado em faixas
- busca sem resultado, sem armazenar o texto pesquisado
- clique repetido em uma acao ainda em processamento
- falha seguida de recuperacao ou abandono
- recurso descoberto mas nunca concluido
- sucesso na primeira tentativa
- retorno ao recurso em 7 e 30 dias

Esses sinais devem permitir classificar o problema como:
- descoberta: o usuario nao encontrou o recurso
- compreensao: encontrou, mas nao entendeu a proxima acao
- operacional: entendeu, mas encontrou falha tecnica
- valor: concluiu, mas nao voltou a usar

### Contrato de evento recomendado
O contrato deve ser versionado, validado em `packages/shared` e aceitar somente campos previamente permitidos.

Exemplo conceitual:

```json
{
  "schemaVersion": 1,
  "occurredAt": "2026-08-30T12:30:00Z",
  "tenantHash": "t_a18c",
  "userHash": "u_f229",
  "sessionId": "s_91d2",
  "journeyId": "agent-installation",
  "screen": "agents",
  "step": "waiting_first_connection",
  "event": "step_failed",
  "outcome": "timeout",
  "durationBucket": "2_to_5_minutes",
  "platform": "windows",
  "installMethod": "msi",
  "appVersion": "1.8.0",
  "agentVersion": "1.8.0"
}
```

Regras:
- usar identificadores pseudonimizados nos pacotes de analise
- separar `journeyId`, `step`, `event` e `outcome`
- preferir enums e faixas a texto livre
- incluir versao da aplicacao, do agente e do schema
- correlacionar eventos somente durante o periodo necessario para analisar a jornada
- coletar contexto de dispositivo apenas no nivel necessario, como classe de viewport e plataforma

### Privacidade e seguranca
Nunca coletar como telemetria de experiencia:
- tokens, senhas ou chaves PEM
- IP, hostname ou nome real de servidor
- comandos, respostas ou buffer do terminal
- conteudo colado ou transferido
- texto digitado em busca
- conteudo de arquivos
- dados de credenciais e referencias secretas

Feedback textual deve ser armazenado separadamente, com aviso ao usuario, acesso controlado e sanitizacao de dados sensiveis. Capturas reais da tela do usuario nao fazem parte do comportamento padrao.

### Pacote compacto para analise por IA
Gerar snapshots agregados em formato versionado, por exemplo:

`ux-snapshot-AAAA-MM-DD.jsonl.gz`

Conteudo recomendado:
- `manifest`: intervalo, versoes e qualidade/amostra dos dados
- `funnels`: conversao e abandono por jornada e etapa
- `friction`: erros, repeticoes, demora e recuperacao
- `adoption`: ativacao, frequencia, amplitude de recursos e retencao
- `feedback`: comentarios sanitizados e categorias de percepcao
- `releases`: comparacao antes/depois por versao
- `test-results`: evidencias sinteticas de Playwright, Chromium CDP e acessibilidade

Priorizar dados agregados. Eventos individuais devem entrar somente quando necessarios para entender sequencia, ja pseudonimizados e sujeitos a retencao curta.

### Analise por IA
A IA deve produzir achados estruturados, nunca alterar producao automaticamente.

Cada recomendacao deve informar:
- achado e jornada afetada
- evidencia e tamanho da amostra
- nivel de confianca
- impacto esperado
- hipotese de causa
- mudanca recomendada
- experimento ou validacao proposta
- metrica de sucesso
- riscos de UX, seguranca e privacidade

Recomendacoes sem evidencia suficiente devem ser marcadas explicitamente como hipotese. Toda decisao de produto e liberacao continua sujeita a revisao humana.

### Cadencia operacional
- tempo real: alertas deterministicas para regressao ou falha critica
- diario: agregacao e verificacao de qualidade dos dados
- semanal: analise de UX por IA e triagem humana
- mensal: tendencias de ativacao, retencao e comparacao entre releases

### Relatorios e indicadores
O painel administrativo deve evoluir para apresentar:
- taxa de ativacao por jornada
- tempo ate o primeiro valor
- conversao e abandono por etapa
- recuperacao apos falha
- amplitude e recorrencia de uso dos recursos
- coortes de retencao em 7 e 30 dias
- distribuicao de versoes dos agentes
- adocao do instalador MSI e demais metodos

A visao executiva continua coberta por `docs/PRD-admin-adoption-dashboard-lite.md`; a telemetria detalhada de jornadas deve ficar em modulo proprio para nao transformar `admin_logs` em analytics irrestrito.

### Validacao automatizada
Playwright e Chromium CDP devem validar:
- sequencia esperada dos eventos de cada jornada
- loading, vazio, erro, sucesso, permissao e recuperacao
- responsividade, overflow e tooltips cortados
- foco, teclado, labels e nomes acessiveis
- erros de console e falhas de rede
- download, repeticao e retomada do fluxo
- screenshots apenas em ambiente sintetico de teste

Testes E2E demonstram que o fluxo e a instrumentacao funcionam. Eles nao devem ser usados como prova isolada de adocao real.

### Fases de entrega
#### Fase 1 - Pilotos e contrato
- instrumentar as jornadas de agentes e importacao
- definir schema allowlist e taxonomia de resultado/erro
- medir baseline antes de alterar UX
- validar eventos com testes E2E

#### Fase 2 - Agregacao e relatorios
- criar agregacao diaria
- expor funis, friccao, ativacao e recuperacao
- adicionar comparacao entre releases

#### Fase 3 - Snapshot e IA
- gerar `jsonl.gz` sanitizado
- validar qualidade e tamanho minimo de amostra
- produzir recomendacoes estruturadas com revisao humana

#### Fase 4 - Expansao controlada
- levar o modelo para terminal, hosts, credenciais, usuarios e auditoria
- priorizar jornadas de maior valor e friccao comprovada

### Criterios de aceite
- cada evento tem finalidade, owner, retencao e campos permitidos documentados
- nenhum segredo ou conteudo operacional entra nos eventos ou snapshots
- sucesso de agente e importacao e confirmado por estado do backend
- funis distinguem sucesso, falha, abandono e recuperacao
- o usuario consegue retomar uma instalacao de agente interrompida
- administradores visualizam metricas agregadas sem acesso indevido a conteudo sensivel
- o pacote para IA e versionado, compactado e reproduzivel
- recomendacoes da IA incluem evidencia, confianca e criterio de validacao
- Playwright cobre os estados principais e valida a emissao dos eventos

### Fora de escopo inicial
- gravacao continua da tela ou replay de sessao do usuario
- captura de comandos e conteudo do terminal para analytics de UX
- personalizacao automatica da interface por IA sem consentimento e governanca
- mudancas automaticas em producao a partir de recomendacoes da IA
- plataforma generica de BI ou clickstream irrestrito
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

## Frentes relacionadas
- `docs/PRD-ssh-ca-lite.md` — SSH CA: certificados por usuario para acesso SSH direto sem browser

## Ordem recomendada de implementacao
1. atalhos e labels por plataforma
2. presets e preferencias persistidas
3. onboarding curto
4. diagnostico rapido por plataforma

---

## Cliente terminal local (CLI)

### Objetivo
- permitir acesso ao NodeAccess sem abrir o navegador
- atender perfil DevOps/sysadmin que prefere viver no terminal
- manter auditoria, controle de acesso e MFA intactos

### Avaliacao de viabilidade
O backend ja oferece tudo que o CLI precisa:
- REST API: autenticacao (JWT, TOTP, email OTP), listagem de hosts, snippets
- WebSocket SSH gateway: sessao SSH via WS, mesmo protocolo do frontend web
- Resultado: CLI e um cliente thin sobre infra existente, sem necessidade de nova camada no backend

### Arquitetura proposta
```
terminal local -> CLI (Node.js) -> JWT auth -> backend API
                                -> WebSocket -> SSH gateway -> host
```

- CLI autentica com mesmo fluxo de JWT + refresh token
- Lista hosts via `GET /hosts` com busca/filtro
- Conecta via WebSocket para o mesmo gateway SSH do frontend
- Faz pipe do WebSocket com pty local (stdin/stdout/stderr)
- Snippets via `GET /snippets`, envia ao host conectado
- Credenciais armazenadas localmente com seguranca (keychain do SO ou arquivo com permissao 600)

### Pacote sugerido
- `apps/cli` no monorepo
- Runtime: Node.js (sem compilar binario no primeiro corte)
- Distribuicao: `npm install -g @nodeaccess/cli` ou script de instalacao
- Dependencias:
  - `commander` — parseamento de comandos
  - `ws` — WebSocket client
  - `node-pty` — pty local para emulacao de terminal
  - `keytar` ou arquivo `~/.nodeaccess/credentials.json` com `chmod 600` — armazenamento de token
  - `inquirer` ou `@clack/prompts` — interacao interativa (login, selecao de host)

### Comandos principais (primeiro corte)
| Comando | Comportamento |
|---------|--------------|
| `nodeaccess login` | Fluxo interativo: servidor, usuario, senha, TOTP/email OTP |
| `nodeaccess hosts [busca]` | Lista hosts acessiveis, filtra por termo |
| `nodeaccess connect <hostname ou id>` | Abre sessao SSH no terminal atual |
| `nodeaccess snippets` | Lista snippets permitidos |
| `nodeaccess snippet run <nome>` | Envia snippet ao host ativo (ou copia para clipboard) |
| `nodeaccess logout` | Invalida token e limpa credenciais locais |

### Fluxo de conexao SSH
1. `nodeaccess connect myserver` busca host por nome/id
2. CLI abre WebSocket para `wss://nodeaccess.empresa.com/ws/ssh/:hostId`
3. Backend valida JWT, verifica permissao, abre ssh2 para o host
4. CLI faz pipe bidirecional: pty local <-> WebSocket
5. Resize de terminal propagado via mensagem JSON no canal WS (mesmo protocolo do frontend)
6. Sessao registrada no audit log normalmente

### Seguranca
- token armazenado em keychain do SO (Windows Credential Manager, macOS Keychain, libsecret no Linux) via `keytar`
- fallback para arquivo com permissao 600 se keytar nao disponivel
- MFA obrigatorio mesmo no CLI (fluxo interativo no primeiro login)
- token refresh automatico, mesmo ciclo do frontend
- nenhuma credencial SSH local — tudo passa pelo backend

### O que nao muda no backend
- nenhuma rota nova necessaria no primeiro corte
- o gateway WS ja aceita qualquer cliente que envie JWT valido
- auditoria, sessao ao vivo e gravacao continuam funcionando

### Limitacoes conhecidas
- sem suporte a SFTP interativo no primeiro corte (somente SSH)
- sem tunelamento de porta via CLI no primeiro corte
- no Windows, node-pty requer Build Tools do Visual Studio instalados
- sessao ao vivo (compartilhamento) apenas como espectador no primeiro corte

### Prioridade e corte minimo
#### Primeiro corte (MVP)
- `nodeaccess login` com TOTP interativo
- `nodeaccess hosts` com busca
- `nodeaccess connect` com sessao SSH funcional
- armazenamento seguro de token

#### Segundo corte
- `nodeaccess snippets` e `snippet run`
- suporte a bastion transparente (ja suportado pelo backend)
- `nodeaccess logout`
- config de servidor em `~/.nodeaccess/config.json`

#### Depois
- autocompletar shells (bash, zsh, fish, PowerShell)
- multiplas sessoes em abas (tmux-like)
- SFTP via CLI
- tunelamento de porta

### Arquivos provaveis
- `apps/cli/src/index.ts` — entry point e parseamento de comandos
- `apps/cli/src/commands/login.ts` — fluxo de autenticacao interativo
- `apps/cli/src/commands/hosts.ts` — listagem e busca de hosts
- `apps/cli/src/commands/connect.ts` — sessao SSH via WebSocket + pty
- `apps/cli/src/services/api.ts` — wrapper HTTP para backend REST
- `apps/cli/src/services/ws-session.ts` — cliente WebSocket SSH
- `apps/cli/src/store/credentials.ts` — armazenamento seguro de token
