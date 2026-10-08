## Quando usar
O painel de arquivos permite navegar e transferir arquivos de um destino compatível com SSH/SFTP. A disponibilidade depende do protocolo, da conta remota e da política do ambiente.

## Antes de começar
Confira a sessão e o diretório atual. As permissões de leitura, escrita e remoção são as do acesso remoto autorizado. Para arquivos importantes, mantenha uma forma de recuperação aprovada pela sua equipe.

## Passo a passo
1. Na sessão desejada, abra o painel de arquivos e aguarde o estado conectado.
2. Navegue pelas pastas e confira o caminho. Em painéis estreitos e telas menores, use **Pastas** para abrir ou recolher a árvore. Atualize a listagem quando precisar refletir mudanças realizadas por outros operadores.
3. Use o botão de ações **⋯** ao lado do nome para editar, baixar, renomear ou excluir. O menu de botão direito continua disponível. Por teclado, use Tab para alcançar a linha ou o botão de ações; Enter abre uma pasta ou o menu de ações. Use **Nova pasta** ou **Novo arquivo** para criar um item no diretório atual.
4. Ao editar, revise o conteúdo antes de salvar e acompanhe a confirmação. Respeite os avisos de conflito, preservação de atributos ou limitações do editor.
5. Para enviar arquivos, escolha o destino e acompanhe a área de transferências até o estado final. Uma transferência iniciada ainda não significa conclusão.
6. Confirme ações de remoção somente após verificar nome e caminho.

## Exemplo de uso
Antes de ajustar uma configuração, consulte o conteúdo e prepare sua recuperação. Faça uma alteração pequena, salve, confira o resultado informado e valide o serviço remoto pelo procedimento da equipe.

## Se algo não funcionar
**Permissão negada:** verifique o usuário remoto e os direitos da pasta. Uma permissão administrativa no NodeAccess não equivale automaticamente a acesso de escrita no sistema remoto.

**Arquivo alterado por outra pessoa:** examine o aviso de conflito e compare as versões quando a interface oferecer essa opção. Evite sobrescrever mudanças que ainda não revisou.

**Erro ao listar uma pasta:** a lista anterior é removida para evitar confundir os caminhos. Confira o erro, tente novamente ou navegue para outra pasta; criação e upload ficam indisponíveis enquanto a pasta não puder ser listada.

**Falha ao preservar atributos:** siga o aviso apresentado. Dependendo da política, a operação pode ser bloqueada para evitar alterar permissões, proprietário ou horários indevidamente.

**Falha na conexão ou na transferência:** confira o estado e use tentar novamente quando disponível. Antes de reenviar, verifique se existe um arquivo parcial ou uma operação já concluída no destino.

**Visualização indisponível:** nem todo formato ou tamanho é adequado para edição no navegador. Use a alternativa autorizada indicada pela sua equipe.

**Arquivo truncado:** arquivos maiores que 1 MiB ficam somente para leitura no editor. Baixe o arquivo completo para editar pela ferramenta aprovada da equipe.

**Recuperação por backup:** na auditoria SFTP, um administrador com acesso ao host pode consultar as ações disponíveis para o backup, comparar ou restaurar após confirmação. Backups novos são criados com permissão restritiva; a restauração preserva os atributos do arquivo atual conforme a política do tenant. Arquivos que contenham segredos em blocos podem ter o diff textual omitido. Essas proteções não alteram automaticamente backups antigos.

## Resultado esperado
A operação apresenta confirmação ou erro compreensível. Abrir o editor e consultar arquivos não deve exigir recarregar toda a aplicação nem encerrar a sessão de terminal.


## Copiar para outro host
1. Na sessão SSH conectada, escolha **⋯ → Copiar para outro host**. Pela barra **Utilitários**, informe o caminho completo do arquivo.
2. Selecione sua sessão de destino e confira a conta `usuário@host`. Sessões da mesma pasta cadastrada aparecem primeiro. Para outro destino, expanda **Conectar outro host**, pesquise e conecte pelo fluxo normal; informe credenciais somente se solicitado.
3. Deixe a pasta vazia para usar o home da conta conectada ou informe uma pasta absoluta existente.
4. Use **Copiar arquivo** para um arquivo regular de até 2 MiB. A cópia não sobrescreve arquivo existente e apresenta confirmação com caminho e conta. **Cancelar cópia** interrompe o envio; confira o destino antes de repetir se houve perda de conexão.
5. Para arquivos maiores, selecione **Comando direto**, prepare e copie o comando. Revise antes de executar na origem: ela precisa alcançar e autenticar no destino e ter cliente OpenSSH 8.7+ com suporte SFTP (`scp -s`). O comando pode sobrescrever arquivo e o NodeAccess não confirma sua conclusão.

## Editar no aplicativo local
1. Tenha o agente pessoal atualizado e conectado no Windows. Em **NodeAccess Agent → Editor de arquivos…**, escolha o aplicativo desejado; o padrão é Notepad. Agente de serviço não oferece essa função. Se a abertura estiver indisponível, conecte/atualize o agente e use **Verificar agente**.
2. No arquivo, use **⋯ → Editar no aplicativo local → Abrir editor local**. Aceita texto UTF-8 de até 2 MiB, com nome compatível com Windows, sem extensão ou com extensão textual conhecida (inclui `hosts`, `sshd_config` e `.bashrc`). Este limite é diferente do editor no navegador, de 1 MiB.
3. Salve normalmente no aplicativo e acompanhe **Enviando** e **Sincronizado com o servidor**. Cada salvamento verifica alterações remotas, cria backup e preserva os atributos básicos; falta de suporte ou permissão bloqueia a troca.
4. Fechar o painel permite continuar editando. Reabra a ação do mesmo arquivo para consultar o estado. Use **Encerrar edição** quando terminar.

**Conflito na edição local:** os envios pausam. Preserve sua cópia, compare com o arquivo remoto e encerre/reabra uma revisão atual. Não existe sobrescrita forçada automática.

**Queda ou falha no envio:** mantenha a cópia local em `%LOCALAPPDATA%\NodeAccess\Edits`. Falhas recuperáveis oferecem **Tentar envio novamente**; desconexão encerra o acompanhamento e exige reabrir. Uma escrita em andamento pode ter concluído; confira o remoto. As cópias permanecem após encerrar e devem ser removidas manualmente quando não forem mais necessárias.

**Destino ausente na lista:** conecte-o com sua conta e aguarde confirmação. Em instalações com vários gateways, a lista desta entrega contém apenas sessões no mesmo gateway. Para outro gateway, use o comando direto ou o fluxo de transferência aprovado pela equipe.

**Arquivos com atributos especiais:** o editor local preserva modo, dono/grupo e horários, mas não garante ACLs estendidas, xattrs ou hardlinks. Não use esse fluxo para arquivos que dependam desses atributos. Evite edição concorrente com serviços ou outros operadores.


**Falha ao conectar o destino:** feche o painel do utilitário, abra a aba criada e use o diagnóstico/reconexão normal. A origem continua aberta.

**Temporários após queda:** uma interrupção pode impedir remover temporários privados no servidor. Confira a operação e remova somente artefatos reconhecidos do utilitário. Os backups do editor local não são apagados automaticamente: o envio pausa ao atingir 20 backups desse arquivo ou 64 MiB de backups reconhecidos na pasta. Preserve os arquivos necessários e revise `.nodeaccess-backups` antes de usar **Tentar envio novamente**. Uma pasta com mais de 1.024 entradas também bloqueia o envio para limitar o custo da conferência. A verificação não é uma quota atômica contra edições concorrentes. Os drafts locais permanecem para recuperação e devem ser removidos manualmente quando não forem mais necessários.

**Transferência sem progresso:** uploads e downloads HTTP usam um prazo de cinco minutos sem progresso, em vez de um limite fixo de duração. Uma transferência ativa pode durar mais. Em uma interrupção, confira o destino antes de repetir; o resultado remoto pode ser desconhecido.
