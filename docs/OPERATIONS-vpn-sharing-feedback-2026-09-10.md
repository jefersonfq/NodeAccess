# Compartilhamento, recuperação HTTP e Hosts sob VPN

## Comportamento implementado

- **SESSOES_5_compartilhada:** criar novamente o compartilhamento da mesma sessão SSH devolve o link ativo, sem revogar compartilhamentos, remover viewers, reiniciar o broker ou encerrar a concessão atual de controle. Mantém a validade original, sem renová-la silenciosamente. A autorização de proprietário/admin e a ACL do host continuam obrigatórias. Se um compartilhamento legado não tem token recuperável, retorna conflito explícito e mantém os participantes conectados.
- A criação usa transação MySQL com bloqueio da linha da sessão SSH antes de consultar/inserir o compartilhamento. Isso serializa chamadas entre instâncias da API. O caminho rápido reutiliza o compartilhamento já encontrado; o repositório também verifica novamente sob lock. Não exige migração ou dependência nova.
- **TERMINAL25:** erros HTTP transitórios não provocam mais `window.location.reload`. A notificação descreve falha na atualização de informações, preservando sessões abertas. Sondagem de recuperação exige resposta 2xx, tem timeout de 5 segundos, deduplicação, cancelamento e intervalo progressivo de 2 até 30 segundos. Não repete operações de escrita. Ao recuperar, emite evento para telas interessadas atualizarem leituras localmente.
- **HOSTS23:** estado vazio só aparece depois de consulta bem-sucedida sem resultados. Falha inicial informa que não foi possível consultar e oferece nova tentativa. Falha de atualização mantém a última lista com aviso de dados possivelmente desatualizados. A recuperação HTTP tenta recarregar uma lista em erro sem navegar ou reconstruir terminais.

A revogação explícita continua sendo uma operação separada. Esta mudança elimina a substituição implícita ao gerar/copiar o link; não adiciona uma nova operação de substituição automática.

## Testes

```bash
# Com as variáveis do backend de testes disponíveis:
npm run test:network-feedback:core
FRONTEND_BASE=http://127.0.0.1:5186 npm run test:network-feedback:web
npm run typecheck

# Somente em banco local de desenvolvimento; cria e remove fixtures:
RUN_SHARE_MYSQL=true node --env-file=apps/backend/.env node_modules/vitest/vitest.mjs run apps/backend/src/modules/shared-sessions/shared-session-reuse.mysql.test.ts
```

Nesta execução:

- 11 testes unitários aprovados: reutilização, autorização, token legado indisponível, concorrência simulada, bloqueio no repositório, sondagem HTTP, 401/403/503 sem falso sucesso, cancelamento, timeout e ausência de reload.
- MySQL real: oito criações concorrentes, via instâncias distintas do repositório, produziram um compartilhamento e um participante owner. Fixture de host documental `192.0.2.1`, sem SSH; registros removidos ao final.
- Chromium/Hosts: seis grupos de cenários aprovados, incluindo falha inicial sem falso vazio, tentativa manual, preservação da lista e recuperação local sem reload.
- Chromium/terminal: suíte de experiência aprovada com simulação HTTP 503, preservação do documento e do mesmo socket SSH. O transporte SSH é simulado nesta suíte; não é uma sessão do Proxy2.

## Verificação pela VPN

Usuário confirmou VPN conectada. Foram realizadas três conexões TCP somente à porta 22 de `172.31.1.20`, lendo o banner SSH e fechando imediatamente, sem autenticação nem comandos remotos. Resultados: 61 ms, 64 ms e 59 ms, todas com banner OpenSSH.

Isso confirma alcance ao Proxy2 naquele momento. Não mede estabilidade prolongada nem reproduz a falha HTTP do NodeAccess com a VPN. A URL da instância afetada não foi informada. Não atribuir a causa histórica a DNS, MTU, rota ou proxy sem captura adicional.

## Publicação e validação operacional

Publicar backend/API e frontend atualizados. Nenhuma migração de banco ou atualização de agente é necessária para este lote. Instâncias antigas da API ainda possuem a revogação implícita; concluir a atualização de todas elas antes de validar o comportamento em produção.

Com dois usuários de laboratório: iniciar acompanhamento; gerar/copiar novamente o link na sessão do proprietário; confirmar URL/validade iguais, viewer conectado e controle preservado. Depois simular falha HTTP enquanto o terminal segue emitindo saída: confirmar erro local, ausência de reload e retorno da listagem após recuperação. Não executar testes destrutivos no Proxy2.

## Revisão de sessões e terminal — 2026-09-24

Relatos desta rodada ocorreram em `nodeaccess.com.br`. A validação abaixo foi local; não representa publicação ou certificação da instância de produção.

### Comportamentos e causas encontrados

- Compartilhar novamente abre **Gerenciar ao vivo** quando já há compartilhamento. O link atual continua disponível, sem renovar a validade. O proprietário pode encerrar o compartilhamento mediante confirmação; o SSH dele permanece aberto. O indicador é removido quando há revogação, expiração ou encerramento do terminal. Falha de consulta mantém o último resultado com aviso de desatualização.
- A resolução HTTP do link não registra presença: o participante entra na lista ao ingressar no canal WebSocket. A lista do proprietário mostra viewers sem `leftAt` e com heartbeat nos últimos 45 segundos, excluindo histórico e presença obsoleta. Presença é uma aproximação por heartbeat, não garantia instantânea durante partições de rede.
- SFTP conserva a recuperação HTTP local já implementada. Falha ao salvar no editor mantém o rascunho visível; a nova tentativa repete a escrita com os mesmos controles de concorrência, sem reler e descartar o texto. Após sucesso, a leitura de metadados de concorrência continua ocorrendo. Se só essa leitura falhar, a tentativa seguinte repete a confirmação, sem executar novamente a escrita já concluída.
- A lista de `/hosts` filtra abas por tenant e agora informa quando há abas em outros tenants. A troca de contexto não equivale a encerramento. Encontrada uma causa adicional de perda da presença: `cleanupAllGhosts()` encerrava globalmente todos os registros ativos ao subir outro gateway. Agora usa o mesmo corte de heartbeat obsoleto da limpeza periódica, preservando registros ativos de outras instâncias. Sessões realmente órfãs podem permanecer visíveis até vencer esse corte.
- Encerramentos geram `SSH_SESSION_ENDED` em logs administrativos, com ID de sessão/host/tenant, origem, motivo, código WebSocket e contadores de tráfego/resize; nenhum comando, conteúdo de arquivo ou segredo é incluído. O motivo é capturado antes de fechar o transporte, para não ser sobrescrito pelo callback de fechamento remoto. O evento da auditoria recebe os mesmos metadados. Código 1006 indica fechamento anormal, mas não identifica por si só a causa de rede.
- O pop-out não registrava uma aba no store e a preparação da autorização Jira retornava antes de conectar. Agora registra seu próprio estado de autorização. A janela separada não responde aos próprios pedidos de reinserção como se fosse a principal. **Mover** mantém o comportamento de criar uma conexão independente e só fechar a origem após conectar; não transfere shell/buffer/processos remotos entre conexões.
- Após encerramento, o buffer informa o motivo conhecido. `R` solicita reconexão manual; outra letra fecha a aba e navega para a Home (no pop-out, fecha a janela). Modificadores, composição e repetição de tecla não acionam fechamento. Reconexões concorrentes são deduplicadas e entradas em terminais não conectados não são retransmitidas a outras abas.
- Abas podem ser reordenadas arrastando ou por **Mover aba para a esquerda/direita** no menu; IDs, instâncias, conexão e aba ativa são preservados.
- Filtros de logs têm placeholders específicos e nomes acessíveis: tipo de evento, resultado, filtro predefinido, tipo de recurso e estado de sessão/execução.
- A reconstrução da auditoria reconhece buffers alternativos (47/1047/1049), inclusive sequências fragmentadas, e `fg` como retorno a interação. Não interpreta buscas/comandos do Vim como shell enquanto a tela alternativa está ativa. Autocompletar que não pôde ser reconstruído fica explicitamente marcado `[Tab]`, com baixa confiança; não se inventa um nome de arquivo com espaços. Casos derivados dos exemplos da auditoria 108 foram simulados; a gravação bruta de produção não foi acessada nem reprocessada. Arquivos brutos permanecem a evidência primária.

O modelo de interação escolhido acompanha a separação entre sessão colaborativa existente, participantes e encerramento documentada no [Visual Studio Live Share](https://learn.microsoft.com/en-us/visualstudio/liveshare/use/share-project-join-session-visual-studio-code); não pressupõe um padrão universal de transporte ou transferência de shells.

### Validação reproduzível

```bash
npx vitest run apps/backend/src/modules/session-audit/session-audit-normalizer.test.ts apps/backend/src/modules/shared-sessions/shared-session-reuse.test.ts apps/backend/src/modules/sessions/sessions.service.test.ts apps/backend/src/modules/sessions/sessions.repository.test.ts apps/frontend/src/stores/terminals.test.ts apps/frontend/src/services/api-sftp-recovery.test.ts apps/frontend/src/services/backend-recovery.service.test.ts apps/frontend/src/services/host-open-sessions.service.test.ts
FRONTEND_BASE=http://127.0.0.1:5178 npm run test:terminal-experience:web
TERMINAL_LIFECYCLE_REVIEW=1 FRONTEND_BASE=http://127.0.0.1:5178 REPORT_PATH=/tmp/nodeaccess-lifecycle-review.json npm run test:terminal-experience:web
# Exige host SSH descartável e Chromium CDP próprio:
HOST_ID=<host-descartavel> FRONTEND_BASE=http://127.0.0.1:5178 CDP_BASE=http://127.0.0.1:9362 npm run test:terminal-pty:real
```

A suíte adicional usa HTTP/WebSocket simulados e um editor Monaco mínimo para testar preservação de rascunho e falhas sem depender de CDN. A suíte completa exercita xterm, entrada, seleção, copiar/colar, scroll, resize, tela cheia, highlights e recuperação. A certificação real desta rodada executou `top`/`htop` em um container SSH descartável e também validou pop-out, `exit`, `R` e os motivos gravados em banco (`remote_closed`/1000 e `socket_closed`/1001).

A publicação requer frontend, API e gateways atualizados. Não há migration nem dependência nova. Atualizar somente o frontend não corrige a limpeza global executada por gateways antigos. Os testes não publicam mudanças nem reprocessam auditorias históricas automaticamente.

Resultados locais: 186 testes unitários, oito grupos de cenários adicionais em Chromium, suíte completa de experiência e PTY real top/htop aprovados. Relatórios em `/tmp/nodeaccess-lifecycle-review.json`, `/tmp/nodeaccess-terminal-experience.json`, `/tmp/nodeaccess-review-pty/{top,htop}.json` e `/tmp/nodeaccess-review-real.json`. Checagem de tipos do frontend/backend e `git diff --check` concluídas.


### Ampliação de regressão — falhas, comunicação e controle

A rodada adicional acrescenta cobertura aos oito pontos:

| Ponto | Novas verificações |
| --- | --- |
| Compartilhamento | Pedido/concessão após revogação, encerramento e expiração; ACL retirada; tenant incorreto; viewer tentando administrar; participante que saiu; controle ocupado; banco indisponível; heartbeat atrasado. |
| SFTP | Conflito HTTP 409, conexão HTTP abortada, escrita atrasada com nova digitação e confirmação de descarte cancelada/aceita. O rascunho e o SSH devem permanecer íntegros. |
| Sessões em hosts | Projeção alternada entre tenants sem apagar conexões; cache antigo não expõe sessão de outro tenant; falha no banco durante startup não dispara fechamento global; navegação SPA preserva a instância. |
| Janela separada | Autorização Jira negada não abre SSH; nova tentativa autorizada funciona; fechamento antes de conectar preserva a origem; reinserção repetida e ausência do evento de fechamento não duplicam abas. |
| Auditoria | Todas as posições de fragmentação das sequências 47/1047/1049, autoria distinta entre owner/viewer e desconexão durante aplicativo interativo. Dados sintéticos, sem reprocessar a auditoria 108. |
| Filtros de logs | Seleção por teclado envia o tipo de evento, reinicia a página em 1 e remove o parâmetro ao selecionar todos. |
| Encerramento/reconexão | R maiúsculo reconecta; Ctrl+R, Alt+R, Escape, setas e números não acionam o atalho de saída; evento atrasado da conexão anterior não remove a nova. |
| Reordenação | 200 operações determinísticas preservam identidade/estado das abas; fechamento após reordenar seleciona o vizinho correto. |

Os testes expuseram uma falha: `requestControl` e `grantControl` verificavam acesso, mas não recusavam compartilhamentos já encerrados, revogados ou expirados. Agora retornam HTTP 410 nesses estados antes de publicar o pedido ou criar a concessão. Revogação/limpeza continuam disponíveis; transporte SSH, renderização e interação normal do terminal não foram alterados nesta ampliação.

A seleção unitária anterior, acrescida de `apps/frontend/src/services/terminal-popout-coordinator.service.test.ts`, passou com **209 testes** (23 novos). As checagens de tipos do backend/frontend passaram. A suíte completa `test:terminal-experience:web` passou novamente. Os 11 grupos de cenários ampliados em Chromium passaram, sem erros de execução no navegador; relatório em `/tmp/nodeaccess-lifecycle-expanded.json`. A certificação PTY real registrada acima pertence à rodada anterior; esta ampliação não alterou resize, WebSocket ou transporte SSH.

O ensaio ampliado continua reproduzível com `TERMINAL_LIFECYCLE_REVIEW=1 FRONTEND_BASE=http://127.0.0.1:5178 REPORT_PATH=/tmp/nodeaccess-lifecycle-expanded.json npm run test:terminal-experience:web`. HTTP/WS são simulados e Monaco é substituído apenas na renderização do editor. Não equivale a teste de falha de rede real nem certificação da produção.


### Prints de pastas, compartilhamento e último acesso — 2026-09-24

- `SESSOES_6_pastas nao mostram os hosts.jpg`: as respostas 404 visíveis são de `/users/1/avatar`, não de hosts/inventário. A busca lateral contém `vpn`; essa busca filtra nomes de pastas/grupos/tags e pode ocultar caminhos. O print sozinho não comprova a causa histórica. A interface agora informa o filtro ativo e oferece **Limpar filtro**.
- Encontrado um problema independente em `HostsView.vue`: falhas de atualização do bootstrap apagavam a árvore anterior, e falhas de inventário eram apresentadas como árvore vazia. As duas consultas agora são tratadas separadamente, com aviso e nova tentativa; falhas temporárias conservam dados anteriores. Respostas 403 removem a parte afetada e a mudança de tenant limpa os dados anteriores. Respostas antigas não substituem o resultado de uma consulta mais recente.
- Em telas de até 640 px, as pastas ficam acima da listagem e os cabeçalhos dos cards são empilhados; isso impede que a lateral consuma a largura destinada aos nomes dos hosts. Desktop mantém a disposição lateral.
- `TERMINAL26_Gerenciar ao vivo.jpg`: o botão usa a mesma cor de texto nos estados normal, hover, foco e pressionado, via tema do componente. Não altera dimensões, transporte ou entrada do terminal.
- `INICIO-DAHBOARD2.jpeg.png`: `DashboardView.vue` apresenta tooltip Naive UI com data e hora localizadas sobre o último acesso. O atributo de descrição exata continua disponível e o texto pode receber foco pelo teclado.
- **Gerenciar ao vivo** já apresenta nome/e-mail dos viewers sem saída registrada e com heartbeat recente. A contagem e a lista usam a mesma seleção; ausência de heartbeat tem janela de tolerância, não confirmação instantânea durante uma partição de rede.

Testes reproduzíveis:

```bash
FRONTEND_BASE=http://127.0.0.1:5178 PLAYWRIGHT_EXECUTABLE_PATH=/usr/bin/chromium-browser npm run test:recent-host-access:web
TERMINAL_LIFECYCLE_REVIEW=1 FRONTEND_BASE=http://127.0.0.1:5178 REPORT_PATH=/tmp/nodeaccess-lifecycle-expanded.json npm run test:terminal-experience:web
FRONTEND_BASE=http://127.0.0.1:5178 npm run test:terminal-experience:web
npx vitest run apps/frontend/src/utils/host-recent-access.test.ts apps/frontend/src/services/host-open-sessions.service.test.ts apps/backend/src/modules/shared-sessions/shared-session-reuse.test.ts
```

O ensaio de recentes/pastas usa API simulada e cobre tooltip de horas/dias em desktop e celular, avatar 404 com fallback, expansão/seleção de pasta, falhas 404/503 na atualização, falha independente do inventário, 403, primeiro carregamento com 404 e recuperação pelo botão. Capturas e relatório ficam em `/tmp/nodeaccess-recent-host-access/`. O ensaio do terminal verifica cor calculada e entrada/saída dos nomes dos participantes, além da regressão anterior. Nenhuma dessas simulações altera produção.

Resultados desta rodada: recentes/pastas em Chromium aprovados em 1440×960 e 390×844, com os casos 404/503/403 e recuperação descritos acima; 12 grupos do ensaio de ciclo de vida aprovados; 27 testes unitários selecionados e typecheck frontend aprovados. A suíte completa do terminal também passou. Corrigida uma corrida no próprio ensaio de reconexão: antes de digitar, ele aguarda o novo socket simulado estar aberto, em vez de depender apenas de uma mensagem que poderia permanecer no buffer anterior. Não houve mudança de transporte ou entrada do produto.


### Identidade única de Favoritos e Recentes em Hosts

`QuickAccessHostCard.vue` passa a apresentar ambos os grupos em `HostsView.vue`, tanto na visão Home de Hosts como nas demais visões. Ordem das informações: nome, IP/porta e protocolo, último acesso/estado ativo e pasta disponível. Cores, tipografia, bordas, espaçamentos e foco seguem o modelo de Recentes. A estrela identifica o card de Favoritos. A pasta mantém o critério existente: nome da pasta corporativa quando disponível, com fallback para a pasta pessoal; não é inventado um nome quando o dado está ausente.

A extração reaproveita as mesmas ações de conexão, menu de contexto, permissões e metadados já carregados, sem acrescentar consultas. O ensaio `test:recent-host-access:web` compara conteúdo e estilos dos dois grupos, verifica estrela, pastas pessoais/corporativas, foco e bloqueio de conexão para usuário comum, além das visões Home/lista em desktop e celular. Capturas em `/tmp/nodeaccess-recent-host-access/hosts-{desktop,mobile}.png` e `hosts-home-{desktop,mobile}.png`.

Padronização validada: ensaio completo de recentes/pastas aprovado em desktop e celular, incluindo comparação dos cards na visão Home/listagem, permissões de usuário comum e regressões de falha/recuperação. Typecheck frontend e revisão das capturas concluídos.
