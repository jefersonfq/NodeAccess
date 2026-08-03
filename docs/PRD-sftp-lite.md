# PRD Lite - SFTP / Gerenciador de Arquivos

## Objetivo
- corrigir lacunas funcionais que bloqueiam uso diario (delete recursivo, audit, multi-selecao)
- melhorar a UX para usuarios tecnicos que trabalham intensamente com arquivos remotos
- manter o componente leve e sem reescrita desnecessaria

## Estado atual
Implementacao solida: browse, upload drag&drop, download, mkdir, rename, delete, editor web basico, bastion support, controle de acesso por escopo.

## Lacunas funcionais

### 1. Audit log de operacoes SFTP
- nenhuma operacao de arquivo e registrada no audit
- para um PAM, download/upload/delete de arquivos deve ser rastreavel
- comportamento desejado:
  - registrar no mesmo sistema de audit do SSH: usuario, tenant, host, operacao, caminho, timestamp
  - operacoes a registrar: download, upload, delete, rename, mkdir, createFile, readFile, writeFile
- implementacao:
  - reusar o modulo de session-audit existente
  - evento novo: `SFTP_OPERATION` com campos `action` e `path`
  - registrar no controller do sftp (nao no service, para nao acoplar)
- status atual:
  - primeiro corte implementado no controller SFTP usando `AdminLog`
  - registra sucesso e falha de `download`, `upload`, `delete`, `rename`, `mkdir`, `createFile`, `readFile` e `writeFile`
  - registra metadados operacionais (`hostId`, `path`, `newPath`, `size`, `success`, erro quando houver), sem conteudo de arquivo
  - quando a operacao veio do gerenciador/editor vinculado a uma aba SSH ativa, registra `sessionId` para correlacao com a sessao
  - tela dedicada `Admin > Relatorios > Auditoria SFTP` lista `SFTP_OPERATION` com filtros por operacao, resultado, host e busca por caminho/erro/usuario
  - evolucao futura: exibir os eventos SFTP tambem dentro do detalhe de `session-audit` quando houver `sessionId`

### 2. Delete recursivo de pasta nao-vazia
- hoje o delete falha silenciosamente em pastas nao-vazias
- comportamento desejado:
  - ao tentar deletar pasta, verificar se esta vazia
  - se nao estiver: mostrar dialogo de confirmacao com aviso explicito ("X itens serao deletados permanentemente")
  - opcao de deletar recursivamente via flag no endpoint
- backend: adicionar parametro `recursive: boolean` no endpoint DELETE
- frontend: dialogo de confirmacao diferenciado para pasta nao-vazia

### 3. Busca / filtro rapido
- sem filtro no painel direito
- comportamento desejado:
  - campo de busca inline no topo do painel direito (nao bloqueia navegacao)
  - filtra o conteudo do diretorio atual pelo nome (frontend only, sem nova requisicao)
  - limpa com Escape
  - atalho: `Ctrl+F` ou `/` (fora de input)
- implementacao: computed `filtered` sobre `sorted`, com `filterQuery` ref

### 4. Multi-selecao e operacoes em lote
- sem selecao multipla de arquivos
- comportamento desejado:
  - `Ctrl+Click` adiciona item a selecao
  - `Shift+Click` seleciona intervalo
  - checkbox na coluna de nome ao entrar em modo selecao
  - barra de acoes flutuante ao ter itens selecionados: deletar, baixar como zip
- implementacao:
  - `selectedEntries: Set<string>` no componente
  - endpoint `POST /sftp/:hostId/download-zip` com lista de caminhos (backend novo)
  - delete em lote: loop de chamadas sequenciais no frontend (nao precisa de endpoint novo)

### 5. Copiar caminho para clipboard
- ausente no menu de contexto
- comportamento desejado:
  - "Copiar caminho" no menu de contexto de qualquer item
  - "Copiar caminho atual" como botao discreto no breadcrumb
- implementacao: `navigator.clipboard.writeText(entry.path)`

### 6. chmod — editar permissoes
- nao e possivel alterar permissoes de arquivo
- comportamento desejado:
  - opção no menu de contexto: "Permissoes"
  - modal simples com checkboxes por classe (owner/group/other) + leitura/escrita/execucao
  - preview do modo octal (ex: 644, 755)
- implementacao:
  - backend: endpoint `PATCH /sftp/:hostId/chmod` com `{ path, mode: number }`
  - frontend: modal de permissoes com binding octal

### 7. Editor seguro com backup, diff e auditoria
- editar arquivos remotos pelo SFTP precisa de uma camada de seguranca equivalente a um "save governado"
- objetivo:
  - permitir edicao mais confortavel com CodeMirror 6
  - criar backup automatico antes de sobrescrever o arquivo
  - auditar quem alterou, em qual host, qual caminho, quando e por qual mecanismo
  - mostrar na auditoria o que mudou, sem expor segredo sensivel indevidamente
- comportamento desejado no editor web:
  - abrir arquivo texto em CodeMirror 6 com syntax highlight por extensao
  - suportar line numbers, busca, Ctrl+S, undo/redo, read-only, indicador de alteracao nao salva
  - antes de salvar:
    - ler metadados atuais do arquivo remoto (`mtime`, tamanho e, quando viavel, hash)
    - comparar com os metadados capturados na abertura
    - se o arquivo mudou no servidor desde a abertura, bloquear overwrite automatico e pedir decisao explicita
  - ao salvar:
    - criar backup do conteudo original antes da escrita
    - escrever em arquivo temporario no mesmo diretorio quando possivel
    - validar tamanho/hash do temporario
    - trocar/renomear de forma atomica quando o servidor SFTP permitir
    - preservar permissoes, owner/group e timestamps quando viavel
  - apos salvar:
    - registrar evento de auditoria com resumo e diff
    - exibir feedback claro: salvo, backup criado e auditoria registrada
- backup:
  - padrao sugerido: diretorio oculto por host/caminho, por exemplo `.nodeaccess-backups`
  - nome sugerido: `{arquivo}.{timestamp}.{userId}.bak`
  - alternativa para ambientes restritos: guardar backup cifrado no backend/object storage, vinculado ao host e caminho
  - backup deve respeitar politica de retencao por tenant
  - admins devem conseguir baixar/restaurar backup quando autorizados
- auditoria:
  - evento novo: `SFTP_FILE_CHANGED`
  - campos minimos:
    - `tenantId`, `hostId`, `userId`, `sessionId` quando houver
    - `path`, `backupPath` ou `backupArtifactId`
    - `editor`: `web-codemirror`, `sftp-upload`, `terminal-safe-edit`, `terminal-detected`
    - `beforeHash`, `afterHash`, `beforeSize`, `afterSize`, `mtimeBefore`, `mtimeAfter`
    - `changedLines`, `addedLines`, `removedLines`
    - `diffPreviewMasked`
  - diff deve ser mascarado usando as mesmas regras de secrets/sensitive patterns
  - para arquivos grandes, binarios ou extensoes sensiveis, registrar apenas metadados e informar `diffSkippedReason`
  - visualizacao do diff deve ficar em tela administrativa/auditoria com permissao restrita
- limites:
  - arquivos binarios nao devem abrir para edicao textual
  - arquivos acima de limite configuravel devem abrir em read-only ou exigir download
  - diff completo deve ter limite de linhas/caracteres
  - salvar arquivos com permissao elevada/sudo nao deve ser feito implicitamente
- endpoints provaveis:
  - `GET /sftp/:hostId/file?path=...` retorna conteudo + metadados
  - `PUT /sftp/:hostId/file` com `{ path, content, expectedMtime, expectedHash, createBackup: true }`
  - `GET /sftp/:hostId/file-diff/:auditId`
  - `POST /sftp/:hostId/restore-backup` com `{ auditId | backupArtifactId }`
- status atual:
  - primeiro corte implementado nos endpoints atuais `GET /sftp/:hostId/read` e `PUT /sftp/:hostId/write`
  - abertura retorna `size`, `modifiedAt`, `hash`, modo, owner/group e timestamps quando disponiveis
  - salvamento valida `expectedHash`, `expectedModifiedAt` e `expectedSize` para bloquear sobrescrita concorrente com `SFTP_CONFLICT`
  - antes de salvar, cria backup remoto em `.nodeaccess-backups/{arquivo}.{timestamp}.user-{userId}.bak`
  - grava o novo conteudo primeiro em arquivo temporario oculto no mesmo diretorio, valida tamanho/hash e so entao tenta `rename` para o caminho final
  - se a validacao do temporario ou o `rename` falhar, o arquivo original nao e sobrescrito pelo controller e o temporario e removido em best-effort
  - auditoria `SFTP_OPERATION/writeFile` registra `backupPath`, hashes/tamanhos antes/depois, contagem de linhas e `diffPreviewMasked`
  - quando aplicavel, auditoria tambem registra `tempPath` para diagnostico do fluxo de salvamento seguro
  - preserva `mode`, owner/group e timestamps no temporario antes do `rename` em best-effort
  - falhas de preservacao de metadados ficam registradas em `metadataPreservationErrors`
  - politica operacional SFTP por tenant implementada em `Admin > Configuracoes > Politica SFTP`
  - admins podem configurar se falhas ao preservar permissoes, owner/group ou timestamps devem bloquear o save antes do `rename`
  - limites do diff mascarado (`diffMaxBytes` e `diffMaxLines`) sao configuraveis por tenant e aplicados em `backup-diff`
  - persistencia implementada na tabela `licenses` via migration `20260719120000_add_sftp_policy_settings`; migration aplicada em ambiente local em 2026-07-19
  - restauracao de backup implementada em `POST /sftp/:hostId/restore-backup` com `{ path, backupPath }`
  - restauracao aceita apenas backups em `.nodeaccess-backups` do mesmo diretorio, cria backup pre-restauracao do arquivo atual, valida temporario e registra `restoreBackup` na auditoria
  - download dedicado de backup implementado em `GET /sftp/:hostId/download-backup?path=...&backupPath=...`
  - download de backup usa a mesma validacao de `.nodeaccess-backups` do mesmo diretorio e registra `downloadBackup` na auditoria
  - diff mascarado sob demanda implementado em `GET /sftp/:hostId/backup-diff?path=...&backupPath=...`
  - diff sob demanda usa a mesma validacao de backup, limita tamanho/linhas, bloqueia binarios e registra `viewBackupDiff` sem conteudo bruto
  - tela dedicada de Auditoria SFTP mostra acoes "Diff", "Baixar" e "Restaurar" para edicoes com `backupPath`
  - upload registra `uploadFileName` e tamanho, sem conteudo
  - pendente para fase seguinte: auditar alteracoes da politica SFTP e estabilizar harness CDP completo da tela de auditoria

### 8. Cobertura para editores de terminal (`vi`, `vim`, `nano`)
- alteracoes feitas dentro de `vi`, `vim`, `nano` rodam diretamente no host remoto dentro da sessao SSH
- o NodeAccess nao controla nativamente o momento do `:w` ou a escrita final do arquivo como controla no editor web
- portanto, a camada completa de backup + diff + save atomico so e garantida quando o arquivo e salvo pelo editor web/CodeMirror ou por um fluxo controlado pelo NodeAccess
- estrategias possiveis:
  1. `terminal-safe-edit`:
     - oferecer acao "Editar com seguranca" no terminal ou file manager
     - NodeAccess baixa snapshot, abre editor web ou wrapper controlado, cria backup e audita no save
     - e o fluxo recomendado para garantia forte
  2. deteccao assistida por sessao:
     - session audit detecta comandos como `vi /etc/nginx/nginx.conf`
     - NodeAccess registra intencao de edicao e caminho provavel
     - ao fim do comando/sessao, tenta coletar metadados/hash do arquivo
     - se mudou, registra `SFTP_FILE_CHANGED` com `editor: terminal-detected`
     - backup previo so e possivel se a deteccao ocorrer antes da escrita e houver permissao para ler o arquivo
  3. agente/watch opcional:
     - um Agent no host pode observar alteracoes em caminhos autorizados
     - permite detectar mudancas feitas por `vim`, scripts ou comandos fora do SFTP
     - maior cobertura, mas adiciona complexidade e deve ser opt-in por tenant/pasta
  4. shell hook/wrapper:
     - disponibilizar comando `na-edit /caminho/arquivo`
     - wrapper cria backup, chama `$EDITOR`, calcula diff e envia evento de auditoria
     - bom para ambientes controlados, mas nao cobre usuario chamando `vim` diretamente
- decisao de produto:
  - garantia forte: somente editor web/CodeMirror e `na-edit`
  - melhor esforco: deteccao de `vi/vim/nano` pela auditoria da sessao
  - cobertura ampla: Agent/watch opcional
- UX desejada:
  - quando detectar `vim arquivo` em sessao auditada, mostrar na auditoria: "Possivel edicao por terminal"
  - se houver diff coletado, exibir diff mascarado
  - se nao houver diff, exibir apenas comando, caminho provavel e metadados
  - se backup nao foi criado antes da alteracao, deixar isso explicito

---

## Melhorias de UX

### 1. Single-click para navegar em diretorio (high impact)
- hoje no painel direito exige double-click para entrar em pasta
- na arvore esquerda e single-click
- inconsistencia confunde usuarios tecnicos
- correcao: single-click no item de diretorio no painel direito ja navega
- double-click continua funcionando (backward compat)

### 2. Colunas sortaveis
- hoje a ordem e fixa: diretorios primeiro, depois nome alfabetico
- comportamento desejado:
  - click no header de coluna alterna asc/desc
  - colunas: nome, tamanho, modificado
  - permissoes nao precisa de sort
  - indicador visual de sort ativo (▲/▼)
- implementacao: `sortColumn` e `sortDir` refs, substituir computed `sorted`

### 3. Contagem de itens no status
- nenhum feedback de quantos itens estao no diretorio atual
- comportamento desejado:
  - exibir "X itens" discretamente no breadcrumb ou status bar
  - se houver filtro ativo: "X de Y itens"
- implementacao: `computed filteredCount` e `totalCount`

### 4. Selecao visual ao clicar em arquivo
- clicar em um arquivo nao da nenhum feedback visual
- comportamento desejado:
  - row fica destacada ao ser clicada (single-click)
  - a selecao nao navega (apenas arquivos — pastas navegam)
  - menu de contexto e acoes operam no item selecionado
- implementacao: `activeEntry` ref, classe CSS condicional na row

### 5. Atalhos de teclado adicionais
- atalhos atuais: Backspace (subir), Ctrl+R (refresh), Ctrl+U (upload)
- adicionar:
  - `F2` → renomear item selecionado
  - `Delete` → deletar item selecionado (com confirmacao)
  - `Enter` → abrir diretorio ou editor do item selecionado
  - `Ctrl+F` ou `/` → ativar filtro rapido

### 6. Botao de copiar caminho no breadcrumb
- quick win: icone discreto ao lado do caminho atual no breadcrumb
- copia o caminho completo para clipboard
- util para referenciar em scripts e terminal

### 7. Feedback de "nenhum resultado" no filtro
- ao filtrar e nao encontrar nada: mensagem descritiva
- ex: "Nenhum arquivo com 'nginx' neste diretorio"

### 8. Indicador de item em edicao
- ao abrir o editor Monaco para um arquivo, a row nao muda
- comportamento desejado: highlight sutil na row do arquivo sendo editado

### 9. Tooltip de tamanho em bytes exato
- coluna de tamanho mostra formato legivel (KB, MB)
- adicionar tooltip com valor exato em bytes ao passar o mouse
- util para verificar arquivos grandes

### 10. Menu de contexto mais completo para diretorios
- hoje para pasta: apenas rename e delete
- adicionar: copiar caminho, abrir no terminal (se sessao SSH ativa)

---

## Prioridade sugerida

### Agora (alto impacto, baixo risco)
1. Busca / filtro rapido (frontend only)
2. Single-click para navegar em diretorio
3. Colunas sortaveis
4. Copiar caminho no contexto e breadcrumb
5. Atalhos F2 e Delete
6. Contagem de itens

### Curto prazo (requer backend)
7. Delete recursivo com confirmacao diferenciada
8. Audit log de operacoes SFTP
9. Selecao visual e multi-selecao
10. chmod no menu de contexto

### Depois
11. Download de pasta como zip (multi-select)
12. Indicador de item em edicao
13. Abrir no terminal a partir do file manager
14. Editor CodeMirror 6 com save seguro, backup e diff auditavel
15. Wrapper `na-edit` ou deteccao assistida para editores de terminal

---

## Arquivos provaveis
- `apps/frontend/src/components/FileManager.vue` — maioria das melhorias de UX
- `apps/frontend/src/components/FileEditorModal.vue` — editor CodeMirror 6, diff e estados de save
- `apps/backend/src/modules/sftp/sftp.service.ts` — delete recursivo, chmod, zip
- `apps/backend/src/modules/sftp/sftp.controller.ts` — audit log, novos endpoints
- `apps/backend/src/modules/sftp/sftp.routes.ts` — novos endpoints
- `apps/backend/src/modules/session-audit/` — integracao do audit SFTP
- `apps/backend/src/modules/sftp/sftp-audit.service.ts` — backup, diff mascarado e eventos de alteracao

## Fora do escopo
- preview de imagem inline
- suporte a symlinks editaveis
- compressao/descompressao de arquivos no servidor
- modo grid (icones grandes)
- sincronizacao local/remoto (rsync-like)
- garantia forte de backup/diff para edicoes feitas diretamente por `vim` sem wrapper, hook ou Agent
