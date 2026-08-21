# PRD Lite - Evolucao e adocao do terminal

## Objetivo

Evoluir o terminal do NodeAccess para que equipes de infraestrutura, suporte,
NOC, SRE e banco consigam descobrir recursos, conectar, diagnosticar e executar
rotinas com menos friccao, sem reduzir seguranca, governanca ou auditabilidade.

O foco nao e adicionar mais botoes. A evolucao deve tornar capacidades ja
existentes mais previsiveis, faceis de encontrar e adequadas ao contexto de
trabalho de cada usuario.

## Estado atual

O terminal ja possui uma base funcional ampla:

- terminal web com xterm.js e gateway WebSocket/SSH;
- multiplas abas, reordenacao, busca de abas e split panes;
- broadcast controlado entre terminais;
- busca no buffer, copy mode, paste protegido e zoom;
- autocomplete local e de caminhos remotos, com cache e invalidacao;
- snippets simples, macros `expect/send` e snippet de inicializacao;
- SFTP, tunel, links associados e edicao do host;
- favoritos, recentes e seletor rapido de hosts;
- compartilhamento de sessao com controle delegado;
- assistente de IA, prefixo literal, preview e ActionRun governado;
- indicadores de conexao, rota, latencia, auditoria e diagnostico do browser;
- preferencias e onboarding por plataforma;
- harnesses Playwright/Chromium para experiencia, layout e performance.

Essa amplitude cria uma oportunidade de adocao, mas tambem aumenta o custo de
descoberta. As proximas entregas devem privilegiar hierarquia e previsibilidade.

## Principios

- clareza antes de densidade de funcionalidades;
- nenhuma automacao deve executar comando por surpresa;
- inserir, revisar, aprovar e executar sao acoes diferentes;
- reconexao nao pode aparentar continuidade da sessao SSH perdida;
- broadcast deve permanecer desligado por padrao e visualmente evidente;
- historico e contexto podem conter segredos e devem seguir policy do tenant;
- recursos de IA, autocomplete e automacao dependem de entitlement e readiness;
- UX nao deve conhecer detalhes de `ssh2` ou do protocolo interno do gateway;
- mudancas devem preservar foco, selecao, scroll, buffer e resize do xterm.js;
- novos recursos devem incluir estados de loading, vazio, erro e sucesso.

## Publicos e resultados esperados

| Perfil | Necessidade principal | Resultado esperado |
|---|---|---|
| Operacao/NOC | conectar e alternar rapidamente | menor tempo ate o host correto |
| Suporte | seguir procedimento e registrar atendimento | snippets, ticket e evidencias acessiveis |
| SRE | correlacionar sintomas em varios hosts | workspace, split, diagnostico e IA |
| DBA | operar com tunel, arquivos e comandos sensiveis | contexto claro e execucao governada |
| Gestor | reduzir risco e comprovar atividade | auditoria, policy e relatorios consistentes |

## Prioridade alta

### 1. Paleta universal de acoes

Criar uma command palette, sugerida em `Ctrl/Cmd+Shift+P`, que permita buscar e
acionar recursos sem navegar pela interface.

Acoes iniciais:

- conectar em host;
- alternar ou localizar aba;
- abrir arquivos, snippets, IA e tuneis;
- dividir ou restaurar layout;
- compartilhar sessao;
- reconectar;
- editar host;
- abrir detalhes de conexao;
- executar diagnostico seguro.

Regras:

- resultados filtrados por permissao, entitlement e readiness;
- acoes indisponiveis explicam o motivo;
- atalhos aparecem ao lado da acao;
- navegacao completa por teclado;
- a palette nao executa comando destrutivo diretamente.

### 2. Falha e reconexao orientadas a causa

Substituir mensagens genericas por uma experiencia que identifique a etapa da
falha:

```text
Browser -> Gateway -> Agente/Bastion -> Host -> Autenticacao
   OK         OK            Falha
```

O estado de erro deve oferecer:

- causa resumida em linguagem operacional;
- codigo tecnico copiavel;
- etapa e rota afetadas;
- CTA principal contextual;
- `Tentar novamente` quando seguro;
- `Editar credencial`, `Revisar host` ou `Abrir diagnostico` quando aplicavel.

Reconexao automatica ampla nao e recomendada. Ela pode criar nova auditoria,
repetir prompts ou induzir o usuario a acreditar que o processo remoto continua
no mesmo estado. Se adotada, deve ser opcional, curta, limitada e explicita.

### 3. Workspaces salvos

Permitir salvar um ambiente de trabalho contendo:

- hosts e ordem das abas;
- layout de split;
- painel lateral inicial;
- snippets de inicializacao;
- nome, descricao e escopo pessoal ou de time.

Regras de seguranca:

- salvar configuracao, nunca credenciais ou buffer;
- broadcast sempre inicia desligado;
- abertura confirma hosts indisponiveis ou sem permissao;
- workspace de time respeita ACL e entitlement;
- reconectar hosts de forma progressiva para evitar pico no gateway.

### 4. Simplificacao do rail e toolbar

Organizar a interface em tres niveis:

1. essenciais visiveis: hosts, arquivos, snippets e IA;
2. contexto operacional: tuneis, compartilhamento e links;
3. menu `Mais`: editar host, diagnosticos, feedback e preferencias.

O rail deve mostrar estado ativo, label acessivel e tooltip. Em telas menores,
acoes secundarias devem ir para menu, sem reduzir a area do terminal.

### 5. Diagnostico guiado de conexao

Adicionar um diagnostico somente leitura acessivel na falha ou nos detalhes da
conexao. Deve verificar, quando permitido:

- disponibilidade do gateway;
- rota direta, agente, conector ou bastion;
- DNS e TCP;
- host key;
- mecanismo de credencial;
- latencia e keepalive;
- policy e entitlement que possam bloquear o acesso.

O resultado deve distinguir fato observado, causa provavel e acao sugerida.

## Prioridade media

### 6. Historico operacional da sessao atual

Apresentar uma timeline opcional com:

- comandos detectados;
- horario e duracao;
- exit code quando houver confianca suficiente;
- busca e copia;
- reinsercao no prompt sem executar;
- envio selecionado para analise por IA.

O recurso deve ser efemero por padrao ou seguir retencao do tenant. Comandos
classificados como sensiveis precisam de redaction antes de qualquer persistencia
ou envio a provider.

### 7. Marcacoes e notas

Permitir marcar eventos durante a sessao:

- erro encontrado;
- mudanca iniciada;
- validacao concluida;
- servico normalizado;
- nota livre.

Marcacoes devem aparecer na timeline da auditoria, com usuario e horario, sem
alterar o stream original do terminal.

### 8. IA com niveis de confianca visiveis

Separar explicitamente:

- explicacao;
- comando sugerido;
- script proposto;
- ActionRun governado;
- execucao concluida.

Cada proposta deve informar contexto utilizado, risco, efeito esperado,
necessidade de aprovacao e provider/modelo. `Inserir no terminal` nao envia
Enter; `Executar` deve continuar sujeito a policy e aprovacao.

### 9. Barra compacta de saude

Exibir uma linha discreta, por exemplo:

```text
Conectado | 38 ms | Direto | Auditoria ativa
```

O detalhe expandido pode mostrar gateway, agente ou bastion, sessao, tempo
conectado, keepalive e motivo do ultimo erro. Estado nunca deve depender apenas
de cor.

### 10. Perfis por funcao

Oferecer presets opcionais:

- Operacao: terminal limpo e atalhos essenciais;
- Suporte: snippets, ticket e compartilhamento;
- SRE: split, diagnostico e IA;
- DBA: arquivos, tuneis e workspace.

O usuario sempre pode personalizar depois. Presets nao alteram autorizacao,
policy ou entitlement.

## Melhorias logicas e de arquitetura

O crescimento atual esta concentrado em componentes grandes:

- `apps/frontend/src/views/TerminalView.vue`: workspace, paineis, modais e fluxos;
- `apps/frontend/src/components/TerminalPane.vue`: toolbar, overlays e renderer;
- `apps/frontend/src/composables/useTerminal.ts`: sessao, transporte e estado.

Refatoracao incremental recomendada:

| Modulo | Responsabilidade |
|---|---|
| `TerminalWorkspace` | abas, split e layouts salvos |
| `TerminalSession` | ciclo e estado da conexao |
| `TerminalCommandPalette` | descoberta e execucao de acoes de UI |
| `TerminalConnectionHealth` | causa, rota e recuperacao |
| `TerminalAiPanel` | contexto, conversa e execucao governada |
| `TerminalCollaboration` | compartilhamento e controle |
| `TerminalRail` | navegacao e hierarquia lateral |
| `terminal-transport` | WebSocket, ping, resize e mensagens do gateway |

A extracao deve ocorrer junto das funcionalidades, sem reescrita integral. A
primeira fronteira recomendada e separar estado de conexao/transporte da view.

## Performance e confiabilidade

- nao recriar xterm ou WebSocket ao renomear host ou alterar estado visual;
- limitar conexoes paralelas ao abrir workspace;
- manter debounce, cache por sessao e cancelamento do autocomplete remoto;
- virtualizar listas grandes de hosts, abas ou historico quando necessario;
- evitar `watch` global que refaça `fit()` sem mudanca real de geometria;
- medir tempo de primeira conexao, resize, input-to-render e consumo de heap;
- preservar buffer durante mudancas de layout;
- invalidar caches de caminho em comandos mutaveis;
- encerrar timers, observers e listeners ao fechar a sessao.

## Metricas de adocao

Coletar apenas telemetria de produto sem comandos, buffer ou segredos:

- tempo ate primeira conexao bem-sucedida;
- taxa de sucesso e falha por etapa da rota;
- uso da command palette;
- uso de autocomplete, snippets, split e workspace;
- tempo entre falha e recuperacao;
- abandono no desafio de credencial ou ticket;
- uso de IA por finalidade e taxa de aceite de sugestao;
- frequencia de reconexao;
- usuarios ativos no terminal por tenant.

## Plano de entrega

### Fase 1 - Descoberta e recuperacao

- command palette;
- painel de erro orientado a causa;
- barra compacta de saude;
- telemetria de adocao sem dados sensiveis.

### Fase 2 - Produtividade recorrente

- workspaces pessoais;
- simplificacao do rail;
- historico efemero da sessao;
- marcacoes e notas.

### Fase 3 - Times e governanca

- workspaces de time;
- presets por funcao;
- integracao das marcacoes com auditoria e ticket;
- diagnostico guiado com ActionRun quando necessario.

### Fase 4 - Evolucao arquitetural

- extracao incremental dos modulos de workspace, conexao e rail;
- contrato explicito para transport e renderer;
- testes de carga com multiplas abas e splits;
- budgets de performance e regressao visual.

## Criterios de aceite globais

- usuario deve localizar qualquer acao primaria sem conhecer o rail;
- falha deve indicar etapa e proximo passo;
- nenhuma sugestao de IA executa comando sem acao explicita;
- reabrir workspace nao restaura segredo, buffer ou broadcast;
- interface deve funcionar em 390 px e desktop;
- navegacao primaria deve funcionar por teclado;
- foco retorna ao terminal ao fechar modal ou painel;
- estados nao dependem apenas de cor;
- nenhuma evolucao pode quebrar selecao, copy/paste, scroll, resize ou buffer;
- testes devem cobrir sucesso, erro, reconexao, sessao expirada e permissao negada.

## Estrategia de testes

- unitarios para estado de conexao, command palette e workspace;
- contratos para mensagens WebSocket e erros de rota;
- Playwright/Chromium em desktop e mobile;
- testes visuais da toolbar, rail, overlays e autocomplete;
- simulacao de DNS, TCP, autenticacao, bastion e agente indisponivel;
- carga com muitas abas, splits e alto volume de output;
- validacao de teclado, foco, leitor de tela e copy/paste;
- verificacao de que telemetria e logs nao armazenam comandos ou segredos.

## Riscos e controles

| Risco | Controle |
|---|---|
| interface ficar mais carregada | command palette e hierarquia progressiva |
| reconexao duplicar sessoes | limites, idempotencia e mensagem explicita |
| workspace gerar pico de conexoes | fila e conexao progressiva |
| historico expor segredo | redaction, retencao e policy |
| IA induzir execucao perigosa | preview, classificacao e aprovacao |
| refatoracao afetar terminal ativo | extracao incremental e harness de regressao |

## Fora do escopo inicial

- prometer retomada transparente de processo SSH sem tmux/screen;
- manter credenciais em workspace;
- executar automaticamente sugestoes da IA;
- habilitar broadcast ao abrir layout salvo;
- substituir auditoria deterministica por resumo de IA;
- reescrever integralmente o terminal antes de entregar valor incremental.

## Ordem recomendada

1. paleta universal;
2. falha e diagnostico de conexao;
3. barra de saude;
4. workspace salvo;
5. simplificacao do rail;
6. historico e marcacoes;
7. presets por funcao;
8. refatoracao incremental associada a cada entrega.
