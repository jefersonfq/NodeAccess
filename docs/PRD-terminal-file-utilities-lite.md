# Utilitários de arquivos no terminal

Entrega local de 03/10/2026. Complementa SFTP, sessões e agente existentes; não cria um cadastro de credenciais paralelo. Evidências em [validação](reviews/2026-10-03-terminal-file-utilities-implementation.md).

## Entrada e contexto
No painel Arquivos da sessão SSH, use **Utilitários** ou o menu **⋯** de um arquivo. O menu reaproveita o caminho selecionado; pela barra o usuário completa o nome do arquivo. Caminhos absolutos, conta SSH efetiva e sessão de destino são explícitos. Hosts de equipamento de rede, sessões JIT e participantes de compartilhamento não oferecem esses utilitários.

O destino é uma sessão SSH própria, no mesmo tenant e gateway. A lista prioriza a mesma pasta cadastrada e permite pesquisa; não infere subnet pela semelhança entre IPs. **Conectar outro host** pesquisa até 20 resultados por consulta no inventário acessível e cria uma aba pelo fluxo normal de conexão. Credenciais vinculadas são reutilizadas; a solicitação interativa aparece quando faltar informação. Credenciais digitadas em uma aba não são aplicadas silenciosamente a outra. Os limites normais de sessões continuam válidos.

## Cópia pequena
Até 2 MiB por arquivo regular. Usa canais SFTP dedicados sobre os transportes SSH já autenticados da origem e destino. Não cria outro login SSH nem recebe credenciais no pedido de cópia. O destino padrão é o home real da conta conectada; pasta alternativa deve ser absoluta e existir. Não há fallback para `/tmp` ou `/` quando o home não puder ser resolvido.

O gateway mantém buffers limitados e aceita uma operação por sessão, no máximo quatro simultâneas por processo. A publicação usa temporário privado e `hardlink@openssh.com` para impedir sobrescrita e exposição de arquivo parcialmente enviado. Modo inicial `0600`; exige suporte do servidor. Cancelamento interrompe apenas os canais do utilitário, preservando o terminal. Depois de falha/cancelamento próximo da publicação, o usuário deve conferir o destino antes de repetir.

## Arquivos grandes
Prepara um comando `scp` com caminho, usuário, host e porta do destino; oferece cópia para a área de transferência. O comando usa `scp -s`, exigindo cliente OpenSSH 8.7+ com suporte SFTP na origem, para evitar interpretação do caminho pelo shell remoto do SCP legado. A opção foi [introduzida no OpenSSH 8.7](https://www.openssh.org/txt/release-8.7) e [continua aceita no cliente atual](https://github.com/openssh/openssh-portable/blob/master/scp.c). O comando não é executado automaticamente. Os dados seguem diretamente entre servidores. A origem precisa alcançar e autenticar no destino: a credencial do navegador/gateway não é transportada para o shell. O comando pode sobrescrever arquivos. A auditoria registra **preparação**, não certifica conclusão da transferência direta.

## Editor local
Requer agente pessoal `USER_BOUND` online, no mesmo tenant, atualizado e anunciando capacidade de edição no Windows. Agentes de serviço e conectores não abrem aplicativos. Sem capacidade, o botão de abertura fica indisponível com orientação e **Verificar agente** para nova consulta explícita; não há sondagem ou download de arquivo em segundo plano.

Arquivo regular de até 2 MiB, texto UTF-8, sem NUL, nome compatível com Windows e nome sem extensão ou extensão textual conhecida. O agente cria diretório privado em `%LOCALAPPDATA%\NodeAccess\Edits`, aplica ACL à identidade Windows e abre o aplicativo escolhido localmente em **NodeAccess Agent → Editor de arquivos…**; padrão Notepad. O servidor não escolhe executável nem argumentos. Linux continua usando o editor do terminal ou do ambiente local.

Observação do diretório tolera salvamento por rename. Debounce de 700 ms, conteúdo alterado, um envio aguardando confirmação por arquivo, até quatro edições por sessão/agente e quatro salvamentos simultâneos no gateway. A conexão do agente limita quadros de salvamento a conteúdo de 2 MiB em base64; quadros normais continuam com orçamento de 256 KiB. Recursos e observadores só são criados após abertura explícita.

O salvamento verifica hash da revisão, gera backup `0600`, verifica temporário e preserva modo, UID/GID e horários. A substituição exige rename atômico do OpenSSH e preservação dos atributos; falhas bloqueiam a troca. Hash e metadados não equivalem a lock transacional entre todos os escritores remotos: ainda existe uma janela entre última verificação e rename. Arquivos em uso por outros processos exigem coordenação operacional. ACLs estendidas, xattrs e hardlinks do original não são preservados/certificados; não usar para arquivos que dependam deles.

Conflito e falha pausam novos envios. **Tentar envio novamente** trata falha recuperável; conflito exige comparar e reabrir uma revisão atual, sem sobrescrita forçada. Fechar o painel mantém a edição; encerrar edição/desconectar interrompe observadores e envios futuros. Uma escrita já em andamento pode concluir. A cópia local permanece para recuperação e precisa de limpeza manual; não há retenção automática ou retomada silenciosa após reconexão.

## Auditoria e permissões
Revalida JWT, usuário/tenant ativos, versão de sessão, host existente e ACL de conexão antes da operação e antes de escrever. Mantém permissões do usuário SSH, sem sudo. Sessões de origem/destino pertencem ao mesmo usuário/tenant. Registra operação iniciada e resultado, origem, destino, usuário efetivo e tamanho; edição registra hashes e caminho do backup, sem conteúdo ou credenciais. Auditoria administrativa SFTP exibe as novas ações e diferencia início de sucesso/falha. Backups de edição entram na ação existente de escrita e recuperação.

## Limites da validação
Playwright/Chromium CDP exercitam Vue/xterm reais com API/WebSocket simulados. OpenSSH descartável valida leitura, publicação, backups, metadados, conflitos e o protocolo completo de edição com observador local. Windows nativo valida ACL, execução de editor de teste, salvamento e interface de configuração. PTY real valida top/htop e continuidade do terminal. Isso não certifica todos os editores de terceiros, servidores SFTP, topologias de HA ou instalações de produção. Em HA, destinos de outro gateway não aparecem nesta primeira entrega.
