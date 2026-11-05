# Seleção de executáveis das ferramentas

As ferramentas migradas na NA0149 resolvem um caminho absoluto antes de iniciar o processo, conservando argv e sem ativar shell. Não há fallback para diretório atual, entrada relativa ou vazia de PATH. Configuração inválida falha com código `EXECUTABLE_*`, sem imprimir ambiente ou credenciais.

Em POSIX, candidatos e todos os intermediários de symlink precisam pertencer ao UID executor ou root, sem escrita por grupo/outros. Diretório sticky de root (por exemplo `/tmp`) só permite prosseguir por entrada pertencente ao executor e protegida. Instalações por gerenciadores de versão são aceitas quando toda a cadeia respeita esse contrato. Diretório atual de projeto e descendentes não são fonte de executáveis; no cwd `/` de serviços, a restrição refere-se somente a arquivos diretamente nessa raiz. O caminho final verificado é o retornado, sem nova resolução da referência original.

O operador pode indicar `NODEACCESS_EXECUTABLE_<NOME>` com caminho absoluto; hífen vira sublinhado, por exemplo `NODEACCESS_EXECUTABLE_SSH_KEYGEN`. O override passa pelas mesmas verificações. Isso permite escolher a instalação correta sem fixar `/usr/bin` universalmente. Não use configuração recebida de usuário remoto para essas variáveis.

No Windows, configure `NODEACCESS_EXECUTABLE_TRUSTED_ROOTS` com diretórios absolutos separados por `;`, específicos da instalação administrada (por exemplo as pastas de Git, Docker e ferramentas do runner). Raiz inteira de unidade e caminhos UNC/dispositivos não são aceitos. O candidato e seu destino real precisam ficar dentro da mesma raiz, com comparação de caminhos, não prefixo textual. PATHEXT aceita somente `.EXE` e `.COM`; `.CMD`/`.BAT` não são executados por shell como fallback. Configurações que só ofereçam wrappers shell precisam de um executável nativo explícito.

**Essa declaração de raízes não verifica ACLs NTFS.** O administrador continua responsável por proteger as instalações. Os testes nativos Windows/macOS/Linux estão no workflow agent-native-smoke; um passe Linux não comprova suporte Windows. Os limites de mesma identidade, administrador e troca concorrente de arquivos entre verificação/execução permanecem; o resolvedor não é sandbox nem autenticação criptográfica do binário.

O worker TLS é validado em Linux/Docker, com camada de ferramentas protegida e filesystem read-only no compose. Seu helper é copiado explicitamente para a imagem. Não alterar modos de instalações compartilhadas para fazer a validação passar: corrigir a instalação/configuração com o responsável pelo ambiente.
