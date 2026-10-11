# Recuperação seletiva NA-0038

Branch: `fix/NA-0038-20261005-engineering-hardening`. Estado local: alterações ainda não commitadas. A base já continha trabalho da NA-0037; nenhum reset/stash global foi executado. Trocar de branch não desfaz alterações locais.

O pacote `docs/reviews/evidence/2026-10-05-engineering-hardening/pre-change-files.tar.gz` contém os arquivos como estavam antes desta rodada, inclusive alterações preexistentes. O manifesto registra hashes do snapshot e da versão validada. Arquivos novos desta rodada estão explicitamente relacionados; documentação e evidências históricas permanecem disponíveis. `change-delta.patch` permite revisar somente o delta textual desta rodada (com finais de linha normalizados); a recuperação exata usa o snapshot e hashes.

1. Preserve o workspace e pare processos que possam escrever os arquivos. Se a versão chegou a ser implantada, retire o serviço da readiness e drene todos os consumidores antes da recuperação.
2. Execute `python3 tools/recovery/engineering-hardening-rollback.py`. O padrão é apenas verificar. Branch diferente, symlink, snapshot alterado ou qualquer arquivo editado após a validação interrompem a operação antes de escrever.
3. Confira a lista do manifesto. Após decidir pela recuperação, execute o mesmo comando com `--apply`. Somente os arquivos listados são restaurados/removidos. Não usar `git reset --hard`, `git clean` nem extração irrestrita do tar sobre o repositório.
4. Regere Prisma (`npm run db:generate -w apps/backend`) e recompile antes de iniciar serviços. Revalide a aplicação restaurada.

O procedimento não altera banco de dados. A migration é aditiva e as colunas podem permanecer em um rollback da aplicação. Examine entregas PROCESSING, leases e efeitos remotos com resultado desconhecido antes de iniciar consumidores antigos; eles não recuperam esses estados automaticamente. Reenfileirar sem conferir o receptor pode duplicar uma operação. Não apagar histórico nem descartar backups/rascunhos para voltar de versão.

O dry run é validado localmente; a restauração não foi aplicada ao workspace final. A aplicação da versão em produção e seu backup/restore não foram executados nesta tarefa.
