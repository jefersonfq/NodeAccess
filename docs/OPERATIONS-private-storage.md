# Armazenamento privado persistente

Auditoria e avatares usam por padrão `./data/session-audit` e `./data/user-avatars`, relativos ao diretório de trabalho do backend. Não usar diretório compartilhado ou temporário em produção. O serviço cria diretórios privados (0700), arquivos 0600 e rejeita destinos inseguros; falha de permissão deve ser corrigida, nunca contornada com chmod 777.

Em produção, configure `SESSION_AUDIT_STORAGE_DIR=/var/lib/nodeaccess/session-audit` e `USER_AVATAR_STORAGE_DIR=/var/lib/nodeaccess/user-avatars` em volumes persistentes. O compose de produção já estabelece esses caminhos. API/gateway precisam do mesmo volume de auditoria e UID. Réplicas da API precisam compartilhar avatares; HA requer volumes explicitamente provisionados. Caminho persistente no código não torna persistente a camada gravável de um container.

## Transição de instalações existentes

1. Antes de atualizar, registre os caminhos efetivamente usados, UID/GID e mounts. Se dependia do antigo default, configure explicitamente o caminho antigo para evitar desaparecimento de avatares; isso é uma transição temporária, não a solução persistente.
2. Faça backup do banco e dos arquivos, preserve proprietário/permissões e verifique restauração. Pare as gravações durante a cópia ou use snapshot consistente; não faça dupla escrita improvisada.
3. Para avatares, copie toda a árvore preservando hashes e isolamento por tenant; somente então altere a configuração de todas as réplicas e verifique leitura/autorização.
4. Auditorias antigas guardam `storageKey` no banco. Mudar o diretório de escrita não migra essas referências. Preserve os caminhos antigos acessíveis ou faça uma migração separada e reversível de arquivos e referências, com comparação de hashes e validação do playback. Não apagar `/tmp` antigo antes disso.
5. Reabra uma sessão, execute comando sintético, encerre e valide auditoria após reiniciar os serviços. Valide avatar existente e novo, isolamento por tenant, acesso negado e restauração.

Nenhuma migração de dados, mudança de UID ou implantação é executada automaticamente por esta correção. Em desenvolvimento, mantenha o mesmo diretório de trabalho entre inicializações. Dados de runtime não entram no Git.
