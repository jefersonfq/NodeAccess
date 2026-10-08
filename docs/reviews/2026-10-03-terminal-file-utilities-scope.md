# Utilitários de arquivos no terminal — escopo e validação

## Decisões de produto

- Priorizar arquivos pequenos; arquivos grandes usam comando assistido com tráfego direto entre servidores.
- Destino inicial: home da conta SSH efetivamente usada no destino, resolvido remotamente. Não inferir `/home/<login>`.
- Reaproveitar identidade pessoal e dados existentes. Pedir somente campos ausentes; não substituir identidade pessoal por credencial compartilhada silenciosamente.
- Edição externa: piloto Windows com agente pessoal no computador do usuário, envio automático e retorno ao caminho original. Sem `sudo` no primeiro corte.
- Carregar interface, abrir conexões e monitorar arquivos somente sob demanda.

Este documento consolida uma proposta, não registra entrega dos novos utilitários.

## Informações já disponíveis e pontos de integração

| Informação | Fonte existente | Uso e limite |
| --- | --- | --- |
| Usuário, tenant e autorização | Principal autenticado e ACL efetiva do host | Revalidar no servidor em cada operação e após reconexão. |
| Host, sessão, rota e agente | `TerminalPane.vue`, gateway SSH | Origem automática; preservar a identidade e a rota efetivas. |
| Diretório corrente | `useTerminal.ts`, eventos OSC do shell | Sugestão editável quando conhecida, sem comandos de descoberta no terminal. Pode estar ausente ou obsoleta. |
| Arquivo selecionado | `FileManager.vue` | Entrada direta para copiar/editar, sem redigitar caminho. |
| Hosts autorizados, favoritos e recentes | Seletor existente em `TerminalView.vue`, `host.service.ts` | Reutilizar padrões de busca, foco e erros; evitar carregar catálogo inteiro. Ranking por pasta deve respeitar organização pessoal/corporativa. |
| Usuário SSH, credencial cadastrada e referências | Repositório/gateway SSH | Conta cadastrada no host não comprova vínculo pessoal. O gateway também permite Secret autorizado ou credencial interativa. |
| Home e listagem da sessão | Canal SFTP do gateway | Já reutiliza conexão do terminal para essas duas operações. |
| Auditoria e política de metadados | Controller SFTP e configurações | Reutilizar governança, sem registrar conteúdos ou segredos. |
| Integração Windows | Instalador e desktop do agente | Existe componente desktop; ainda não há protocolo de edição externa/monitoramento de arquivos. |

## Lacunas concretas antes da implementação

1. O gateway resolve Vault, 1Password, credenciais interativas e rota via agente. O `SftpService.openSftp()` HTTP resolve credenciais do host/1Password e conexão direta/bastion; não reproduz todo esse fluxo. O `sessionId` recebido pelo controller é usado na auditoria, não seleciona automaticamente a conexão autenticada. Unificar o contexto operacional é pré-requisito para não pedir novamente nem mudar de conta.
2. Home e listagem via WebSocket reutilizam a sessão; upload, download e edição ainda usam HTTP. Não confundir essa reutilização parcial com suporte completo aos utilitários.
3. Download HTTP acumula o arquivo inteiro em memória e upload recebe `Buffer`. Cópia intermediada precisa de streaming com limites, backpressure e concorrência controlada, mesmo que o primeiro corte aceite apenas arquivos pequenos. O limite deve ser configurável e validado no backend.
4. Credencial disponível no NodeAccess não autentica automaticamente o servidor de origem no destino. Comando direto exige conectividade entre servidores e chave existente ou autenticação interativa; não exportar credenciais, injetar senhas ou habilitar agent forwarding.
5. SCP executado no terminal não oferece confirmação estruturada de conclusão. Auditar geração/inserção do comando separadamente do sucesso de cópia gerenciada.
6. Agente de rede não equivale a agente desktop pessoal. Edição externa exige capacidade explicitamente anunciada, consentimento local e vínculo à sessão do usuário; não aceitar comandos arbitrários de execução de aplicativo vindos da web.
7. O gerenciador atual resolve home, mas abre a navegação em `/`. A resolução de home da sessão admite fallback `/` quando `realpath` falha. Para o novo destino automático, falha de resolução deve pedir um caminho explícito; não tratar `/` como home confirmado.

## UX proposta

Uma entrada `Arquivos`/`Utilitários` no terminal, aproveitando a superfície existente, e ações no menu do arquivo. Evitar novos botões permanentes para cada função. O modal monta somente ao abrir, preserva a sessão e devolve o foco ao terminal ao fechar.

Cópia: origem e arquivo preenchidos pelo contexto → escolha pesquisável do destino → home resolvido e conta SSH visível → copiar. Caminho alternativo e opções em área secundária. Hosts da mesma pasta, favoritos/recentes e demais resultados; proximidade de IP apenas se houver metadado confiável de rede, sem varredura. Arquivo existente exige decisão explícita; não sobrescrever silenciosamente.

Credenciais: usar primeiro a sessão autorizada disponível com a identidade pretendida; depois referência pessoal autorizada já existente. Se faltar, abrir o padrão de autenticação existente com apenas usuário/Secret/senha necessários. Não persistir a senha automaticamente. Uma conexão aberta com conta compartilhada não pode satisfazer silenciosamente a preferência por identidade pessoal.

Comando direto: preencher host/porta e caminhos, apresentar comando com escaping seguro para revisão, oferecer inserção sem executar. Não assumir que bastion/agente usados pelo NodeAccess estão disponíveis no servidor de origem. Primeiro corte limitado a contexto de shell compatível e arquivo individual, sem diretórios ou privilégios.

Edição externa: `Editar no aplicativo local` → download privado → abrir editor padrão/preferido → salvamentos enviados automaticamente após estabilização. Preferência de aplicativo definida localmente e reutilizada; não perguntar em cada abertura. Duplo clique mantém o comportamento atual inicialmente.

Estados: preparando, editando, alterações locais, enviando, sincronizado, offline, conflito e erro recuperável. Um envio por arquivo; salvar novamente durante envio agenda a versão mais recente. Conflito interrompe upload automático. Queda preserva cópia e pendências; retomada revalida autorização e versão remota. Encerrar com pendências requer escolha, e cópias locais sensíveis têm retenção e limpeza explícitas.

## Garantias e teste de aceitação

- Fechado: nenhuma conexão SFTP, watcher ou polling adicional dos utilitários.
- O gateway atual já aquece SFTP para sessões elegíveis. O critério acima é sobre custo adicional dos novos utilitários, não uma afirmação de que o terminal existente não abre SFTP. Preservar esse comportamento nesta etapa e medir antes de alterá-lo.
- Aberto: busca paginada, buffers limitados, progresso sem flood de eventos, hashing assíncrono e limites de sessões/bytes.
- Identidade: origem/destino e conta SSH corretos, tenant isolado, ACL e host key respeitados; segredo indisponível pede alternativa segura.
- Cópia: sucesso, cancelamento, destino lento, disco cheio, alteração da origem, colisão, perda de conexão e limpeza de temporário; nomes com espaços/Unicode/metacaracteres sem execução indevida.
- Edição: salvamento por rename, gravações parciais, saves consecutivos, duas janelas, conflito remoto, mudança de symlink, expiração, reinício do agente e falha entre upload e substituição. Não prometer exclusão mútua com escritores externos apenas verificando hash antes de gravar.
- Medir CPU, memória, tráfego e p95 de entrada/saída do terminal antes/depois e durante transferências. A proposta sob demanda não equivale a benchmark realizado.
- Testes de navegador validam UI; integração desktop precisa de Windows real com editores escolhidos. Testes simulados não homologam aplicações locais.

## Validação executada

- 15 testes aprovados: canal SFTP da sessão, contrato de serviço HTTP/erros e filtro de listagem do gateway.
- Sete cenários Playwright SFTP aprovados: criação, navegação negada, resposta atrasada, mensagem de download, mobile/teclado e configurações com sucesso/falha. Nenhum erro de página.
- Regressão completa `test:terminal-experience:web` aprovada em Chromium com inspeção CDP: seletor de hosts e foco, paginação, ACL simulada, mobile, autocomplete de caminhos, reutilização de SFTP da sessão sem HTTP, respostas antigas, timeout e recuperação, reconexão e geometria. Nenhuma anomalia CDP na execução final.
- Capturas de SFTP mobile e autocomplete mobile inspecionadas. A superfície atual do terminal já concentra muitas ações; a proposta reutiliza a entrada de arquivos e evita adicionar um botão permanente para cada utilitário.
- As primeiras execuções tiveram timeout de carregamento após iniciar Vite; uma execução ampla também expirou aguardando presença em Hosts com a página ainda vazia. As repetições com módulos/rotas carregados passaram. Isso não certifica tempo de carregamento frio nem desempenho de produção.
- Evidências em [evidence/2026-10-03-terminal-utilities](evidence/2026-10-03-terminal-utilities/). APIs e transporte dos testes de navegador são simulados; Vue, xterm e Chromium são reais.

Nenhum dos dois novos utilitários foi implementado ou testado como funcionalidade entregue nesta etapa. Não houve alteração no fluxo do produto, instalação de aplicativos ou acesso a produção. A próxima implementação deve começar pelo contexto operacional comum de sessão/identidade/rota, seguido da cópia pequena; comando direto e editor Windows são cortes separados.


## Implementação posterior à avaliação
O escopo acima é o registro da avaliação. A implementação autorizada e as evidências estão em [utilitários — implementação e validação](2026-10-03-terminal-file-utilities-implementation.md); regras atuais em [PRD específico](../PRD-terminal-file-utilities-lite.md).
