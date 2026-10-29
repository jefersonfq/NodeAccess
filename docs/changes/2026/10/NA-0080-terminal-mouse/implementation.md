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
Validar com htop/top em host SSH descartável e confirmar o relato original. Simulações não comprovam ausência de todos os efeitos colaterais nem certificam o transporte SSH real. Mantidos os protocolos e caminhos textuais existentes; sem alteração da área útil do terminal. Frontend de teste iniciado em 127.0.0.1:5174.

## Diário de interações

### 2026-10-28T23:07:00-03:00 — Correção autorizada e regressões
Usuário autorizou corrigir e simular outras situações após o diagnóstico inicial. Implementado o encaminhamento binário e validado em Chromium com servidor simulado, testes unitários, tipos e manual. O sandbox de comandos apresentou erro de acesso a .git; operações locais foram executadas com revisão automática de escalonamento. Não houve publicação. Próximo passo: ensaio PTY com destino descartável configurado.

### 2026-10-28T23:25:49-03:00 — Pacote e envio à VPS autorizados
Usuário solicitou gerar o pacote e subir na VPS. Iniciada preparação da release 2.1.1-na0080 pelo empacotador oficial, com commit local necessário à proveniência limpa. GitHub/merge não fazem parte deste pedido. Solicitada definição entre somente envio e atualização da instalação, enquanto o preparo avança. Pré-requisitos dos agentes Windows/Linux/macOS passaram com a chave pública existente; seis testes de pacote/proveniência passaram. Inspeção remota somente leitura confirmou seis containers do projeto ativos e espaço disponível. Revisão independente iniciada. Ensaios, checksum, versão/SHA final e recibo de transferência serão preservados em /tmp/na0080-release-evidence, sem segredos. PTY real permanece pendente; nenhuma homologação humana inferida. Próximo passo: revisão, commit, gates no SHA final, build e envio verificado; operação da aplicação depende da definição de escopo.
