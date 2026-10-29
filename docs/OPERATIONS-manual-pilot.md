# Manual integrado — piloto de 24/09/2026

## Revalidação de 28/10/2026 — NA-0080 / Mouse do terminal

Terminal e Compartilhamento mantêm os procedimentos. Corrigido encaminhamento de eventos binários de mouse, condicionado à conexão e à concessão de controle no participante. Testes de bytes e permissões, regressão Chromium, tipos e manual passaram. `manual:capture` passou com `MANUAL_EXPECTED_VERSION=dev` e frontend 5174 após ajustar a expectativa de versão do ensaio. As cinco capturas foram inspecionadas; evidências novas em `/tmp/nodeaccess-manual-review` e `/tmp/nodeaccess-shared-viewer-review`, mantendo imagens versionadas por não haver mudança visual. Hashes dos dois capítulos revalidados por `loadManual()` e `manual:check-reviewed` passou. HTTP/WebSocket simulados; naquele momento, PTY real estava pendente por ausência de `HOST_ID` descartável. Complemento de 29/10/2026: ensaio SSH descartável com top/htop e clique real no cabeçalho do htop passou antes da entrega, conforme diário e recibos privados preservados. Registro completo em `changes/2026/10/NA-0080-terminal-mouse/implementation.md`.


## Complemento de 24/10/2026 — NA-0068 / Ampliação do laboratório

Hosts documenta solicitação de máquinas adicionais e cadastro próprio opcional, com quotas, IPv4 público, credenciais e remoção apenas do cadastro. Os componentes `TrialResourcesPanel.vue` e `TrialCustomHosts.vue` passaram a compor o hash editorial. A jornada real validou expansão de1 para3 máquinas, cadastro/edição/exclusão em SQL e atualização do catálogo sem aguardar TTL. O menu de edição/exclusão do card usa o fluxo próprio do trial; formulário administrativo normal passou na matriz de seis combinações. SMTP/VM seguem simulados; o host público do teste foi somente metadado, sem conexão externa. Nova captura completa e inspeção das cinco imagens foram concluídas após isolar o cache Vite; `test:manual` e `manual:check-reviewed` repetidos. Evidências na frente `frontend-evidence.md` e `/tmp/na0068-live-resources-browser.log`.

## Revalidação de 24/10/2026 — NA-0068 / Degustação coexistente

Hosts e Terminal mantêm o procedimento normal. As notas explicam o laboratório pré-cadastrado, o prazo, os recursos configurados e a indisponibilidade de links JIT. O frontend evita consultas de agentes, túneis e JIT no perfil de teste, preservando as consultas normais. O menu apresenta o prazo e acesso à gestão da degustação.

Executados com Node 24.21.0 e dependências do lock: `manual:capture` no frontend isolado 5188, versão `dev` (`MANUAL_EXPECTED_VERSION=dev`), `test:manual` (18 testes e compilador), `test:terminal-experience:web` e `test:terminal-pty:real` com `top` e `htop` no SSH descartável local. A primeira captura falhou por expectativa de versão do próprio ensaio; a repetição com versão explícita passou. As cinco imagens foram inspecionadas para legibilidade, enquadramento e dados fictícios. Capturas e testes do manual simulam HTTP/WebSocket; o ensaio PTY usa gateway e SSH reais, sem certificar isolamento de VMs. O wrapper PTY agora fecha somente sua aba de teste após cada caso, evitando que a sessão anterior bloqueie o caso seguinte em tenants sem multi-connect.

Evidências locais: `/tmp/na0068-manual-capture.log`, `/tmp/na0068-manual-tests.log`, `/tmp/na0068-terminal-experience.json`, `/tmp/na0068-pty-real/top.json`, `/tmp/na0068-pty-real/htop.json`. Hashes de Hosts e Terminal recalculados por `loadManual()` após revisão do texto e da interface. Nenhuma captura ou alteração em produção.


## Revisão de 22/10/2026 — NA-0058 / Cadastro de hosts em abas

O capítulo Hosts passa a orientar cadastro e edição por Conexão, Acesso, Organização e Recursos, com Conexão como abertura padrão. Documenta navegação por teclado, preservação dos dados ao alternar abas, pasta pessoal versus acesso corporativo, recursos condicionados ao protocolo/permissão, teste TCP em RDP/VNC e recuperação de erros. O formulário foi observado nas capturas demonstrativas da frente; ações próprias de recursos continuam independentes do salvamento do cadastro.

Validações executadas no frontend isolado em `http://127.0.0.1:5178`, versão `dev`: `test:manual` (18 testes e duas verificações do compilador) e `manual:capture`, incluindo busca, ajuda contextual sem reconexão, versão, mobile, falhas de configuração, 60 estados de compartilhamento e dois ciclos de tenant. A regressão completa `test:terminal-experience:web` também passou em tema escuro, incluindo geometria mobile, foco, input, navegação de sessões e copiar/colar, sem erros de execução. As cinco capturas de `apps/frontend/public/manual-assets/` foram regeneradas e inspecionadas quanto à legibilidade, enquadramento e uso de dados fictícios. A primeira tentativa de captura encontrou uma falha de compilação transitória do formulário; a execução após sua correção passou.

Evidências locais: `/tmp/na0058-test-manual.log`, `/tmp/na0058-manual-capture.log`, `/tmp/na0058-terminal-experience.json`, `/tmp/nodeaccess-manual-capture-review.json`, `/tmp/nodeaccess-manual-capture-tenants.json` e `/tmp/nodeaccess-manual-review/`. HTTP/WebSocket são simulados; esta validação não equivale à homologação de conexões reais ou produção. Após revisão do procedimento e das evidências, o manifesto de Hosts foi atualizado em 22/10/2026 com o hash calculado por `loadManual()`, incluindo o componente de abas e seu tipo compartilhado. `manual:check-reviewed` passou para os cinco capítulos. O ajuste final de contraste do texto auxiliar no formulário escuro foi revalidado sem mudança no procedimento; o hash foi recalculado após esse CSS. As capturas do manual mostram a lista de Hosts, não afetada por esse ajuste. O polimento final de alinhamento de campos e transição entre abas foi inspecionado na captura `dark-1440-create-connection.png` da matriz `host-form-tabs-after-polish`; o CSS desativa a animação quando há preferência por movimento reduzido. O procedimento permanece válido, com hash recalculado e gate editorial repetido após esse polimento.

## Revalidação de 08/10/2026 — NA-0045 / Tailwind 4

Terminal e Compartilhamento mantêm os procedimentos existentes. A migração preserva os outlines acessíveis e corrige a sintaxe das colunas do painel de detalhes: com Tailwind 4, a vírgula entre colunas impedia o layout lateral e reduzia a altura útil do terminal. Cinco capturas demonstrativas regeneradas e inspecionadas com versão `dev`; o harness aguarda o aviso de configuração desaparecer antes de fotografar Hosts.

Validações: `manual:capture`, 60 estados do compartilhamento nos dois temas, dois ciclos de tenant sem reconexão, experiência do terminal, PTY real com top/htop em OpenSSH descartável, 18 testes do manual e dois do compilador, além do gate editorial. Revisão de texto preservada por não haver mudança nos procedimentos; hashes de Terminal e Compartilhamento atualizados após validar o comportamento. Evidências da etapa em `docs/changes/2026/10/NA-0045-frontend-build/`. Nenhuma implantação ou alteração no guacd.

## Uso e escopo

O manual fica em `/manual`, com cinco capítulos: Hosts, terminal, compartilhamento ao vivo, arquivos/SFTP e troca de tenant. Tem busca no conteúdo, exemplos, permissões, recuperação de erros, diagramas, capturas demonstrativas ampliáveis e impressão do capítulo. O conteúdo do piloto é em português; a interface informa essa condição quando outro idioma estiver selecionado.

Um administrador habilita o piloto em **Configurações do tenant → Manual e ajuda**. O padrão é desativado. O controle pertence ao tenant identificado na sessão, sem seleção de tenant por parâmetros fornecidos pelo navegador. Usuários comuns podem consultar a disponibilidade, mas não alterá-la. A mudança é auditada como `UPDATE_TENANT_MANUAL`.

Quando habilitado, o menu Manual e os ícones contextuais aparecem. Em Hosts e terminal, os acessos antigos de ajuda do piloto dão lugar ao manual; fora do piloto, a ajuda anterior continua disponível. Ajuda de campo e orientações de confirmação não foram removidas. Links contextuais abrem outra aba do navegador, preservando a sessão. O próprio manual mostra um estado indisponível quando desligado; o controle é de exibição de documentação genérica, não uma barreira para conteúdo confidencial.

A alteração passa a ser vista nos demais navegadores ao recarregar ou entrar novamente no tenant. Não há sondagem periódica no terminal. Falha na consulta do manual desabilita seus acessos e oferece nova tentativa na tela do manual; não dispara recuperação global da aplicação. Respostas atrasadas de outro tenant são descartadas. Em falha de confirmação de gravação, a interface consulta o estado atual para não afirmar indevidamente que houve rollback.

## Implantação

Aplicar a migração `apps/backend/prisma/migrations/20260924180000_add_tenant_manual_settings/migration.sql` pelo fluxo habitual de migrations. Ela cria a tabela de configuração, sem habilitar o piloto em tenants existentes. Frontend e backend devem ser entregues juntos. Esta implementação não foi publicada em produção nem ativada para clientes.

## Fonte e geração

- Fonte editorial: `docs/manual/*.md`.
- Mapa capítulo/implementação/data de revisão: `docs/manual/manifest.json`.
- Figuras: `apps/frontend/public/manual-assets/`.
- Compilação: `tools/manual/build.cjs`, integrado ao Vite. O compilador Markdown é dependência de desenvolvimento explícita e não precisa ser executado no navegador.
- Interface integrada: `apps/frontend/src/views/ManualView.vue` e `components/manual/`.
- Skill: `.agents/skills/nodeaccess-manual/SKILL.md`, vinculada pelo AGENTS.md aos fluxos mapeados.

A proposta inicial de um portal VitePress foi adaptada ao pedido de uma tela dentro do produto: o piloto usa Vue/Naive UI e a navegação já existentes, sem manter um segundo aplicativo de documentação. Os capítulos continuam em Markdown e podem alimentar um portal externo posteriormente.

## Versão em todo build

A versão do manual é a mesma variável `VITE_APP_VERSION` utilizada pelo frontend. No build Docker, `APP_VERSION` alimenta essa variável; o script de release já passa a versão da release. Builds locais sem uma versão explícita mostram `dev`, como a identificação existente do frontend. Não há número de versão fixado nos capítulos.

O build emite `manual-version.json` com versão, horário UTC da geração, hash do conteúdo/figuras e estado de revisão dos capítulos. A data de revisão editorial permanece separada da data do build: gerar uma imagem nova não equivale a revalidar todos os procedimentos. Os Markdown também são copiados para o pacote da release.

## Rotina de atualização

1. Durante a alteração do produto, a skill identifica os capítulos mapeados e atualiza o conteúdo afetado.
2. `npm run manual:capture` executa três cenários demonstrativos (manual, compartilhamento e troca de tenant). Só substitui as cinco capturas quando todos passam. Não usa produção nem dados reais.
3. Após revisar texto e imagens, atualizar `reviewedAt` e `reviewedSourceHash` no manifesto. O hash de referência vem de `loadManual()` e não deve ser avançado sem essa revisão.
4. `npm run manual:check-reviewed` acusa capítulos cuja implementação mudou desde a revisão. `npm run test:manual` valida geração, configuração e isolamento.
5. Cada build recompila o manual e sua versão. O workflow `.github/workflows/manual-pilot.yml` verifica a revisão, executa testes, gera capturas e disponibiliza evidências da execução como artefato.

A automação cobre geração, versão, capturas e detecção de desatualização. A skill orienta a atualização editorial durante o desenvolvimento; o build não inventa novos procedimentos nem publica texto gerado por IA sem revisão. Não foi configurada uma execução autônoma de IA com credenciais externas. O workflow foi criado no repositório; a execução remota depende do envio dessas alterações ao serviço de CI.

## Comandos de validação local

```sh
npm run test:manual
npm run manual:check-reviewed
# Servidor de teste separado, iniciado em apps/frontend:
VITE_APP_VERSION=9.8.7-manual-test npx vite --host 127.0.0.1 --port 5178
# Em outro terminal, na raiz:
FRONTEND_BASE=http://127.0.0.1:5178 npm run manual:capture
FRONTEND_BASE=http://127.0.0.1:5178 npm run test:terminal-experience:web
npm run typecheck -w apps/frontend
npm run typecheck -w apps/backend
```

`MANUAL_EXPECTED_VERSION` permite conferir outra versão no cenário de navegador. No CI, usa-se uma versão de teste vinculada ao commit. `PLAYWRIGHT_EXECUTABLE_PATH` permite usar o Chromium instalado pelo Playwright.

As capturas e os cenários usam HTTP/WebSocket simulados com Vue/xterm reais. Isso não equivale a homologação de uma instalação de produção. Não houve alteração de resize remoto, transporte SSH ou protocolo WebSocket nesta entrega.

## Evidências da validação local

- 18 testes de configuração, permissão, isolamento e estado do frontend aprovados, além das verificações de geração e versionamento do compilador.
- Playwright: ativação/desativação, ajuda contextual, busca, capítulos, responsividade, contraste, ampliação das figuras, recuperação de falhas e preservação da conexão do terminal.
- Impressão do guia de compartilhamento validada em PDF de três páginas, com diagrama, captura e conteúdo até o resultado esperado. As imagens são incorporadas antes da impressão.
- Compartilhamento: 60 estados de geometria, controle, falhas e recuperação nos dois temas, com o acesso ao manual habilitado.
- Troca de tenant: dois ciclos completos, preservando a sessão e restaurando a identidade original.
- Regressão `test:terminal-experience:web`, typechecks de frontend/backend e validação Prisma aprovadas.
- Build Docker do frontend concluído com `APP_VERSION=9.8.7-manual-test`; artefato contém os cinco capítulos revisados, as imagens e a mesma versão.

Os relatórios e imagens da execução ficam em `/tmp/nodeaccess-manual-review/` e nos arquivos `/tmp/nodeaccess-manual-capture-*.json`. No CI são disponibilizados como artefatos. Os cenários não acessaram produção.

## Revisão de 26/09/2026 — Destaques na barra superior

O capítulo Terminal descreve o botão Destaques na barra superior, foco de regras, busca, filtro de novas ocorrências e ocultação dos controles mantendo as cores. `TerminalPane.vue` passou a integrar os arquivos monitorados pelo capítulo. A captura do terminal mostra o painel aberto; as cinco capturas foram regeneradas e inspecionadas em ambiente demonstrativo.

Validações: typecheck do frontend; `test:manual` (18 testes e 2 verificações do compilador); `manual:capture` com a versão `terminal-highlights-toolbar`; regressão completa `test:terminal-experience:web` em temas claro/escuro, com controles por teclado, Escape, ocultação, mobile, geometria e atualização de cores. A rodada final usou frontend limpo em 5179. O teste de autocomplete passou a separar bytes de entrada de mensagens de controle, evitando falso negativo causado por ping entre teclas. Nenhuma alteração no transporte SSH, WebSocket ou lógica de resize remoto. Produção não foi acessada.

## Revisão de 28/09/2026 — Diagnóstico de acesso

Capítulo Terminal atualizado com etapa, causa, orientação, referência para suporte, falha de clipboard, recolhimento e reconexão manual. O manifesto também monitora o componente de diagnóstico e seu catálogo. Cinco capturas demonstrativas regeneradas e inspecionadas com versão `connection-diagnostic`; revisão editorial avançada após validar texto e comportamento.

Validações aprovadas: 20 testes da lógica de diagnóstico; 18 testes do manual e 2 do compilador; typecheck do frontend; `manual:capture` (incluindo 60 estados de compartilhamento e dois ciclos de tenant); regressão completa `test:terminal-experience:web`; cenários específicos com `CONNECTION_DIAGNOSTIC_REVIEW=1` em temas claro/escuro, desktop/mobile. Foram simulados sete códigos, interrupção de socket, falha de cópia, recolhimento, recuperação manual e saída normal. Relatórios `/tmp/nodeaccess-connection-diagnostic*.json` e `/tmp/nodeaccess-diagnostic-terminal-regression.json`. Não houve mudança de transporte/resize remoto nem acesso a produção.

## Revisão de 03/10/2026 — Correções SFTP

Capítulo SFTP atualizado com árvore recolhível, menu explícito de ações, navegação por teclado, recuperação de erro de listagem, proteção de leitura truncada e permissões de backup/restauração. As cinco capturas demonstrativas foram regeneradas e inspecionadas; a captura de SFTP aguarda conexão, controles disponíveis e término da transição da tela. O manifesto foi atualizado após essa revisão.

Validações: 218 testes unitários/regressões e seis testes opt-in com OpenSSH descartável; Playwright e Chromium CDP para SFTP, auditoria e configurações; 18 testes do manual e duas verificações do compilador; `manual:capture` com versão `dev`, 60 estados de compartilhamento e dois ciclos de tenant; regressão completa `test:terminal-experience:web`; typechecks de frontend/backend e `manual:check-reviewed`. Evidências e limites em [correções SFTP](reviews/2026-10-03-sftp-fixes.md). Não houve mudança de transporte/resize remoto, implantação ou acesso a produção.


## Revisão de 03/10/2026 — Utilitários de arquivos no terminal

Capítulos Terminal e SFTP descrevem entrada pelo menu, contexto reaproveitado, cópia de até 2 MiB, home da conta, conexão do destino, comando direto e editor pessoal Windows com salvamento automático, conflito, recuperação e limites. Manifesto SFTP monitora componente/serviço e núcleo de operações/observador do agente. Cinco capturas demonstrativas regeneradas e inspecionadas com versão dev; revisão editorial atualizada após validar fluxos e texto.

Validações: 52 testes backend/frontend, 16 do agente, oito testes reais com OpenSSH e protocolo de edição, sete cenários do editor no Windows mais interface do agente, Playwright/Chromium CDP de utilitários e regressões SFTP/auditoria/configurações, terminal completo e PTY real top/htop; 18 testes do manual e duas verificações do compilador; 60 estados de compartilhamento e dois ciclos de tenant; typechecks e lint dos arquivos centrais. Escopo e limites em [evidências de implementação](reviews/2026-10-03-terminal-file-utilities-implementation.md). Sem implantação ou acesso a produção.


## Revalidação — 2026-10-05 / NA-0038

Terminal: recuperação localizada do painel de arquivos com sessão SSH preservada. SFTP: quota preventiva do editor externo (20 backups por arquivo, 64 MiB reconhecidos na pasta, leitura limitada a 1.024 entradas); rascunhos e backups não são removidos automaticamente. Cinco capturas recertificadas com frontend local `engineering-hardening-local`, usando dados fictícios; imagens revisadas quanto à legibilidade e enquadramento. Harness do manual, 60 estados de compartilhamento e dois ciclos de tenant concluídos; `test:manual` e gate editorial passaram. Evidências em `docs/reviews/evidence/2026-10-05-engineering-hardening/` e reports de captura `/tmp/nodeaccess-manual-capture-*.json`.

Revalidação final NA-0038 (2026-10-05): Chromium confirma que falha de painel em segundo plano preserva o foco do terminal, retry por teclado recupera o FileManager sem nova conexão e timeout HTTP não recarrega a página. SFTP possui deadline por cinco minutos sem progresso. Capturas demonstrativas refeitas em frontend `engineering-hardening-local` e capítulos terminal/SFTP revisados após observar as telas. Evidências: `docs/reviews/evidence/2026-10-05-engineering-hardening/`; relatório: `docs/reviews/2026-10-05-engineering-hardening-implementation.md`.


## Revalidação — 2026-10-10 / NA-0054

Consolidação de stack e correções de lint: os procedimentos de Hosts, terminal,
compartilhamento, SFTP e troca de tenant permanecem válidos. Os ícones do terminal
agora são SVGs estáticos de um componente Vue; o manual renderiza apenas elementos
semânticos permitidos, sem HTML ativo. A versão continua injetada pelo build.

Executados em frontend local isolado (versão `na54-review`): experiência completa
do terminal, captura do manual, 60 estados de geometria/controle de compartilhamento
e dois ciclos de troca de tenant, sem reconexão. As cinco capturas demonstrativas
foram revistas quanto a legibilidade, enquadramento e ausência de dados reais.
Textos e permissões dos cinco capítulos foram revalidados antes de atualizar o
manifesto. O renderizador RichText passou oito grupos de verificações Chromium,
incluindo markup ativo/protocolos bloqueados, navegação e atualização reativa.

Evidências locais: `reports/NA-0054` no diretório operacional do workspace WSL;
artefatos definitivos por SHA e status de CI no PR #33. Não houve mudança funcional
de resize/transporte SSH nesta correção de lint; ensaio PTY real não foi repetido.
Homologação humana de release e implantação permanecem futuras.


## Revalidação — 2026-10-22 / NA-0059
Cards de acesso rápido compactados; capítulo Hosts explica relógio por hover, foco e toque, Esc e status ativo. QuickAccessHostCard.vue foi incluído no manifesto e seu hash foi atualizado após revisão de texto, capturas e testes.

Executados: typecheck frontend, lint do componente, regressão focada de cards em 1440/1024/390px, test:manual (2 Node + 18 Vitest), manual:capture com MANUAL_EXPECTED_VERSION=dev e manual:check-reviewed. Captura oficial validou manual, 60 estados de compartilhamento e dois ciclos de tenant sem reconexão; cinco imagens foram inspecionadas. Evidências adicionais dos cards: /tmp/nodeaccess-quick-access-after. Dados simulados, sem conexão com hosts reais.

Limitação: suíte completa de acessos recentes falhou na espera do erro de recuperação de pastas; a regressão focada dos cards passou. Não houve alteração de área útil do terminal nem transporte SSH.


### Ajuste complementar — 2026-10-22 / NA-0059
Relógio/data DD/MM após a pasta, tooltip com data por extenso, protocolo à direita e máscara _root_ → Raiz. Capítulo Hosts atualizado e hash recalculado após revisão. Reexecutados typecheck, lint, regressão focada em três larguras, test:manual (20 testes), manual:capture com versão dev. Capturas oficiais e novas capturas dos cards revisadas; evidências em /tmp/nodeaccess-quick-access-v2. Sem mudança no procedimento de conexão ou transporte.


### Correção de raiz — 2026-10-22 / NA-0059
Identificador real __root__ incluído na máscara Raiz, preservando _root_. Texto do capítulo revalidado sem mudança. Chromium sem cache confirmou antes/depois; regressão focada em três larguras, typecheck, lint, test:manual e manual:capture passaram. Cinco capturas oficiais e captura da raiz revisadas. Evidências: /tmp/nodeaccess-root-fix. Hash de Hosts atualizado após revisão.


### Ícones de protocolo — 2026-10-22 / NA-0059
Capítulo Hosts atualizado para SVG de SSH/RDP/Telnet/VNC antes do nome, tooltip e foco por teclado; selo inferior removido e sessão ativa preservada. HostProtocolIcon.vue incluído no manifesto. Typecheck, lint, regressão focada em três larguras/quatro protocolos, manual:capture e test:manual passaram. Cinco capturas oficiais e quatro cards de protocolo revisados. Evidências em /tmp/nodeaccess-protocol-icons. Hash atualizado após revisão.


### Posição do protocolo — 2026-10-22 / NA-0059
Ícone movido para logo após o nome, preservando tooltip e teclado. Texto de Hosts ajustado. Regressão focada em três larguras/quatro protocolos, lint, manual:capture e test:manual passaram; cinco capturas revisadas e hash atualizado. Evidências em /tmp/nodeaccess-protocol-right.


### Tooltips — 2026-10-22 / NA-0059
Revalidado capítulo Hosts sem mudar procedimento. Duplicação corrigida por estado único e remoção do title nativo nos gatilhos customizados; PointerEvent preserva toque, e largura respeita viewport. Regressão focada, lint e typecheck passaram. manual:capture e test:manual passaram antes do refinamento final de eventos/largura; imagens oficiais revisadas e ajustes finais confirmados pela regressão e captura mobile. Evidências em /tmp/nodeaccess-tooltip-fix; hash atualizado após revisão.


### Caminho de pastas — 2026-10-22 / NA-0059
Capítulo Hosts explica tooltip com Raiz → Banco de dados → Dbs e possibilidade de hierarquia parcial. Utilitário incluído no manifesto e hash revalidado após inspeção. Testes unitários (4), typecheck, lint, regressão focada incluindo árvores corporativa/pessoal e ancestrais ausentes, manual:capture e test:manual passaram. Cinco imagens oficiais e captura do fluxo revisadas. Evidências em /tmp/nodeaccess-folder-path.


### Protocolo no canto superior direito — 2026-10-22 / NA-0059
Capítulo Hosts atualizado para posição fixa no canto superior direito. Regressão focada em três larguras/quatro protocolos, lint, manual:capture e test:manual passaram. Cinco imagens oficiais e captura desktop revisadas; hash atualizado após revisão. Evidências em /tmp/nodeaccess-protocol-corner.


### 2026-10-22T20:27:22-03:00 — NA-0060 snippets e macros
Atualizado capítulo Terminal com editor de ações, Enter automático, espera literal/regex, timeout/cancelamento, fila, biblioteca/transferência e limitações do relatório do cliente. Fontes mapeadas ampliadas; hash editorial recalculado após revisão. manual:capture passou (manual, compartilhamento em 60 estados e tenant em dois ciclos); cinco PNGs demonstrativos inspecionados. test:manual passou (2 Node + 18 Vitest), terminal-experience:web passou, manual:check-reviewed passou. Playwright de snippets/editor/executor com fixtures passou; sem SSH/PTY real ou produção.

### 2026-10-23T00:50:34-03:00 — NA-0060 notificações de macros
Terminal documenta controle compacto e resultado temporário, sem histórico persistente sobre a sessão. test:manual, terminal-experience:web e manual:capture passaram; cinco PNGs revisados. Manifesto editorial Terminal atualizado após revisão. Captura usou MANUAL_EXPECTED_VERSION=dev; conexões simuladas, sem SSH real.

### 2026-10-23T00:58:28-03:00 — NA-0060 correção do formulário expect-send
Revalidado capítulo Terminal após correção do placeholder i18n, sem alteração de procedimento. test:manual e manual:capture passaram; cinco imagens revisadas. Playwright confirmou seleção/salvamento/reabertura e execução simulada. Manifesto recalculado após validação. Sem SSH real.

### 2026-10-23T08:15:38-03:00 — NA-0060 rodapé do formulário
Revalidação visual após unificar cor do rodapé Cancelar/Salvar com modal. Texto preservado; procedimento inalterado. test:manual/manual:capture passaram, cinco capturas inspecionadas. Hash Terminal atualizado após revisão; prints específicos desktop/mobile em /tmp/new-snippet-after-*.png.

### 2026-10-23T08:19:49-03:00 — Sugestão de preset do terminal
Manual atualizado: detecção usa plataforma do navegador; aplicar preset fecha/persiste sugestão. Simulação Windows/macOS/Linux, regressão terminal, test:manual e manual:capture passaram. Cinco imagens revisadas; hash editorial Terminal atualizado. Sem SSH real.


### 2026-10-23T08:35:46-03:00 — NA-0062 duplicação de host
Capítulo Hosts documenta origem/destino, ambos os menus, revisão do rascunho e limites de cópia. Macro mantém vínculo; links são cópias manuais; senha local/identidade/confiança/ACL específica não são copiadas. test:manual, manual:capture e manual:check-reviewed passaram; cinco capturas inspecionadas. Fonte host-duplicate.ts mapeada no manifesto e hash Hosts atualizado após revisão. Playwright de duplicação e regressão do formulário passaram com API simulada; sem cadastro em produção.

### 2026-10-23T08:56:38-03:00 — NA-0063 dashboard
Manual Hosts documenta acesso rápido do dashboard e mapeia DashboardView. manual:capture, test:manual, typecheck e regressão Playwright claro/escuro em 390/1024/1440 passaram. Cinco capturas do manual e capturas desktop/mobile do dashboard inspecionadas. Caminhos, tooltips, ACL e fallback simulados; sem SSH real. Hash editorial Hosts atualizado após revisão.

### 2026-10-23T11:43:23-03:00 — NA-0060 consolidação de macros
Capítulo Terminal atualizado para modelos, passos recolhíveis, amostra por espera, menu Mais ações, formatos anteriores e rascunho em memória. Cinco capturas do manual e capturas editor/biblioteca claro/escuro revisadas. manual:capture, test:manual e test:terminal-experience:web passaram. Playwright editor/executor, 66 testes específicos, suíte geral e MySQL descartável passaram. Ensaio OpenSSH/PTY descartável passou diretamente com MacroRunner; não certifica gateway/Vault/browser juntos. Hash editorial Terminal atualizado após revisão; sem publicação.

### 2026-10-23T14:50:58-03:00 — NA-0065 consulta rápida de IA
Terminal documenta @ia/@ai digitados, pergunta, escolha e inserção sem Enter, execução explícita e contexto separado. manual:capture (dev), test:manual e manual:check-reviewed passaram; cinco PNGs oficiais e capturas da consulta inspecionados. Playwright claro/escuro em três larguras, regressão terminal, typechecks e build passaram. Hash Terminal atualizado após revisão. Provider/SSH simulados; sem publicação.

### 2026-10-23T15:23:06-03:00 — NA-0065 pergunta junto ao cursor
Manual Terminal atualizado para foco automático, pergunta local, alternativas com ↑/↓, Enter de escolha separado da execução e @ia-ass/@ai-ass para análise contextual. manual:capture (dev), test:manual e manual:check-reviewed passaram; cinco imagens oficiais e capturas claro/escuro desktop/mobile inspecionadas. Regresão terminal e Playwright de IA passaram. Manifesto inclui contrato de alternativas e normalização; hash Terminal atualizado após revisão. Build/typechecks sem erro; sem provider/SSH real ou publicação.

### 2026-10-23T15:32:20-03:00 — NA-0065 motivos de recusa da IA
Manual Terminal distingue formato, bloqueio, aprovação e inserção não autorizada; documenta revisão da resposta e normalização de Markdown de uma linha. manual:capture (dev), test:manual e regressão terminal passaram; cinco capturas oficiais inspecionadas. Playwright validou motivos/conteúdo recusado. Teste com Ollama local passou pelo serviço e policy usando host de teste; sem SSH real. Hash editorial atualizado após revisão.

### 2026-10-23T15:59:02-03:00 — NA-0065 confiabilidade de consulta e assistente
Manual Terminal documenta erro/retry, cancelamento, rascunho, dica de atalhos, contexto explícito limitado e revisão conservadora por plataforma remota. manual:capture (dev), test:manual e regressão terminal passaram; cinco capturas oficiais e contexto desktop/mobile revisados. Ajuste final de contraste validado pelo Playwright claro. Manifesto ampliado e hash Terminal atualizado após revisão. Testes de HTTP descartável e modelo Ollama local sem comandos SSH; adapters externos simulados.

### 2026-10-23T16:44:34-03:00 — Revalidação da diversidade no @ia
Manual Terminal esclarece recomendação principal, alternativas úteis e situações de opção única. manual:capture (dev), test:manual (18 Vitest e verificações Node) e manual:check-reviewed passaram; cinco imagens demonstrativas inspecionadas. Hash editorial permanece atual; alteração localizada nas instruções backend não modifica fontes mapeadas. Teste real de portas confirmou pelo menos duas opções aprovadas pela política. Capturas usam fixtures; nenhum comando SSH executado.

### 2026-10-23T17:25:54-03:00 — NA-0066 importação Royal TS\nHosts documenta exportação CSV Royal TS, cabeçalhos, protocolo, hierarquia opcional, consentimento de credenciais e recuperação de erros. Parser/detecção/modal/contrato mapeados; hash Hosts atualizado após revisão. manual:capture dev, test:manual (2 Node + 18 Vitest), manual:check-reviewed e simulações Playwright passaram. Cinco capturas oficiais e nova aba em desktop/mobile revisadas. Fixtures sintéticas e API simulada; sem Royal TS instalado, importação em banco real ou SSH.\n
### 2026-10-24T14:43:31-03:00 — NA-0069 integração final
Hosts e Terminal revalidados após integração e formatação/tipagem exigida pelo CI. Procedimentos de duplicação, importação Royal TS, acesso rápido, macros e IA preservados; Terminal esclarece biblioteca somente leitura no trial. A atualização de ACL em pasta recarrega o bootstrap, sem mudar o procedimento. Cinco capturas de `manual:capture` dev já aprovadas e inspecionadas permanecem representativas; a formatação posterior não altera a renderização. Regressões de navegador normal/trial, macros, IA claro/escuro e terminal passaram; jornada local com SQL/API/MFA/SSH/SFTP e PTY top/htop passou. Revisor independente confirmou acesso recente completo em Vite frio após o ajuste de ACL. Hashes de Hosts/Terminal recalculados somente após essa revalidação. SMTP e provisionador simulados na jornada local; SSH descartável não comprova isolamento de VM real. Resultados em `docs/changes/2026/10/NA-0069-release-integration/frontend-evidence.md`.

### 2026-10-24T23:47:00-03:00 — NA-0073 nomenclatura do teste
Hosts e Terminal usam “teste” em vez de “degustação”, acompanhando menu, painel de laboratório e auditoria. Procedimentos, permissões, quota e prazo permanecem iguais. Alterações Vue limitadas a seis rótulos nos mesmos elementos: sem CSS, geometria útil do terminal, resize ou transporte. Não se justificou novo PTY por essa troca textual; a captura obrigatória verificou ajuda sem reconexão, compartilhamento e retorno entre tenants.

`test:manual` passou (2 testes Node e 18 Vitest). `manual:capture` passou em preview local frio5274, versão esperada2.1.0: cinco capítulos, piloto desligado por padrão, controles administrativos, ajuda integrada, mobile e falhas/retry; compartilhamento60 estados nos dois temas; troca tenant2 ciclos com sessão preservada e sem reconexão. Cinco PNGs demonstrativos foram inspecionados quanto a leitura/enquadramento; quatro diferiram dos arquivos anteriores. Fixtures sintéticas, API/SSH simulados, nenhuma captura ou conexão de produção. Duas tentativas anteriores não foram consideradas prova: versão esperada padrão incompatível e timeout no popup do preview compartilhado; a execução fria completa terminou com exit0. Hash Hosts recalculado por `loadManual()` somente após revisão; Terminal revalidado com hash de fonte inalterado. Lint dos três componentes passou. `manual:check-reviewed` executado após atualização do manifesto.

### 2026-10-25T22:43:21-03:00 — NA-0074 tenant de teste completo
Hosts diferencia o perfil completo, com cadastro e menus normais sujeitos a permissões/cotas, do perfil guiado legado. Recursos e limites ficam em seção recolhível; a preparação usa status real com consulta automática e atualização manual. Hosts demo permanecem gerenciados pelo sistema. Terminal distingue ferramentas normais do perfil completo das restrições guiadas. Prazo no menu recebe destaque dentro da janela configurada, sem acrescentar faixa à área útil do terminal.

Baseline frontend102 testes; após implementação105 passaram. `test:terminal-experience:web` passou tanto com tenant normal como com perfil full explícito. Browser Hosts full passou8cenários; painel guided/full passou390/768/1440 incluindo consulta automática e recuperação de erro. `manual:capture` passou em preview5275 com versão explícita2.1.0: ajuda, compartilhamento60estados e troca de tenant2ciclos sem reconexão. Cinco PNGs demonstrativos foram inspecionados e atualizados; não representam produção. `test:manual` passou (2Node+18Vitest). API/SSH/infraestrutura desses harnesses são simulados; não comprovam provisionamento, transporte remoto ou integração externa. Não houve alteração de resize/transporte; PTY real não foi executado nesta validação frontend. Hashes Hosts/Terminal recalculados por `loadManual()` após revisão; arquivos comuns da experiência e menu foram mapeados. Revisão independente e gates globais permanecem separados.

Complemento da mesma revisão: flags explicitamente desligadas no full ocultam snippets/túneis e bloqueiam o atalho; a presença não consulta túneis desabilitados.106 testes frontend passaram; browser dirigido confirmou os dois recursos ocultos e atalho bloqueado. Terminal normal/full e manual:capture foram repetidos após esses gates, com sucesso; as cinco imagens finais foram novamente inspecionadas. Onboarding6variações passou, incluindo matriz administrativa full e preservação de perfil salvo. Limites de IA foram acrescentados ao formulário administrativo conforme contrato backend (padrões100 solicitações e1 simultânea, sem alterar valor persistido existente). Esses ensaios continuam sintéticos; revisão backend independente é registrada separadamente pelo responsável da frente.

### 2026-10-28T09:01:44-03:00 — NA-0079 Hosts, disponibilidade e dashboard

Manual de Hosts atualizado para ícones acessíveis, disponibilidade de Agent/conector, conexão pelo dashboard e investigação de atenção/auditoria. Mapeados novos helpers, indicador e HostDashboard no manifesto. `manual:capture` passou em frontend local5284 com versão2.1.0: cinco capítulos, ajuda, compartilhamento60estados e troca de tenant. Cinco PNGs sintéticos inspecionados quanto a enquadramento/leitura; nenhuma captura de produção. `test:manual` passou (2Node+18Vitest), `test:terminal-experience:web` passou. Browser Hosts quatro cenários mobile/desktop cobriu rota obrigatória, DIRECT/AUTO, ACL, erro/retry e nova invalidação do cache após503; essa última correção não altera geometria. Hash de Hosts recalculado por `loadManual()` depois da revisão; `manual:check-reviewed` passou para os cinco capítulos. Transporte/resize não foram alterados; não se executou PTYSSH como parte desta revisão editorial. Reprodução de Ctrl+R em BashPTY local consta nas evidências NA0079.
