# NA-0091 — Registro da implementação

## Pedido e objetivo

Executar continuidade SonarQube local, backup/restore verificável, renovação restrita de tokens e agendamento seguro conforme autorização explícita do usuário.

## Implementação

Base SHA 4a77f7139600e70aa612e753418978d9b31b10ae, branch chore/NA-0091-20261103-sonar-recovery, worktree /tmp/nodeaccess-NA-0091. Concorrência justifica worktree; docs mantidos também no projeto canônico.

## Validação

Backup/restore real PASS no código a8e201bdb: 5 análises, 295 issues abertas, 0 hotspots e permissões idênticos. Clone testou geração, sobreposição e revogação dos dois tokens; origem permaneceu inalterada e os recursos próprios foram removidos. Rotação original com janela48h e instalação/execução manual do cron PASS. Evidências sanitizadas em `evidence/`. A suíte anterior tinha55testes PASS; foram acrescentadas15simulações de orquestração/instalação, cuja rodada completa está registrada no fechamento abaixo.

## Recuperação

Volumes originais não serão removidos/montados no ensaio. Artefatos privados fora do Git. Sem scanner, VPS ou kernel persistente.

## Pendências

Merge/publicação e primeira execução pelo relógio do cron não ocorreram. Revogação dos tokens antigos originais é futura; o ciclo completo foi provado no clone. Backup externo/criptografia de transporte e retenção dependem de política operacional, sem exclusão automática. Planilha/índices globais coordenados pelo root para evitar conflito.

## Diário de interações

### 2026-11-03T15:20:00-03:00 — Autorização e planejamento

Usuário autorizou as pendências fim a fim. Frente delegada com credenciais privadas existentes, sem imprimir valores. Lida skill lifecycle e documentação oficial; hotbackup permitido, restauração precisa índices novos. Criado worktree isolado; próximo passo: scripts/testes e ensaio coordenado.

### 2026-11-03T16:03:00-03:00 — Backup e testes negativos

Backup real criado fora do Git, com5análises/295issues/0hotspots e permissões globais/do projeto. Manifest e arquivos privados validados. Baseline33testes e15novos testes passaram no worktree: corrupção, links, modos, rotação com falha/overlap, lock, usuário estrangeiro e rotina adiada por CE ativo. Ensaio real encontrou publicação ausente na rede internal e hostname Docker longo; corrigidos para bridge exclusiva com bindloopback e alias DNS curto. Restore/rotação original/agendamento ainda em validação. Não houve scanner nem acesso à VPS.

### 2026-11-03T16:15:57-03:00 — Revisão de segurança e diagnóstico real

Revisão independente identificou risco de corrida entre lstat e leitura como root. Corrigido com O_NOFOLLOW, fstat do mesmo descriptor, diretórios/locks/gravações ancorados e checksum streaming; revisor confirmou a correção. Testes incluem 100 trocas concorrentes de symlink, troca do pai durante escrita e rejeição de arquivo de outro UID. Dump e restore agora usam descriptors, sem Buffer integral. PostgreSQL precisa readiness TCP para não aceitar o servidor Unix temporário do entrypoint; corrigido. Sonar iniciou no clone, mas uma API ainda falhou; diagnóstico preserva apenas endpoint/status, sem corpo. A janela Docker foi cedida à frente CI para evitar dois clones simultâneos. Scripts originais/credenciais/cron continuam inalterados. Próximo passo: concluir ensaio real e somente depois rotação/instalação autorizadas.

### 2026-11-03T16:34:24-03:00 — Continuidade operacional comprovada

Restore real PASS após três respostas503 transitórias de índice; deadline/retry específico permitiu comparação completa. Rotação/revogação real no clone PASS e cleanup sem resíduos. Revisor aprovou proteções de descriptors. Com janela sem scanner confirmada, rotacionados os tokens originais com48h de sobreposição, expiração03/12/2026, owner1000 e0600 preservados. Ambos antigos ainda válidos na verificação; novos negam administração e preservam escopos separados. Instalado cron root03:20 em release privado root-owned, módulos idênticos ao checkpoint. Execução imediata do release gerou backup e status PASS, retirando0tokens e mantendo2na janela.

Por decisão de revisão, cobertura normal deve ser reproduzível no CI sem importar V8 manual. Acrescentadas simulações com funções operacionais reais, mocks apenas nas interfaces Docker/HTTP e sistema operacional do instalador mapeado para diretório privado. Casos cobrem startup/readiness, erros, prazos, cleanup, cancelamento e publicação de release. Código operacional não mudou depois do ensaio real; somente testes/docs foram ampliados. Próximo passo: rodada completa, commit local e revisão independente/integrar rotina pelo agente root.

Rodada completa às16:34:24 -03:00:70testes PASS, zero falhas/skip, duração2,64s, incluindo15novas simulações reproduzíveis. Evidência em `evidence/tests.txt`.
