# NA-0086 — Registro da implementação

## Pedido e objetivo

Tratar as 98 ocorrências atribuídas ao backend/shared/agent, em branch recuperável, com revisão individual, testes e revisão independente. Sem publicação ou instalação em VPS.

## Implementação

Base SHA: `3aa551378`. Worktree: `/tmp/nodeaccess-NA-0086`.

Storage passa a validar dono, permissões e symlinks, criar arquivos exclusivos e publicar por rename atômico. Mantém caminhos existentes. Upload de scripts usa destino com nonce criptográfico de 128 bits codificado em decimal, persistido antes da aprovação e criação exclusiva; colisão não sobrescreve nem chmod o arquivo anterior. Reexecução de artefato finalizado permanece proibida, exigindo novo preparo/aprovação.

Scanners lineares tratam barras finais, JSON cercado e tokens de links. Auditoria evita reconstrução sem backspace e processa somente a última linha para detectar prompt; whitespace, caminho entre colchetes e inferência de comando eliminam retries ambíguos. SCIM limita o cabeçalho antes de parsing e valida e-mail sem backtracking; máscara SFTP descarta a cauda inteira após chave sensível. Number.NaN/Number.isNaN e conversão direta removem redundância preservando entrada numérica prévia.

## Validação

Ran no worktree, Node 24.21.0: builds shared/backend; 1.958 testes backend/shared passaram, 120 testes opt-in ignorados. A execução com cobertura também passou todos os testes, incluindo exportação TXT fragmentada, mas o gate global de cobertura falhou (linhas 40,93%, funções 40,27%, branches 34,50%; exigidos 70/70/60). Limites e timeouts não foram alterados.

Storage/upload: 22 testes passaram antes do caso adicional UUID/repetição; depois, os 3 testes de upload passaram. Agent: 7 testes passaram, incluindo política padrão que bloqueia listeners. Evidências resumidas e comandos ficam em `test-results.md`; logs brutos permanecem locais em `/tmp/na0086-*.log`.

O node_modules da raiz é compartilhado, portanto foi criado um link ignorado apenas em `apps/backend/node_modules/@nodeaccess/shared` para o pacote deste worktree. Isso evita testar inadvertidamente o shared canônico. Nenhuma dependência canônica foi alterada.

## Recuperação

Commits locais separados por lote, revertíveis em ordem inversa. Não há migração de banco ou mudança de caminho de storage. Rollback não desfaz automaticamente o endurecimento de permissões já aplicado em runtime; deve-se manter UID coerente entre serviços. Os novos destinos decimais permanecem compatíveis com o validador legado e não dependem do ID do artefato.

## Pendências

Revisão independente e reanálise integrada pela frente raiz. Gate global de cobertura não aprovado. OpenSSH real foi validado em container local descartável; demais serviços externos e homologação humana não foram executados nesta frente. API/gateway devem usar o mesmo UID; raízes inseguras precisam ajuste operacional. MD5 TACACS é legado intencional de protocolo, não segurança moderna. Sem alterações de UI: prints não se aplicam. Rotina Sonar e planilha viva pertencem à frente raiz.

## Diário de interações

### 2026-11-03T14:15:00-03:00 — Remediação integral autorizada

Usuário autorizou todos os achados, branches separadas e testes. Plano criado antes das alterações; 98 ocorrências atribuídas. Protocolo, políticas de acesso e bytes deliberados recebem revisão individual, sem supressão cosmética.

### 2026-11-03T14:31:00-03:00 — Validação local e lote de storage

Revisão do agente raiz pediu teste de concorrência, rejeição de raízes inseguras e repetição legítima do script. Incluídos: leitores concorrentes só observam arquivos completos; arquivos/symlinks existentes não são sobrescritos; UUID é persistido antes da aprovação; repetição do mesmo upload colide e artefato finalizado não é reaprovado. Suites passaram; cobertura global permanece abaixo do gate, sem mascaramento. Próximo passo: checkpoints dos lotes e revisão independente.

### 2026-11-03T14:32:43-03:00 — Checkpoints e disposições

Lotes de storage/scripts, scanners, auditoria e validações foram registrados em commits locais separados, com no máximo cinco correções lógicas por lote. Todas as 98 ocorrências têm justificativa e evidência individual; 24 corrigidas e 74 revisadas em contexto. Criado índice consultável. Teste adicional de listener confirmou negação padrão antes de abrir socket. Próximo passo: sincronizar os documentos canônicos e revisão independente da frente raiz.

### 2026-11-03T14:36:17-03:00 — Revisão independente da rotina Sonar

Após concluir esta frente, revisados sem alterações os arquivos ledger.mjs/validate.mjs e dependências da NA-0085. Os 22 testes das ferramentas passaram. Assinaturas e multiplicidade, limpeza de metadata antiga, checagem da análise corrente, segregação de env dos subprocessos e recusa de redirects foram verificados. Identificada lacuna: hotspots exportados não participavam do gate local; comunicada à frente raiz para correção/revisão. Recomendados testes de orquestração com análise antiga/concorrente e requisito explícito de tokens distintos. Revisão não equivale a aprovação final enquanto essa lacuna permanecer.

### 2026-11-03T14:37:16-03:00 — Compatibilidade de rollback do artefato

A revisão raiz propôs manter o formato numérico legado. Substituído UUID por 16 bytes criptográficos convertidos a decimal e restaurado o validador anterior. Confirmado que service/action service/runner usam destination persistido, sem reconstruir pelo ID. Testes incluem nonce distinto do ID, limite de 128 bits, aprovação do caminho exato e colisão na repetição. A suíte completa e cobertura relatadas acima antecedem somente este ajuste; a suíte de ai-ssh-actions e build backend foram repetidos após ele, conforme test-results.md. Criação exclusiva, persistência anterior à aprovação e CAS permanecem.

### 2026-11-03T14:38:45-03:00 — Revalidação da rotina Sonar após correções

Frente raiz corrigiu hotspots, exigiu tokens distintos e adicionou testes de orquestração com HTTP loopback real e executor simulado. Revisão independente repetiu 30 testes: todos passaram. Estados de hotspot não revisados/desconhecidos falham fechado; análise antiga, falha CE, troca concorrente e falha de cobertura não aprovam candidato. Corte aprovado tecnicamente com ressalvas documentadas: gate sem condições permanece warning, e hash da ocorrência não substitui revisão de alterações de contexto. Sugerida validação adicional de IDs CE não vazios em respostas malformadas.

### 2026-11-03T14:42:10-03:00 — Correção após revisão independente de prompt

A revisão da frente de ferramentas identificou diferença concreta: CR/LF entre host e caminho eram aceitos pelo regex legado, mas rejeitados pelo scanner inicial. Corrigido com passagem por delimitadores que admite whitespace multilinha apenas no separador, preservando restrições de usuário/host/path e primeiro match com caminho vazio. Incluídos 7 separadores explícitos e comparação de 1.960 combinações limitadas com a gramática anterior. Suite de auditoria: 282 PASS, 9 opt-in skipped. Build backend também passou (exit 0); correção registrada em checkpoint pequeno para nova revisão independente.

### 2026-11-03T14:48:19-03:00 — OpenSSH real descartável

A frente raiz solicitou validar wx sem host de usuário. Criado harness opt-in ai-script-upload.real.test.ts com imagem local já existente, porta dinâmica 127.0.0.1, rede dedicada, credencial sintética aleatória e host key Ed25519 verificada. Três testes passaram: criação 0600/integridade binária/repetição negada; preexistente 0640 e symlink preservados; uploader real cria script 0700, verifica checksum remoto e rejeita repetição. OpenSSH 10.0p2, imagem local identificada em test-results.md. Container e rede removidos; sem pull/build/publicação de imagem ou acesso a VPS. Docker não publicou porta em rede internal na primeira tentativa; fixture usa bridge dedicada com bind exclusivo em loopback. Build backend passou (exit 0). Sem opt-in, os 3 testes ficam skipped e nenhuma fixture é iniciada.

### 2026-11-03T14:50:37-03:00 — Deadline da fixture real após revisão

Revisor independente confirmou isolamento, modos, conteúdo, wx/symlink e checksum; apontou que retries de conexão poderiam ultrapassar o beforeAll. Ajustado deadline monotônico global de 25 s, conexão de no máximo 15 s dentro desse orçamento e abertura SFTP limitada ao restante; comandos Docker também respeitam o orçamento. Timeout externo permanece 30 s. Reexecução final: 3 PASS em 5,28 s, container/rede removidos. Build backend confirmado PASS (exit 0).

### 2026-11-03T14:53:47-03:00 — Revisão independente de NA-0088

Revisado HEAD f59fe6890 da frente de ferramentas, sem editar seus arquivos. Escopo: private-artifacts, waits, endpoints, consumidores CI/manual, configure-trial, TLS e parsing de governança. Parecer PASS com limites: raiz privada por UID/workspace protege artefatos; validações de dono/symlink/travessia preservam destinos e CI acompanha novo prefixo; dois consumidores de waitFor têm predicados síncronos; HA exige seleção explícita e TLS válido fora de loopback. Reexecutados apenas 9 testes focados dos helpers, todos PASS; evidência dos 69 testes da frente foi lida, não reexecutada. Helper waitFor não é contrato para predicados assíncronos, sem uso async atual; artefatos permitem substituição por processos confiados do mesmo UID. Nenhum bloqueador confirmado.

### 2026-11-03T14:58:44-03:00 — Bearer linear após reanálise Sonar

Frente raiz informou que a ocorrência S8786 de SCIM continuou presente apesar do limite de entrada. Substituído o regex por parser linear, sem apenas aceitar a ocorrência por tamanho. Teste de 378 combinações preserva a gramática antiga; casos de 100 mil espaços e token malformado terminam sem retries. Verificado no serviço o mesmo hash de token consultado e rejeição de entrada inválida antes do banco. Suítes SCIM: 17 PASS em 2 arquivos. Limites 1024/256 preservados; nova reanálise pertence à frente raiz. Build backend confirmado PASS (exit 0).
