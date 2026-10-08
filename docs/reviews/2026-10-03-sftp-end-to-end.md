# Revisão SFTP — 2026-10-03

Registro histórico da investigação anterior às correções. Consulte a [aplicação das correções e validação final](2026-10-03-sftp-fixes.md) para o estado posterior.

## Resultado

Oito grupos de problemas reproduzidos. Prioridade: permissões de backup/restauração, exposição de segredos no diff e limite de leitura do editor. Esta entrega acrescenta testes e evidências; não modifica o comportamento do produto.

As alterações preexistentes em `FileManager.vue` e `FileEditorModal.vue` foram preservadas. O manual não foi alterado, pois nenhum procedimento do produto mudou nesta revisão.

## Cobertura e resultados

| Camada | Executado | Resultado e limite |
| --- | --- | --- |
| Unitários e contratos HTTP | 209 casos selecionados: controller/serviço SFTP, canal do terminal, recuperação REST, configurações e normalização de auditoria | 205 verificações normais passaram; 4 falhas conhecidas usam `it.fails` |
| OpenSSH real | 6 casos: CRUD Unicode, edição, conflito de versão, backup/download/diff/restauração, caminhos inválidos, arquivo grande, permissões e interface integrada | 5 verificações normais passaram; 1 falha conhecida usa `it.fails` |
| Chromium CDP existente | 10 cenários, incluindo gerenciador, criação de arquivo, negação de acesso, tela de auditoria, diff, restauração e auditoria em mobile | Passou; respostas da API e registros da auditoria são simulados |
| Playwright conectado via CDP | 7 cenários de falhas/UX/configurações | 5 reproduções de problemas; sucesso e erro ao salvar política passaram; sem exceções JavaScript |
| Interface → HTTP → ssh2 → OpenSSH | Upload, download, renomeação e exclusão usando arquivos descartáveis | Passou; conteúdo remoto, nome do download e ausência do arquivo excluído conferidos |
| Terminal | `test:terminal-experience:web` completo | Passou; reutilização SFTP, ausência de REST desnecessário, recuperação transitória e limpeza de solicitações pendentes |
| Qualidade do harness | Sintaxe Node e diff whitespace | Passou |

**Os totais verdes do Vitest não significam ausência de bugs.** `it.fails` exige que a expectativa de comportamento correto falhe. Há 4 dessas reproduções na suíte de revisão e 1 na suíte real. Remover o marcador quando o respectivo defeito for corrigido.

O servidor usado foi um container OpenSSH descartável, com credenciais de teste e porta publicada apenas em `127.0.0.1`. Nenhum host cadastrado nem arquivo real do usuário foi usado.

## Achados reproduzidos

### SFTP-08 — Alta: backup e restauração ampliam permissões

- Causa: o backup é criado por upload sem reaplicar metadados. A restauração também cria um temporário sem preservar metadados antes da substituição.
- Evidência real: original `0600`, backup `0666`, arquivo após edição `0600`, arquivo após restauração `0666`. O editor preservou o modo do arquivo final; backup/restauração não preservaram.
- Impacto: arquivos privados podem ganhar leitura/escrita para outros usuários que consigam atravessar os diretórios do caminho. A restauração também não passa pela política de preservação usada na edição.
- Reprodução: criar arquivo `0600`, editar pela rota `/write`, consultar o modo do backup, restaurar pela rota `/restore-backup` e consultar o modo final.
- Correção indicada: criar backups com modo restritivo e preservar metadados pertinentes; reaplicar metadados e avaliar a política antes de substituir o arquivo restaurado. Validar dono/grupo e comportamento de erro separadamente.
- Arquivos: `apps/backend/src/modules/sftp/sftp.controller.ts`, `sftp.service.ts`.
- Teste: `sftp.real.test.ts`, caso `SFTP-08`.
- Evidência: [observations.json](evidence/2026-10-03-sftp/observations.json).

### SFTP-03 — Alta: mascaramento incompleto de segredos

- Causa: `maskSensitiveLine` cobre atribuições simples com valor sem espaços; não reconhece a chave JSON com aspas e mascara somente o primeiro trecho de um valor entre aspas com espaços.
- Reprodução: `"password": "CANARY-secret"` permanece visível; `password="first second third"` deixa `second third` visível.
- Impacto: o diff mostrado na auditoria e a prévia persistida durante edição podem expor partes ou a totalidade do segredo.
- Correção indicada: ampliar o mascaramento para formatos suportados, com testes de JSON, valores entre aspas, espaços, multiline e cabeçalhos. Para formatos desconhecidos, omitir a prévia em vez de assumir que ficou segura.
- Arquivo: `apps/backend/src/modules/sftp/sftp.controller.ts`.
- Testes: `sftp.review.test.ts`, dois casos `SFTP-03`.

### SFTP-02 — Alta: corte de arquivo sem sinalizar truncamento

- Causa: quando o acumulado chega exatamente a 1 MiB, os próximos blocos são ignorados sem alterar `truncated`. A resposta ainda contém hash da parte lida.
- Reprodução determinística: stream com um bloco de 1.048.576 bytes seguido de `TAIL`; `content` é cortado, mas `truncated` fica falso.
- Impacto: a proteção de salvamento usa `before.truncated`. Nesse particionamento de stream, pode permitir salvar apenas o conteúdo parcial e gerar um backup igualmente parcial.
- Correção indicada: detectar qualquer byte além do limite, sinalizar truncamento e remover o hash de conteúdo completo; considerar o tamanho obtido por `stat` como proteção adicional.
- Arquivo: `apps/backend/src/modules/sftp/sftp.service.ts`, `readFile`.
- Teste: `sftp.review.test.ts`, caso `SFTP-02`.
- Limite da evidência: o teste determinístico reproduziu a falha; o arquivo de 2 MiB no OpenSSH deste ensaio foi corretamente marcado como truncado. A ocorrência depende das fronteiras dos blocos.

### SFTP-01 — Média: criar pasta retorna HTTP 400

- Causa: `sftpService.mkdir` envia corpo `{}` com `path` na query. A rota exige `body.path`; a validação do Fastify impede chegar ao fallback do controller.
- Reprodução: abrir “Nova pasta”, preencher e clicar “Criar”. Resposta: `body must have required property 'path'`.
- Impacto: criação de pasta pela interface falha, embora a chamada HTTP com corpo correto funcione.
- Correção indicada: enviar `{ path, sessionId }` no corpo, como nas demais operações equivalentes.
- Arquivos: `apps/frontend/src/services/sftp.service.ts`, `apps/backend/src/modules/sftp/sftp.routes.ts`.
- Evidências: teste HTTP real com `inject` e [captura](evidence/2026-10-03-sftp/SFTP-01-mkdir.png).

### SFTP-04 — Média: caminho e lista divergem após erro

- Causa: `navigate` muda `currentPath` antes da listagem; `loadDir` mantém as entradas anteriores quando ocorre erro.
- Reprodução: na raiz, abrir pasta com resposta 403. O breadcrumb aponta para a pasta negada, mas `root.txt` da raiz continua exibido.
- Impacto: usuário perde a confiança no destino mostrado; ações podem usar o caminho atual enquanto a tabela apresenta outro diretório.
- Correção indicada: só confirmar a navegação depois do sucesso, ou limpar a lista e apresentar um estado de erro ligado ao caminho solicitado.
- Arquivo: `apps/frontend/src/components/FileManager.vue`.
- Evidência: [captura](evidence/2026-10-03-sftp/SFTP-04-stale-path.png).

### SFTP-05 — Média: resposta atrasada substitui navegação mais recente

- Causa: listagens não usam cancelamento ou identificador de solicitação para descartar respostas antigas.
- Reprodução: abrir `/slow`, reter sua resposta, voltar à raiz e receber a lista da raiz; então liberar `/slow`. A lista passa a mostrar `slow-only.txt` sob o breadcrumb da raiz.
- Impacto: tabela pode apresentar dados de outro caminho. O mesmo padrão merece validação ao trocar host/sessão durante uma solicitação.
- Correção indicada: guardar contexto da solicitação e aceitar somente a resposta vigente; invalidar requisições ao trocar host/sessão e ao desmontar.
- Arquivo: `apps/frontend/src/components/FileManager.vue`.
- Evidência: [captura](evidence/2026-10-03-sftp/SFTP-05-navigation-race.png).

### SFTP-06 — Baixa: download perde mensagem do servidor

- Causa: a requisição usa `responseType: 'blob'`; o helper de erro espera `response.data.message` em objeto JSON.
- Reprodução: download retorna 403 com mensagem específica. A interface mostra apenas o fallback genérico.
- Impacto: usuário não distingue problemas como acesso negado, ausência de arquivo ou indisponibilidade.
- Correção indicada: decodificar a resposta Blob de erro antes de extrair o JSON, sem alterar o tratamento do arquivo baixado com sucesso.
- Arquivo: `apps/frontend/src/services/sftp.service.ts` e consumidores de download.
- Evidência: [captura](evidence/2026-10-03-sftp/SFTP-06-blob-error.png).

### SFTP-07 — Média: operação prejudicada em mobile e por teclado

- Causa: árvore mantém largura inicial de 240 px; listagem e toolbar são cortadas em viewport estreito. Linhas não recebem foco e ações ficam no menu acionado por botão direito.
- Evidência em 390 px: tabela começa em `x=302` e termina em `x=668`; o container corta o conteúdo. Nenhuma linha da tabela é alcançável por Tab.
- Impacto: pouco espaço para arquivos, ações ocultas em telas menores e ausência de caminho de teclado para editar/baixar/renomear/excluir.
- Correção indicada: árvore recolhível em mobile, toolbar adaptável, ações explícitas e foco/navegação por teclado. Revisar semântica, foco e fechamento dos overlays customizados.
- Arquivo: `apps/frontend/src/components/FileManager.vue`.
- Evidência visual revisada: [captura](evidence/2026-10-03-sftp/SFTP-07-mobile-keyboard.png).

## Dependências e limites da certificação

- ACL: negação de `connect` verificada para 9 operações, antes de resolver credenciais; argumentos de tenant e usuário conferidos. A fonte ACL é simulada nesses testes.
- Política SFTP: papel admin, tenant autenticado e limites mínimos/máximos testados no contrato da rota; sucesso/erro testados na tela; política estrita e limites do diff cobertos nos testes existentes.
- Auditoria: chamadas reais do controller e conteúdo de metadados conferidos; tela, filtro, diff e restauração cobertos com registros simulados. Persistência/consulta MySQL e isolamento SQL não foram certificados por este ensaio.
- Terminal: transporte SFTP e recuperação testados com WebSocket simulado; o gerenciador dedicado fez operações contra OpenSSH real. Não houve mudança de resize, transporte SSH ou área útil do terminal no produto.
- Autenticação: token e `jwtVerify` são fixtures. Este ensaio não certifica login/MFA, renovação de sessão ou revogação durante transferência.
- Bastion, PEM/passphrase, 1Password, agente/private access e múltiplas instâncias: não certificados em integração real nesta revisão. O serviço REST SFTP abre conexão própria; a compatibilidade desses modos merece ensaios dedicados, especialmente porque listagem no terminal pode usar outro transporte.
- Quota, disco cheio, diretório não vazio e conexão perdida: códigos e auditoria testados com erros simulados; não houve injeção dessas falhas no sistema operacional do container.
- Não foi realizado teste de carga, arquivo de vários GB, medição de memória sob transferências simultâneas, nem certificação exaustiva de symlinks e concorrência de escrita.

## Como repetir

Testes unitários/contratos:

```bash
npx vitest run apps/backend/src/modules/sftp/sftp.review.test.ts \
  apps/backend/src/modules/sftp/sftp.controller.test.ts \
  apps/backend/src/modules/sftp/sftp.service.test.ts \
  apps/frontend/src/services/api-sftp-recovery.test.ts \
  apps/frontend/src/services/terminal-sftp-channel.service.test.ts
```

Simulações de usuário (frontend e Chromium CDP iniciados):

```bash
FRONTEND_BASE=http://127.0.0.1:5179 \
CHROMIUM_CDP_URL=http://127.0.0.1:9353 \
node tools/frontend/sftp-review-playwright.cjs
```

Integração real opt-in, exclusivamente contra servidor descartável:

```bash
RUN_SFTP_REAL=true RUN_SFTP_BROWSER=true \
FRONTEND_BASE=http://127.0.0.1:5179 \
SFTP_TEST_HOST=127.0.0.1 SFTP_TEST_PORT=22283 \
SFTP_TEST_USER=sftptest SFTP_TEST_PASSWORD=disposable-sftp-review \
npx vitest run apps/backend/src/modules/sftp/sftp.real.test.ts
```

O teste cria diretório com UUID dentro da home remota e o limpa ao concluir. A integração real não executa no `npm test` normal; a etapa de browser também é opt-in. Permissões exatas observadas dependem do umask do servidor, mas o contrato de arquivo privado exige preservar `0600`.

## Artefatos

- [Vitest core](evidence/2026-10-03-sftp/core.json), [Vitest real](evidence/2026-10-03-sftp/real.json).
- [Playwright — falhas e configurações](evidence/2026-10-03-sftp/playwright.json).
- [Browser com OpenSSH real](evidence/2026-10-03-sftp/live-browser.json) e [captura](evidence/2026-10-03-sftp/live-browser.png).
- [CDP — gerenciador e auditoria](evidence/2026-10-03-sftp/cdp-baseline.json).
- [Terminal](evidence/2026-10-03-sftp/terminal.json).
- [Auditoria desktop](evidence/2026-10-03-sftp/sftp-audit-screen.png), [diff](evidence/2026-10-03-sftp/sftp-audit-masked-diff.png), [auditoria mobile](evidence/2026-10-03-sftp/sftp-audit-mobile.png).

Ordem sugerida para correções: SFTP-08 → SFTP-03 → SFTP-02 → SFTP-01 → SFTP-04/05 → SFTP-07 → SFTP-06. Cada correção deve transformar sua reprodução em regressão normal e, quando mudar o procedimento/interface mapeada, revalidar o capítulo SFTP do manual.
