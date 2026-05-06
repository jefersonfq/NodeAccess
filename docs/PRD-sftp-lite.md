# PRD Lite - SFTP / Gerenciador de Arquivos

## Objetivo
- corrigir lacunas funcionais que bloqueiam uso diario (delete recursivo, audit, multi-selecao)
- melhorar a UX para usuarios tecnicos que trabalham intensamente com arquivos remotos
- manter o componente leve e sem reescrita desnecessaria

## Estado atual
Implementacao solida: browse, upload drag&drop, download, mkdir, rename, delete, editor Monaco, bastion support, controle de acesso por escopo.

## Lacunas funcionais

### 1. Audit log de operacoes SFTP
- nenhuma operacao de arquivo e registrada no audit
- para um PAM, download/upload/delete de arquivos deve ser rastreavel
- comportamento desejado:
  - registrar no mesmo sistema de audit do SSH: usuario, tenant, host, operacao, caminho, timestamp
  - operacoes a registrar: download, upload, delete, rename, mkdir, createFile, writeFile
- implementacao:
  - reusar o modulo de session-audit existente
  - evento novo: `SFTP_OPERATION` com campos `action` e `path`
  - registrar no controller do sftp (nao no service, para nao acoplar)

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

---

## Arquivos provaveis
- `apps/frontend/src/components/FileManager.vue` — maioria das melhorias de UX
- `apps/backend/src/modules/sftp/sftp.service.ts` — delete recursivo, chmod, zip
- `apps/backend/src/modules/sftp/sftp.controller.ts` — audit log, novos endpoints
- `apps/backend/src/modules/sftp/sftp.routes.ts` — novos endpoints
- `apps/backend/src/modules/session-audit/` — integracao do audit SFTP

## Fora do escopo
- preview de imagem inline
- suporte a symlinks editaveis
- compressao/descompressao de arquivos no servidor
- modo grid (icones grandes)
- sincronizacao local/remoto (rsync-like)
