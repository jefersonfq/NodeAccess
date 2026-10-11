# Manual integrado — piloto de 24/09/2026

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
