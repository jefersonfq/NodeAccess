# Utilitários de arquivos — implementação e validação

03/10/2026. Complementa a [avaliação de escopo](2026-10-03-terminal-file-utilities-scope.md). Implementação local, sem implantação. [Regras e limites](../PRD-terminal-file-utilities-lite.md); procedimentos no [manual SFTP](../manual/sftp.md).

## Comportamento entregue

- Arquivos → Utilitários ou menu ⋯ reaproveita caminho e sessão. Cópia de arquivo regular até 2 MiB usa canais SFTP separados na conexão SSH autenticada; home real da conta de destino, sem sobrescrita, cancelamento e confirmação. A lista contém sessões próprias no mesmo tenant/gateway, prioriza a mesma pasta cadastrada e permite pesquisa de outro host.
- Novo destino conecta em segundo plano pelo fluxo normal, sem tirar a origem de foco. Credenciais vinculadas continuam sendo resolvidas pelo fluxo existente; campos aparecem quando faltar informação. Credenciais temporárias passam a pertencer à aba, impedindo reutilização silenciosa em outro host.
- Arquivos grandes: comando `scp -s` preparado, com argumentos entre aspas, conta e porta do destino. Não executa nem injeta segredo. Transferência direta depende de conectividade, autenticação e cliente OpenSSH com modo SFTP na origem. Auditoria registra preparação e não conclusão.
- Agente pessoal Windows atualizado anuncia capacidade. Edição de texto UTF-8 até 2 MiB, incluindo configurações sem extensão, abre aplicativo escolhido localmente, observa salvamentos/rename e envia automaticamente. Hash, backup privado, verificação de temporário, preservação de atributos básicos e rename atômico protegem o remoto. Conflito/falha pausa envio; cópia local permanece para recuperação. Fechar painel mantém edição; encerrar/desconectar encerra acompanhamento.
- Auditoria SFTP inclui cópia, preparação de comando, abertura/encerramento e escrita externa. Distingue operação iniciada de sucesso/falha. Não persiste conteúdo nem credenciais; salvamentos têm revisão e backup. Operação exige evidência inicial de auditoria antes da escrita.

## Problemas encontrados e corrigidos na integração

| Problema | Impacto | Correção |
|---|---|---|
| Credencial temporária sem vínculo à aba | Outra conexão podia receber senha/usuário anteriores | Cache condicionado ao tabId |
| Aba invisível aguardava foco para conectar | Destino novo não aparecia, nem pedia credenciais | Solicitação explícita de conexão em segundo plano, preservando autorização normal |
| Orçamento de quadro do agente de 256 KiB | Edição maior que esse limite derrubava o agente | Limite adicional apenas para salvamento anunciado, até 2 MiB em base64 e orçamento de frequência |
| Cancelamento sobre canal compartilhado | Risco de afetar autocomplete ou terminal | Canal SFTP dedicado por operação, sobre o mesmo SSH |
| Agente antigo/ausente oferecia abertura | Espera e erro evitáveis | Descoberta por capacidade, orientação e Verificar agente |
| Encerramento não atualizava painel aberto | Estado sincronizado podia ficar desatualizado | Evento offline para observadores e proteção contra cleanup de transporte antigo |
| Registros iniciados apareciam como falha | Auditoria confundia início com resultado | Estado Iniciada separado |
| Restrição de extensão excluía hosts/sshd_config | Utilidade reduzida para administração Linux | Texto sem extensão aceito; executáveis/binary continuam bloqueados |

## Validações realizadas

- **52 testes backend/frontend**: escopo usuário/tenant, revalidação de ACL e versão, cancelamento, auditoria prévia, parâmetros, ponte de edição, ausência de repetição de mutações e encerramento/troca de transporte. [Relatório](evidence/2026-10-03-terminal-utilities/implementation/unit.json).
- **16 testes do agente em Node/Linux**: segurança, relay/reconexão reais em fixture e editor, incluindo arquivos sem extensão, debounce/rename, ACK serial, conflito e preservação de draft.
- **8 testes com OpenSSH descartável**: publicação privada sem overwrite, backup/atributos, revisão stale, tamanho, symlink, canal independente e shell vivo; protocolo completo do utilitário/ponte/agente com arquivo local observado, salvamento acima de 256 KiB, conflito remoto e cópia local preservada. Observador/editor simulado em Linux; arquivos remotos reais. [Relatório](evidence/2026-10-03-terminal-utilities/implementation/real-sftp-editor.json).
- **Windows nativo: 7 testes** (1 lançamento real por preferência salva com BOM e ACL; 6 cenários do editor), mais teste da interface existente do agente. Aplicativo descartável modifica o arquivo de verdade. Seletor nativo de executável foi inspecionado na interface, não automatizado. Não certifica Notepad++, VS Code ou todos os editores. [Captura](evidence/2026-10-03-terminal-utilities/agent-editor-windows.png).
- **Playwright + Chromium**: fluxo de cópia/home, conta visível, recuperação de tamanho, comando sem execução, conexão em segundo plano, duas credenciais distintas sem reutilização, edição, fechar/reabrir, conflito, mobile e agente indisponível. API/WebSocket simulados, Vue/xterm reais. [Relatório](evidence/2026-10-03-terminal-utilities/implementation/utilities-ui.json).
- **Regressão terminal e CDP**, SFTP/auditoria via CDP e sete simulações de falha/configuração aprovadas. [Terminal](evidence/2026-10-03-terminal-utilities/implementation/terminal-regression.json), [falhas SFTP](evidence/2026-10-03-terminal-utilities/implementation/sftp-fault-regression.json), [SFTP/auditoria CDP](evidence/2026-10-03-terminal-utilities/implementation/sftp-audit-cdp.json).
- **PTY real** contra laboratório descartável: top/htop, geometria estável, sem findings; primeira saída observada em 5/6 ms nessa execução local, sem promessa de desempenho em produção. [Top](evidence/2026-10-03-terminal-utilities/implementation/pty-top.json), [htop](evidence/2026-10-03-terminal-utilities/implementation/pty-htop.json).
- Typechecks backend/frontend; lint dos cinco arquivos centrais (zero erros/avisos); build Windows e execução nativa `--version`; manual com 18 testes e 2 verificações do compilador, cinco capturas inspecionadas, 60 estados de compartilhamento, dois ciclos de tenant e gate editorial.

## Arquivos principais

`FileUtilitiesModal.vue`, `FileManager.vue`, `TerminalView.vue`, `TerminalPane.vue`, store terminals e serviço terminal-sftp-channel; `session-files.ts`, `session-file-utilities.ts`, SSH gateway/session/repository; `desktop-edit.bridge.ts`, registro/capacidade do agente e `desktop-edit.js`/AgentSetup.ps1. Sem dependências novas ou cadastro paralelo de credenciais.

## Limites e operação

Recursos novos não fazem polling, lançam aplicativos ou criam observadores enquanto fechados. Buffers e concorrência são limitados; não houve teste de carga com 300 usuários. O warm-up SFTP anterior do terminal continua existindo. A cópia pequena passa pelo gateway; o comando grande não transfere dados pelo NodeAccess.

A lista de destinos desta entrega está restrita ao mesmo gateway. Capacidade local requer agente Windows atualizado. Servidores precisam das extensões OpenSSH para publicação/rename. O editor preserva modo, UID/GID e horários, mas não certifica ACLs estendidas, xattrs ou hardlinks. Hash + rename não é lock entre escritores; continua necessária coordenação para edição concorrente.

Backups são criados a cada salvamento automático confirmado; drafts e backups não têm retenção automática. Arquivos grandes com autosave frequente podem consumir disco. Após queda de rede, temporários privados remotos podem permanecer se a limpeza não for possível: conferir o destino e limpar somente os artefatos reconhecidos. Falha depois de publicação/rename ou na confirmação de auditoria pode exigir conferir o remoto antes de repetir. Uma escrita já em andamento pode concluir após encerrar.

Os cenários não certificam o percurso único navegador → gateway de produção → banco de auditoria → agente Windows → editor de terceiros em uma instalação real. São verificações por camadas, incluindo integração real entre protocolo de edição e SSH. O banco e as rotas de produção não foram substituídos por fixtures na aplicação; apenas os ensaios opt-in usam fixtures.
