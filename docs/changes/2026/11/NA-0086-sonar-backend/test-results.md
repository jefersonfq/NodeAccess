# NA-0086 — Validações locais

Executadas em `/tmp/nodeaccess-NA-0086`, Node 24.21.0. `PATH` usa o Node instalado em `/root/.npm/_npx/538786c08bcb9442/node_modules/node/bin`. Não foram executadas no checkout canônico nem na VPS.

| Validação | Resultado observado |
|---|---|
| `npm run build -w packages/shared` | PASS |
| `npm run build -w apps/backend` | PASS |
| `npx vitest run apps/backend/src packages/shared/src --reporter=dot` | 1.958 PASS, 120 skipped; 198 arquivos PASS, 25 skipped; 31,57 s |
| Mesmo comando com `--coverage` | Testes PASS; comando FAIL por cobertura; 41,58 s |
| Cobertura global | statements 39,95%; branches 34,50%; functions 40,27%; lines 40,93%; exigidos lines/functions 70%, branches 60% |
| Storage/upload e suites adjacentes | 22 testes PASS em 7 arquivos antes do caso adicional UUID |
| `npx vitest run apps/backend/src/modules/ai-ssh-actions/ai-script-upload.test.ts --reporter=dot` | 3 PASS, incluindo UUID e segunda tentativa |
| `node --test apps/agent/src/agent-security.test.js apps/agent/src/local-listeners.test.js` | 7 PASS |
| `git diff --check` | PASS |

Casos exercitados: raiz 0755 pertencente ao serviço, arquivos 0600, diretórios 0700, travessia, raiz compartilhada, symlink na raiz/subdiretório/destino, leitura concorrente sem conteúdo parcial, gzip audit roundtrip, criação exclusiva SFTP, colisão sem chmod/exec, UUID persistido antes da aprovação e recusa de reaproveitamento de artefato finalizado. Parsing usa strings adversariais com 100 mil caracteres e equivalência de tokens malformados; máscaras incluem separador Unicode. SCIM rejeita cabeçalho excessivo antes de consultar banco. Listener sem política nega abertura antes do socket.

A primeira execução de parsing falhou por resolver o shared canônico através do node_modules compartilhado. Foi corrigido o ambiente de teste: link **somente no worktree** `apps/backend/node_modules/@nodeaccess/shared` aponta ao pacote local compilado. A execução completa acima já usou esse isolamento. Não houve alteração do pacote canônico.

A execução parcial inicial de auditoria sob cobertura passou 269 testes, com 9 skipped, mas falhou o gate global por instrumentar apenas parte da suíte. O resultado global acima também permanece abaixo dos limites; não é chamado de aprovado. Nenhum timeout foi aumentado e nenhum limiar foi reduzido.

Skipped: suites opt-in com MySQL/Redis/provedores/SSH reais e demais condições externas; não representam PASS. Sem transporte PTY/resize ou área visual alterados. As mudanças Number.isNaN em rotas recebem valores já convertidos por Number, sem alteração de contrato WebSocket. Não há evidência de UI; OpenSSH real foi posteriormente validado em container local descartável, conforme seção abaixo.

Logs locais privados: `/tmp/na0086-full-tests.log`, `/tmp/na0086-full-coverage.log`, `/tmp/na0086-storage-upload-tests.log`, `/tmp/na0086-upload-repeat.log`, `/tmp/na0086-agent-tests.log`, `/tmp/na0086-shared-build.log`, `/tmp/na0086-backend-build.log`. Reanálise SonarQube fica a cargo da frente raiz; estas disposições não afirmam redução observada no servidor.

## Revalidação após ajuste de rollback

Substituído UUID por nonce criptográfico de 128 bits em decimal para preservar o validador legado. `npx vitest run apps/backend/src/modules/ai-ssh-actions --reporter=dot`: 17 testes PASS em 5 arquivos (1,53 s). `npm run build -w apps/backend`: PASS. Testes comprovam nonce dentro de 128 bits e distinto do ID, destino decimal aceito, caminho persistido enviado à aprovação e colisão na repetição. Logs: `/tmp/na0086-artifact-backcompat.log` e `/tmp/na0086-backcompat-build.log`. A suíte global anterior não foi repetida: este ajuste ficou restrito à geração/formato do destino, e a suíte inteira do módulo foi revalidada.

## Regressão encontrada na revisão independente de prompt

Prompts como `[u@h\r /srv]$` e `[u@h\n /srv]$` devem conservar `/srv`. Scanner corrigido para permitir CR/LF no separador, sem aceitar CR/LF dentro do caminho. Teste compara 1.960 combinações contra a gramática legada e preserva comportamento do primeiro match com caminho só whitespace. `npx vitest run apps/backend/src/modules/session-audit --reporter=dot`: 282 PASS, 9 skipped, 13 arquivos PASS e 2 skipped; 3,48 s. Log: `/tmp/na0086-prompt-compatibility.log`.

Build posterior: `npm run build -w apps/backend` PASS (exit 0), log `/tmp/na0086-prompt-build.log`.

## SFTP contra OpenSSH real descartável

Harness versionado: `apps/backend/src/modules/ai-ssh-actions/ai-script-upload.real.test.ts`.

Reprodução (Node 24.21+, Docker local, dependências instaladas e imagem **já disponível**):

```sh
RUN_AI_SCRIPT_SFTP_REAL=true npx vitest run apps/backend/src/modules/ai-ssh-actions/ai-script-upload.real.test.ts --reporter=verbose
```

Sem a variável opt-in, a suíte é ignorada. O harness não aceita host, usuário ou credencial externos. Resolve a imagem local para seu ID antes de executá-la com `--pull=never`, cria rede e container próprios, publica porta dinâmica somente em 127.0.0.1 e remove ambos ao terminar. Não usa volumes do usuário. A senha aleatória é transmitida via stdin, e o cliente confere a chave Ed25519 gerada no container. Subprocessos Docker possuem timeout; container tem limites de memória, CPU e PIDs.

Ambiente observado:

- Docker Engine 28.1.1.
- Imagem local `nodeaccess-trial-ssh:2.1.0`, ID `sha256:37833d3705d14ed63585d5107448b1347082733f86150ff48bb2f42f9ebf34a9`.
- OpenSSH 10.0p2, OpenSSL 3.5.9.
- Resultado: **3 testes PASS**, 1 arquivo PASS, 6,10 s.

| Comportamento real | Resultado |
|---|---|
| ssh2/SFTP `flag: wx`, modo 0600, 65.536 bytes binários mais prefixo Unicode | Arquivo criado, bytes idênticos e modo 0600 |
| Segundo upload no mesmo caminho | Falha; conteúdo e modo 0600 preservados |
| Arquivo preexistente 0640 | Colisão recusada, conteúdo e modo preservados |
| Symlink preexistente | Upload recusado, alvo preservado |
| Método real `uploadScript` | Script 0700 com conteúdo íntegro e sha256sum remoto validado |
| Repetição do uploader real | Falha; conteúdo e modo 0700 preservados |

O modo 0700 do script é intencional e difere do arquivo de dados 0600. O conteúdo do script não foi executado; foi executado somente o comando de checksum usado pelo uploader. Não é simulação do servidor: o teste conecta ssh2 ao OpenSSH do container e usa SFTP real.

Tentativas iniciais com rede Docker `--internal` falharam antes dos testes por não publicar a porta; os três casos ficaram skipped nessas tentativas, sem alegação de PASS. A versão final usa bridge dedicada e bind exclusivo em loopback. Container e rede foram removidos; consultas Docker pelo prefixo do harness não encontraram recursos restantes. Não houve pull ou publicação de imagem, conexão a host do usuário ou mudança em produção.

Log privado local: `/tmp/na0086-sftp-real.log`. Esta evidência complementa as simulações anteriores; não substitui homologação humana ou validação de outros serviços externos.

Build do harness: `npm run build -w apps/backend` PASS (exit 0), log `/tmp/na0086-sftp-real-build.log`. Execução sem opt-in: 3 skipped, 1 arquivo skipped, sem fixture Docker; log `/tmp/na0086-sftp-default-skip.log`.

Revisão independente do harness pediu deadline total em vez de apenas limite por tentativa. Setup agora tem 25 s monotônicos, conexão no máximo 15 s dentro do orçamento, abertura SFTP limitada ao restante e Docker limitado pelo mesmo deadline. beforeAll mantém 30 s. Reexecução real final: 3 PASS, 5,28 s, log `/tmp/na0086-sftp-real-deadline.log`; container/rede novamente ausentes após cleanup.

Build posterior ao deadline: PASS (exit 0), `/tmp/na0086-sftp-deadline-build.log`.

## Bearer SCIM linear após reanálise

A reanálise integrada ainda sinalizou o regex original, mesmo com limite de entrada. Substituído por leitura linear de prefixo/separador/token. `npx vitest run apps/backend/src/modules/auth/scim.service.test.ts apps/backend/src/modules/auth/scim.routes.test.ts --reporter=dot`: 17 PASS em 2 arquivos (857 ms). Inclui 378 combinações equivalentes ao regex legado, 100 mil espaços, hash consultado pelo serviço e rejeição antes do banco para token com quebra de linha. Logs `/tmp/na0086-scim-linear.log` e `/tmp/na0086-scim-linear-build.log`. Nova observação Sonar pendente da frente raiz.

Build posterior ao parser SCIM: `npm run build -w apps/backend` PASS (exit 0).
