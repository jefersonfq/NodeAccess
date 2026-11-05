# NA-0115 — Registro da implementação

## Pedido e objetivo

Resolver onze achados novos de tooling da análise integrada, com disposições individuais e contratos.

## Implementação

Base SHA 47f06b51e693d91f5ed724b7b86e5362af75bc35. Worktree /tmp/nodeaccess-NA-0115, branch fix/NA-0115-20261103-sonar-tooling-followup.

## Validação

166/166 testes Node de tools/coverage e tools/sonarqube passaram, sem skips. ESLint dos dez arquivos JS alterados: exit 0. Entrada npm sonar:ci invocada sem SONAR_CI_BASE chegou ao preflight CI_VALID_BASE_SHA_REQUIRED (exit 1 esperado), antes de Docker/scanner.

## Recuperação

Sem scanner, VPS ou alteração NA0093. Testes usam diretórios temporários privados.

## Pendências

Nova análise e integração root; checkpoint local COMMITTED, sem publicação. Catálogo global/planilha coordenados pelo root.

## Diário de interações

### 2026-11-03T17:25:02-03:00 — Nova análise e autorização

Sonar reportou onze ocorrências novas em sete arquivos; lidas individualmente com regra/chave/linha. Cobertura80,2 e duplicação0,09594 foram informadas pelo root, não reexecutadas por esta frente. Não classificar desaparecimento antes da reanálise.

### 2026-11-03T17:28:56-03:00 — Correções individuais e contratos

Aplicadas as 11 correções descritas em dispositions.json/findings.md: cinco chamadas Git usam /usr/bin/git; quatro ordenações usam localeCompare en; totais LCOV usam Map com validação estrita; writePrivate resolve fileOwner somente quando owner é undefined. Teste PATH adulterado atravessa inventário, diff, proveniência da coleta e preflight da validação sem executar scanner, provando que o falso executável não foi chamado. Novos contratos diferenciam zero LCOV válido de totais ausentes/duplicados/divergentes e preservam rejeição de owner null com arquivo intacto.

Root ampliou o escopo somente para entrada npm sonar:ci e documentação, pois instalações Node/npm separadas exigem npm_execpath fornecido pelo npm. Não alterado runner CI nem dependências/lockfile. A documentação genérica não inclui caminhos privados de npm/runtime.

Riscos: Linux/WSL/Ubuntu CI com Git de sistema é o contrato suportado; configuração Git e SO continuam confiáveis. Ordem explícita pode alterar fingerprint, portanto nova coleta é obrigatória. O release operacional instalado em /usr/local não foi alterado; esta mudança do owner é semântica equivalente no código do repositório. Desaparecimento dos achados aguarda Sonar, não foi presumido.

### 2026-11-03T17:29:44-03:00 — Revisão independente aprovada

Agente backend reproduziu 54 testes focais e aprovou PASS_WITH_WARNINGS. Confirmou Git absoluto resistente a PATH adulterado, Map LCOV sem outros consumidores do antigo objeto, owner undefined/null e política de filesystem preservados. Ordem locale en exige nova coleta/fingerprint; limites Linux e Git confiável permanecem explícitos. Sem scanner/Docker nesta revisão. Evidência independent.txt.

### 2026-11-03T17:33:03-03:00 — Release local atualizado com rollback preservado

Após PASS independente, root autorizou atualizar a instalação local de manutenção e executá-la uma vez. Installer criou novo release root-owned, preservou integralmente o anterior e salvou cron anterior em arquivo privado. Hashes do novo release correspondem às fontes do checkpoint cec9fe02d; hashes do antigo conferem com o código base e binário Node original. Cron root:root0644, arquivos JS root:root0600 e binário0700. Credenciais/status continuam1000:1000 0600.

Manutenção real PASS: backup criado, renewalDue=false, retirement revoked=0/remaining=2/currentScopesVerified=true. Tokens atuais são idênticos aos preservados no backup pré-manutenção, mantendo a sobreposição48h. Não houve rotação forçada, revogação antecipada, alteração de kernel ou VPS. Evidência sanitizada maintenance-refresh.json contém hashes, horários, status e caminhos de rollback, sem credenciais.

A primeira gravação dessa evidência falhou porque writePrivate corretamente rejeitou o diretório documental0755. A manutenção já havia concluído. A evidência foi reconstruída a partir do status, backup pré-manutenção, snapshot cron e hashes dos releases, sem repetir a operação. O diretório documental voltou a0755 e o JSON sanitizado ficou0644.

Rollback operacional: restaurar o conteúdo do arquivo rollbackCron indicado em maintenance-refresh.json em /etc/cron.d/nodeaccess-sonarqube-maintenance, preservando root:root0644; o release antigo permanece íntegro. Não apagar releases/backups ou revogar tokens como parte desse rollback.

Reexecução no checkpoint de código:166/166 testes PASS,0skips em2,90s. Alterações posteriores a esse resultado são somente documentação/evidência. O agendamento futuro ainda depende de WSL ativo; esta execução manual não comprova o próximo disparo do cron.
