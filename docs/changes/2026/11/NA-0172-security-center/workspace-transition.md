# Transição da pasta principal — NA-0172

Executada em 06/11/2026 após escolha explícita do usuário: preparar atualização da pasta principal preservando seus arquivos locais.

## Resultado

`/home/jeferson/projects/NodeAccess-current` passou a apontar para o worktree da branch `feature/NA-0172-20261106-security-center`, base/HEAD `745253d1edb522db79aaa44fd96608ce434a2774`, com alterações locais da Central. O checkout antigo da NA-0081 foi movido integralmente para `/home/jeferson/projects/NodeAccess-current-backup-NA0081-20261106`, preservando branch, documentos, dependências e dados. Nenhum commit, push, merge ou migração foi executado por esta transição.

Foram usados dois `git worktree move`, que atualizam os apontadores administrativos sem reset/stash ou exclusão de alterações. Antes do movimento, o Vite de teste em 18174 foi encerrado por TERM após conferir PID, comando e cwd. As portas 3000, 3001 e 5173 estavam livres naquele checkpoint; esta informação não substitui a conferência antes de um novo restart.

## Preservação

- 834 documentos verificados na preparação/transição. A frente NA-0172 do candidato foi mantida como autoridade; suas cópias antigas não sobrescreveram os registros atuais.
- 244 arquivos documentais ausentes e dois logs documentais ignorados foram copiados. Seis documentos foram mesclados em três vias. AGENTS e índice de mudanças locais continham as instruções/entradas do destino e foram preservados. Manual foi mesclado por seções; README manteve o conteúdo local com distinção explícita das frentes ainda não integradas.
- 24 variantes históricas divergentes foram preservadas separadamente no acervo canônico `docs/changes/2026/11/NA-0172-security-center/workspace-preserved/README.md` (fora deste candidato exclusivo); decisões Sonar operativas da base foram mantidas.
- Configuração local e estado necessário de desenvolvimento copiados com verificação de hash/permissões: 7.807 arquivos. Não há valores de configuração nem dados de sessões neste documento. Backup antigo permaneceu intacto.
- Proprietário da nova árvore e seu gitdir vinculado ajustado ao dono original UID/GID 1000, sem seguir symlinks. Configuração 0600 e diretórios de estado 0700 preservados. Documentos operacionais 0644. Não reutilizar dependências antigas: as dependências do candidato acompanharam seu worktree.
- Fingerprint do código e catálogo antes/depois idêntico: `7141cec46d0aab03fedf5de7012a328d64afba5a229eb60f5614013ab6913d12`. `git diff --check` aprovado após a transição.

[Resumo verificável](evidence/workspace-transition.json). O manifesto privado completo está em `/tmp/NA0172-workspace-transition/manifest.json`; contém caminhos e hashes do estado local e não deve ser publicado. A cópia integral antiga é o checkpoint durável.

## Execução de desenvolvimento e limites

A pasta agora contém rota, menu, view, plugin, catálogo e tipos da Central. A movimentação em si não inicia `npm run dev` nem prova readiness. Os testes anteriores em `/tmp/nodeaccess-NA-0172` continuam registrados como executados naquele caminho; somente novas execuções podem ser declaradas canônicas.

A inspeção somente leitura encontrou 150 migrações aplicadas e uma pendência: `20261104230000_tacacs_tls_identity`, que torna `secret_cipher` opcional e adiciona fingerprint e índice de certificado à tabela `network_tacacs_devices`. A tabela estava vazia; nenhuma migração incompleta. A Central não usa essa tabela, mas a readiness global exige alinhamento. Não foi executada migração ou restauração de banco nesta transição. A atualização de schema requer backup verificável e decisão própria; o ALTER MySQL é DDL com commit implícito.

O runtime de validação da IA é Node 24.22.1 privado; ele não deve ser indicado como binário executável do usuário. Foi encontrada instalação do usuário Node 24.14.1, abaixo do requisito atual `>=24.21.0 <25`. Node 24.22.1 foi instalado para o usuário a partir da distribuição completa já disponível, com binário idêntico ao runtime validado. Não foram alterados default ou profile do shell.

## Retorno reversível dos worktrees

Não executar automaticamente. Primeiro parar somente os processos do projeto após verificar sua origem; preservar eventuais novas alterações e verificar que o destino temporário está livre. Os comandos abaixo movem ambas as árvores completas, sem descartá-las:

```bash
git -C /home/jeferson/projects/NodeAccess-current worktree move /home/jeferson/projects/NodeAccess-current /tmp/nodeaccess-NA-0172
git -C /home/jeferson/projects/NodeAccess-current-backup-NA0081-20261106 worktree move /home/jeferson/projects/NodeAccess-current-backup-NA0081-20261106 /home/jeferson/projects/NodeAccess-current
```

Esse retorno só desfaz a localização dos worktrees. Não reverte banco, Redis ou atividade de usuário ocorrida depois do checkpoint; se uma migração posterior for autorizada, seguir seu plano específico de recuperação. Não apagar o backup após a homologação sem autorização separada.

## Backup de banco preparado antes de qualquer DDL

Em 06/11/2026 foi executado mysqldump somente leitura do banco local pelo container MySQL existente, com single-transaction, routines, events e triggers. Arquivo privado: `backups/NA0172-workspace/before-tacacs-tls-identity-20261106.sql`, modo 0600, proprietário original UID 1000. Saída 0; 12.434.812 bytes, 103 CREATE TABLE, footer completo, tabela TACACS e histórico Prisma presentes. SHA-256: `33b78ff71086f0c95b7448b2dd5ceaec3a14a1ae5d08cf863487e894b351b060`.

A verificação executada foi estrutural e de hash; restauração não foi testada e nenhuma migração foi aplicada por esta etapa. O relatório privado está ao lado do dump. Não publicar dump ou logs privados.

## Runtime do usuário validado

Instalação em `/home/jeferson/.nvm/versions/node/v24.22.1`, proprietário UID/GID 1000. Distribuição completa com npm 11.19.1; arquivo tar local SHA-256 `6c172a9ab6718f7b801fb5a7bd486af2ee5e32758086a04b84fcce2aa77095e6`. Caminhos e destinos de links do pacote foram verificados antes da extração. Nenhum arquivo de autenticação do usuário foi copiado; o `.npmrc` interno padrão do pacote npm estava vazio.

Validação realmente executada como usuário jeferson: carregar seu nvm, `nvm use` na pasta atual, `node --version`, `npm --version` e `node apps/backend/scripts/dev.mjs api --check` — aprovados. Uma primeira tentativa herdou `NVM_DIR` do shell root e falhou ao selecionar a versão; a repetição removeu somente essas variáveis do processo de teste. Nenhum profile ou default foi modificado.

Para a sessão normal do usuário:

```bash
cd /home/jeferson/projects/NodeAccess-current
nvm use
npm run dev
```

Se nvm não estiver carregado na sessão, carregar `/home/jeferson/.nvm/nvm.sh` antes de `nvm use`. Não iniciar uma segunda instância se a existente ainda ocupar as portas; conferir primeiro os processos do projeto. A pré-checagem TCP não equivale à readiness completa nem aplica a migração pendente.

## Migração local autorizada e aplicada — 06/11/2026

Após preparar o backup, o usuário autorizou explicitamente “Aplicar a migração local e validar”. Imediatamente antes do deploy foram reconferidos endpoint MySQL local, hash do dump, 150 migrações aplicadas, ausência de migrações incompletas, pendência única `20261104230000_tacacs_tls_identity` e tabela TACACS vazia.

Executado `prisma migrate deploy` com configuração local carregada privadamente e log privado. Aplicada somente a migração pendente: ledger agora com 151 migrações, zero pendentes/incompletas; checksum igual ao arquivo SQL. Confirmados `secret_cipher` nullable, `certificate_fingerprint_sha256 CHAR(64)` nullable e índice único `network_device_certificate`. Tabela permaneceu vazia. Nenhum serviço foi iniciado por essa etapa e nenhum banco de produção foi acessado.

A primeira gravação do relatório encontrou valor BigInt na informação de índice; o deploy não foi repetido. As verificações foram refeitas exclusivamente por SELECT e o relatório reconstruído com conversão numérica. [Evidência final](evidence/local-migration-verification.json). O backup permanece intacto; restauração não foi necessária nem testada. Readiness HTTP e aplicação em execução devem ser verificadas após reiniciar os serviços, separadamente desta validação SQL.

## Isolamento em 12/11/2026

Este documento e seus JSONs associados descrevem a transição histórica de 06/11. O acervo
workspace-preserved permanece na pasta canônica, excluído do candidato exclusivo para não
incluir outras frentes. Suas referências históricas não indicam arquivos entregues pela Central.
