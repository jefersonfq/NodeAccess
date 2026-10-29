# NA-0080 — Registro da implementação

## Pedido e objetivo
Investigar cliques sem efeito no htop, corrigir e simular situações para identificar regressões. A investigação anterior encontrou ausência de onBinary; o usuário autorizou implementação e testes nesta interação.

## Implementação
Base SHA: 9a93fbd01e900cfa73eb6708199dcfe99592ae89.
Branch: fix/NA-0080-20261028-terminal-mouse.

- xterm-adapter.ts e types.ts expõem onBinary. O código instalado do CoreMouseService confirma que DEFAULT usa esse evento.
- useTerminal.ts converte a string binária diretamente para Uint8Array, preservando coordenadas acima de 127, estado conectado e broadcast já existente. Não passa eventos binários pelo modelo textual/IA.
- useSharedSessionViewer.ts exige canInput e socket aberto; ambos os fluxos descartam listeners na reconexão/desmontagem.
- Testes de sessão verificam bytes, conexão, revogação, expiração, encerramento e descarte. terminal-mouse-playwright.cjs verifica eventos reais do Chromium até o WebSocket simulado e integra a regressão existente.
- Manual: procedimentos de terminal e compartilhamento permanecem válidos. Capturas demonstrativas foram geradas e as cinco imagens inspecionadas; mantidas as imagens versionadas anteriores por não haver mudança visual, com novas evidências em /tmp. Hashes editoriais dos dois capítulos revalidados.

## Validação
- Ran: 51 testes em 4 arquivos — composables afetados, prefixo IA e diretório terminal; passaram. /tmp/na-0080-unit.log.
- Ran: suíte de compartilhamento repetida após acrescentar verificação binária em revogação/expiração/encerramento; passou. /tmp/na-0080-shared-final.log.
- Ran: npm run test:terminal-experience:web; passou. /tmp/na-0080-web.log e /tmp/nodeaccess-terminal-experience.json. Clique/soltura legado com coluna 100 (byte 132), wheel, SGR sem duplicação, clique de shell sem tracking e acentos UTF-8 passaram. Regressão existente cobre colagem central/multilinha, navegação, autocomplete, layout e resiliência simulada.
- Ran: npm run typecheck; passou para shared, backend e frontend. /tmp/na-0080-typecheck.log.
- Ran: npm run test:manual; passou (compilador Node e 18 testes Vitest). /tmp/na-0080-manual.log.
- Ran: MANUAL_EXPECTED_VERSION=dev FRONTEND_BASE=http://127.0.0.1:5174 npm run manual:capture; passou. A tentativa inicial falhou por expectativa padrão de versão 9.8.7-manual-test; repetição com a versão efetiva dev corrigiu a configuração do ensaio. /tmp/na-0080-capture.log, /tmp/nodeaccess-manual-review e /tmp/nodeaccess-shared-viewer-review.
- Ran: ESLint localizado passou após corrigir 4 acessos sem tipagem explícita aos mocks dos novos testes. Repetição final dos dois composables: 20 testes passaram. /tmp/na-0080-lint.log e /tmp/na-0080-final-tests.log.
- Ran: npm run manual:check-reviewed e git diff --check; passaram.
- Skipped (tentativa bloqueada por pré-requisito): npm run test:terminal-pty:real terminou exigindo HOST_ID de host descartável, ausente no ambiente. Nenhuma conexão a host de usuário foi realizada.

## Recuperação
Reverter o diff desta frente, usando a base acima como referência. Sem migration, dependência nova ou mudança de configuração persistente. Sem commit, merge ou publicação nesta interação.

## Pendências
Integração GitHub autorizada em 29/10/2026; executar gates no SHA documental final e registrar evidências no PR. Usuário confirmou teste local funcional em 29/10/2026; conferência interna da VPS concluída com versão e hashes corretos. PTY real e entrega frontend-only já concluídos conforme diário abaixo. Nova conferência pública e SSH confirmam versão, imagem e assets; falhas iniciais de acesso foram resolvidas após correção informada pelo usuário. Backups e recibos duráveis estão em backups/NA-0080-20261029, privados e excluídos do Git.

## Diário de interações

### 2026-10-28T23:07:00-03:00 — Correção autorizada e regressões
Usuário autorizou corrigir e simular outras situações após o diagnóstico inicial. Implementado o encaminhamento binário e validado em Chromium com servidor simulado, testes unitários, tipos e manual. O sandbox de comandos apresentou erro de acesso a .git; operações locais foram executadas com revisão automática de escalonamento. Não houve publicação. Próximo passo: ensaio PTY com destino descartável configurado.

### 2026-10-28T23:25:49-03:00 — Pacote e envio à VPS autorizados
Usuário solicitou gerar o pacote e subir na VPS. Iniciada preparação da release 2.1.1-na0080 pelo empacotador oficial, com commit local necessário à proveniência limpa. GitHub/merge não fazem parte deste pedido. Solicitada definição entre somente envio e atualização da instalação, enquanto o preparo avança. Pré-requisitos dos agentes Windows/Linux/macOS passaram com a chave pública existente; seis testes de pacote/proveniência passaram. Inspeção remota somente leitura confirmou seis containers do projeto ativos e espaço disponível. Revisão independente iniciada. Ensaios, checksum, versão/SHA final e recibo de transferência serão preservados em /tmp/na0080-release-evidence, sem segredos. PTY real permanece pendente; nenhuma homologação humana inferida. Próximo passo: revisão, commit, gates no SHA final, build e envio verificado; operação da aplicação depende da definição de escopo.

### 2026-10-28T23:44:39-03:00 — Atualização autorizada; staging e recuperação
Usuário confirmou envio e atualização da instalação. Build oficial 2.1.1-na0080 concluído; pacote completo e imagem frontend enviados, com SHA-256 conferido no destino. Revisão independente da correção e da operação retornou PASS_WITH_WARNINGS. Gates repetidos no SHA candidato: tipos, 51 testes, lint, manual, regressão completa Chromium e smoke do frontend extraído da imagem passaram. Comparação com fonte instalada confirmou ausência de mudanças em backend/agentes/Docker/scripts/dependências; operação preparada para recriar somente frontend. Seis serviços ativos e zero sessões observados no preflight; backup de imagem/configuração anterior criado na VPS. Ensaio PTY real com top e htop passou no laboratório descartável local, com evidências em /tmp/na0080-release-evidence/pty-real.

A revisão automática rejeitou a cópia de frontend-recovery.tar para o diretório privado /tmp/na0080-release-evidence por conter .env/credenciais sem autorização específica de saída desses dados. A transferência rejeitada não foi executada nem contornada. Solicitada autorização específica ao usuário; aguardando. Instalação continua na versão anterior, sem guard WebSocket aplicado e sem recriação. Recibos, hashes de imagens e fonte exata ficam em /tmp/na0080-release-evidence; não há push/PR/merge. Próximo passo: resolver destino autorizado do backup, verificar recuperação e então executar a troca revisada com checagem de versão/assets e saúde.

### 2026-10-28T23:45:58-03:00 — Evidência de clique real e limpeza do laboratório
Gate PTY real concluído: top e htop sem findings. Prova adicional com htop 2.2.0 confirmou troca de ordenação CPU (sort_key 46) para PID (sort_key 0) após clique no cabeçalho pelo Chromium → NodeAccess → SSH. Evidências e SHA em /tmp/na0080-release-evidence/pty-gate.json e htop-mouse-proof.json. Foram testadas as fontes do commit; a imagem final tem smoke separado de navegador. Limpeza concluída: processos locais de teste encerrados, host descartável desativado e credencial removida, arquivos HTOPRC apagados; containers preexistentes preservados. O banco local de testes recebeu duas migrations oficiais aditivas para rodar o candidato. Operação de produção permanece parada antes da troca aguardando decisão sobre a cópia privada do backup.

### 2026-10-29T01:25:45-03:00 — Autorização explícita do backup privado e ampliação
Usuário autorizou copiar o backup contendo credenciais e pediu backup de tudo para recuperação posterior. Cópia de recuperação frontend concluída e validada; preservada também em backups/NA-0080-20261029, diretório privado excluído do Git. Ampliado escopo para instalação NodeAccess e labs gerenciados (não imagem do SO/outros aplicativos VPS): SQL transacional, Redis RDB validado, auditoria, avatares, imagens atuais, ACTIVE/Compose/env, bind mounts, certificados/chaves e alvos de symlinks, site NodeAccess, provider e arquivos tmpfs dos três labs. Revisão independente operacional aplicada.

Coleta online: primeiro inventário abortou por arquivo .json.tmp transitório; tentativas de tar via exec nos labs abortaram por permissões internas. Tentativas incompletas preservadas, sem parar serviços. Coleta final usa exclusão localizada dos temporários do provider e docker cp para os diretórios dos labs, sem reduzir isolamento. Backup completo gerado em /opt/nodeaccess/backups/NA-0080-full-20261029-r4, com manifesto de 37 componentes. Configuração/provider e inventário de labs verificados antes/depois. Arquivo integral de aproximadamente 1,9 GB em transferência para backups/NA-0080-20261029. Limite: snapshots por componente e cópia online não equivalem a snapshot global, nem retomam processos. Próximo: verificação offserver, importação MySQL isolada e aplicação frontend-only revisada.

### 2026-10-29T01:35:54-03:00 — Backup completo validado e frontend atualizado
Backup completo final (aprox. 1,9 GB/37 componentes/3 labs) verificado por SHA-256 e gzip na VPS e em backups/NA-0080-20261029; manifesto, recibos e instruções privados mantidos junto aos artefatos. Restore SQL isolado sem rede passou com 103 tabelas. O ensaio precisou ajustar ownership do tmpfs (UID999) e aguardar a conclusão do bootstrap MySQL; tentativas locais falharam antes de certificar o restore, sem tocar produção. Container descartável removido após o teste. Não foi certificado restore integral da VPS; backup online por componente mantém essa limitação.

Após todos os gates, aplicada operação frontend-only revisada: zero sessões antes da troca, guard temporário contra novas WebSockets, recriação somente frontend e remoção do guard após saúde. Verificação pública confirmou versão 2.1.1-na0080, cinco assets com hashes idênticos à imagem testada, seis serviços ativos, outros cinco serviços e configuração do proxy preservados. Backend, banco, Redis, guacd e ponteiros da release base não foram trocados. Descriptor ACTIVE registra frontendOverride e imagem/fonte. Evidência exata em /tmp/na0080-release-evidence/deployment-verified.json e cópia privada em backups/NA-0080-20261029.

Estado Git: COMMITTED para o candidato do pacote; LOCAL_WIP somente do diário posterior à entrega; sem PUSHED/PR_OPEN/MERGED, MASTER_SYNCED desta frente pendente. Pedido de pacote/atualização não foi ampliado para publicação GitHub. Registro pós-operação permanece sem commit adicional para evitar ciclo recursivo de hashes. Operação VPS concluída; recomenda-se recarregar a página para carregar o novo frontend.

### 2026-10-29T08:53:43-03:00 — Retomada de contexto
Usuário pediu retomada. Consultados contexto, padrões, plano, diário e regras de recuperação. Git confirma branch da NA-0080, candidato commitado e somente este diário modificado. Recibo temporário de implantação não está mais em /tmp; localizada cópia durável em backups/NA-0080-20261029/deployment-verified.json. Não foram repetidos testes nem consultada a VPS nesta interação; entrega anterior é informada conforme registro. Próximo passo: definir continuidade após entrega, com integração GitHub ainda fora do escopo autorizado anterior.

### 2026-10-29T09:00:09-03:00 — Integração autorizada e conferência pública
Usuário autorizou seguir com integração GitHub e verificar a instalação. Fetch confirmou base atualizada, sem PR existente. HTTPS público respondeu e apresentou os cinco assets previstos e versão 2.1.1-na0080 no bundle; recibo atual em /tmp/na0080-public-recheck.json. SSH pelo domínio público:22 falhou com No route to host; solicitado destino/porta corretos. Revisão independente no candidato confirmou 51 testes em quatro arquivos e diff --check, sem defeito bloqueante; identificou apenas documentação de PTY/autorização desatualizada, corrigida nesta interação. Plano e registro operacional reconciliados com a entrega já executada. Solicitada homologação humana conforme skill; não inferida da autorização de integração. Próximo: commit documental, checks no SHA final, push e PR; merge condicionado aos gates. Nenhum serviço de produção alterado.

### 2026-10-29T09:02:40-03:00 — Gates finais e acesso informado
Ran: tipos, lint localizado, test:manual, manual:check-reviewed e test:terminal-experience:web passaram; revisão independente repetiu 51 testes no commit documental com PASS. Governança rejeitou rótulo Decisão técnica; corrigido para Decisão conforme parser, sem mudar a decisão. Usuário forneceu acesso VPS em arquivo local privado; conteúdo não será incluído nos registros ou no PR. Próximo: revalidar gate no candidato final, conferir VPS e publicar PR autorizado.

### 2026-10-29T09:04:47-03:00 — Homologação local e acesso SSH
Usuário confirmou funcionamento no ambiente local e relatou dúvida sobre atualização da VPS. HTTPS público confirma 2.1.1-na0080 e readiness ok. Com a porta do arquivo privado, SSH respondeu; chave OpenSSH com CRLF foi normalizada somente em cópia temporária 0600, removida após cada tentativa, mas a senha fornecida não desbloqueou a chave. Identidade SSH preexistente também não foi aceita. Solicitada correção no arquivo privado; sem alteração na VPS. Governança passou após corrigir o rótulo da decisão. Homologação humana local registrada, distinta de conferência interna da produção. Próximo: publicar PR, acompanhar CI e retomar inspeção VPS com acesso corrigido.

### 2026-10-29T09:05:56-03:00 — VPS conferida por SSH
Após correção de acesso fornecida pelo usuário, Ran: consulta somente leitura confirmou imagem frontend idêntica ao recibo da entrega, versão 2.1.1-na0080 no bundle, seis serviços NodeAccess ativos e SHA-256 dos cinco assets do container idênticos aos obtidos por HTTPS público. Readiness público ok. Nenhum restart ou deploy necessário. Recibo privado durável recheck-20261029.json preservado junto aos backups. Informado que a entrega alterou somente frontend e orientada recarga da aba para testar nova sessão. Teste local funcional homologado pelo usuário; teste humano na VPS não foi declarado. Próximo: gates no SHA final, PR, checks GitHub e integração autorizada.
