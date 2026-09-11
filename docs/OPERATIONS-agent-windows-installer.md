# Instalador Windows do NodeAccess Agent

## Artefatos

- `nodeaccess-agent-win.exe`: executável portátil para testes e troubleshooting.
- `nodeaccess-agent-windows-x64.msi`: instalador corporativo recomendado.

O MSI instala o executável e o assistente de configuração em `C:\Program Files\NodeAccess`. O token não é recebido pelo Windows Installer e não deve ser incluído em propriedades MSI.

Depois da instalação, use o assistente ou o comando PowerShell de registro fornecido pela tela de Agentes. Esse comando grava `agent.token` com ACL para SYSTEM e Administradores usando SIDs independentes do idioma e inicia o agente no modo interativo ou como tarefa agendada.

## Gerar o pacote

Requisitos na máquina Windows:

- Node.js 20 e dependências instaladas com `npm ci`;
- .NET SDK;
- WiX Toolset 4: `dotnet tool install --global wix --version 4.*`.

Execute:

```powershell
apps/agent/installer/windows/build-msi.ps1
```

A versão vem de `apps/agent/package.json`. Atualize esse campo antes da release; o workflow valida se a propriedade `ProductVersion` do MSI corresponde ao pacote do agente.

## Assinatura opcional

Quando houver certificado corporativo, configure no runner Windows:

```powershell
$env:NODEACCESS_CODE_SIGN_CERTIFICATE = "C:\secure\nodeaccess-code-signing.pfx"
$env:NODEACCESS_CODE_SIGN_PASSWORD = "<secret>"
$env:NODEACCESS_TIMESTAMP_URL = "http://timestamp.digicert.com"
apps/agent/installer/windows/build-msi.ps1
```

O script assina o EXE antes de incorporá-lo e assina o MSI ao final. A senha deve vir do secret store do CI e nunca ser versionada.

O build também executa o EXE gerado e exige que a versão seja a mesma de
`apps/agent/package.json` e que a opção segura `--token-file` esteja presente.
Ao final são gerados checksums SHA-256 e o manifesto
`nodeaccess-agent-windows-x64.json`.

O manifesto inclui `sourceSha256`, calculado sobre os fontes do agente, os
scripts do instalador, `apps/agent/package.json` e o `package-lock.json` da raiz.
Os finais de linha de arquivos de código são normalizados entre Windows e Linux.
Uma alteração nesses arquivos exige gerar novamente o pacote, mesmo sem mudar
a versão. Para distribuir uma atualização instalada, aumente a versão do agente;
a versão da aplicação é independente. O MSI aceita major/minor até 255 e patch
até 65535. O build sempre recompila o EXE e interrompe imediatamente se falhar;
`-SkipAgentBuild` não é mais suportado.

## Inclusão na release da aplicação

`npm run build` na raiz compila a aplicação web. O pacote do agente é preparado
separadamente porque o MSI exige Windows. `npm run build:all -w apps/agent`
gera EXE/MSI no Windows e os binários Linux/macOS. Em Linux/macOS, esse comando
valida ou importa primeiro o pacote Windows e depois gera Linux/macOS.

No Windows, após `npm ci`, gere o pacote com:

```powershell
npm run build:all -w apps/agent
```

Para montar a release no Linux, use os cinco arquivos Windows produzidos pelo
mesmo checkout, ou baixe automaticamente a release `agent-v<versão do agente>`:

```bash
# Importar a pasta extraída do artifact nodeaccess-agent-windows do CI:
AGENT_WINDOWS_ARTIFACTS_DIR=/caminho/windows npm run build:all -w apps/agent

# Alternativa: baixar os arquivos publicados no GitHub (requer gh autenticado):
AGENT_WINDOWS_RELEASE_REPO=organizacao/repositorio npm run build:all -w apps/agent

# Com todos os binários preparados:
./scripts/release/build-release.sh <versao-da-aplicacao>
```

As duas variáveis também podem ser usadas diretamente no `build-release.sh`.
Sem elas, ele valida os arquivos já existentes em `apps/agent/dist`.
Versão, identificação dos fontes, tamanhos e checksums são conferidos antes de
copiar o pacote e construir as imagens. O Dockerfile do backend também verifica
o pacote Windows ao construir o target de produção. Um manifesto antigo sem
`sourceSha256` é rejeitado: faça uma nova geração nativa, sem editar o manifesto.

Ao usar `BUILD_RELEASE_IMAGES=false` com bundle offline, o script extrai e valida
também o pacote da imagem backend existente, sem iniciar o container. Uma imagem
com agente desatualizado é rejeitada. Prefira o padrão `BUILD_RELEASE_IMAGES=true` e
`INCLUDE_OFFLINE_IMAGES=true` para construir e distribuir as imagens juntas.
`INCLUDE_OFFLINE_IMAGES=false` desativa apenas a exportação das imagens; para
gerar somente o tarball sem construir imagens, defina também `BUILD_RELEASE_IMAGES=false`.

Os fontes do instalador e scripts de preparação precisam acompanhar o commit.
Os binários em `apps/agent/dist` continuam ignorados pelo Git e são transportados
pelos artifacts do CI ou releases `agent-v*`.

## Upgrade e rollback

- O `UpgradeCode` do MSI é fixo e não deve mudar entre versões.
- O `Component` GUID do executável também deve permanecer estável.
- `MajorUpgrade` substitui versões anteriores e bloqueia downgrade acidental.
- O token fica fora do MSI; upgrades do binário não devem recriá-lo.
- Para rollback operacional, reinstale um MSI anterior explicitamente após remover a versão atual.

## Validação

O workflow `agent-native-smoke.yml`:

1. testa runtime, integração e contrato do instalador;
2. compila EXE e MSI em runner Windows;
3. abre o banco MSI e valida sua versão;
4. publica os dois artefatos;
5. executa o onboarding com Playwright e Chromium CDP.

No runner Windows, o CI também instala silenciosamente o MSI, executa o EXE
instalado, valida versão e argumentos e remove o pacote. Tags `agent-v*`
cuja versão corresponda a `apps/agent/package.json` publicam
EXE, MSI, checksums e manifesto na release correspondente. O build geral da
release falha se qualquer binário anunciado estiver ausente, evitando uma
distribuição parcial.

Teste local das proteções de empacotamento:

```bash
node --test apps/agent/installer/windows/artifacts.test.mjs
```

Os testes cobrem importação completa, pacote antigo mesmo com versão idêntica,
alterações de fontes/dependências/instalador, corrupção, arquivos ausentes,
checksums incorretos e interrupção antecipada do script de release.

## Assistente Windows (agente 1.1.0)

Ao terminar a instalação interativa, escolha **Configurar e conectar**. O mesmo
assistente fica disponível no menu Iniciar como **NodeAccess Agent**. Instalações
silenciosas não abrem a janela.

1. Informe a URL HTTPS do servidor, sem caminhos ou token na URL.
2. Cole o token emitido no painel de Agentes.
3. Escolha se o agente deve iniciar quando esse usuário entrar no Windows.
4. Clique em **Validar e conectar**. A credencial é testada com timeout antes de
   substituir a configuração anterior. Erros de token, rede ou TLS mantêm os
   dados anteriores.

A janela permite iniciar/parar o processo, acompanhar o estado e a quantidade
de conexões ativas e substituir o token. Parada e troca com processo ativo pedem
confirmação porque interrompem os túneis. Fechar a janela mantém o agente ativo.
O assistente opera no contexto do usuário Windows (inclusive sua VPN); para
execução corporativa como SYSTEM, continue usando o procedimento do painel.

Configuração e token ficam em `%LOCALAPPDATA%\NodeAccess\Agent`, com herança de
ACL removida e acesso para o próprio usuário, SYSTEM e Administradores. O token
não é colocado na linha de comando, no JSON de status ou em propriedades MSI.
A inicialização automática usa um atalho na pasta Startup do usuário. Desative
essa opção antes de desinstalar se não pretende reinstalar; dados pessoais de
configuração são preservados pelo MSI.

O assistente exige certificado TLS confiável pelo runtime. Para CA privada,
use o modo CLI com `--ca`, conforme o diagnóstico do painel; o assistente não
desabilita a validação TLS. `--check` é uma verificação explícita de registro com
limite de 10 segundos e sem reconexão. `--status-file` habilita apenas um arquivo
local de estado, sem sondagens adicionais no caminho de conexão normal.

O agente passou de 1.0.0 para 1.1.0 para permitir upgrade MSI. Gere os artefatos
novamente após alterações nos fontes do agente ou no instalador.

## Agente 1.1.1: upgrade e diagnostico do assistente

A partir desta revisao o download do portal usa o mesmo nome do artefato de
build: `nodeaccess-agent-windows-x64.msi`. Versoes anteriores do portal usavam
`NodeAccessAgent.msi`; o Windows Installer pode exigir esse nome ao reparar o
mesmo produto antigo. Nao renomear arbitrariamente pacotes para manutencao.
Upgrades de versao usam MajorUpgrade e mantem UpgradeCode e GUIDs de componentes.

O assistente verifica `--token-file`, `--check` e `--status-file` antes de
habilitar a entrada de token. EXE ausente ou incompativel orienta instalar/reparar
o pacote. Sem configuracao, Iniciar fica desabilitado. O registro distingue
TLS, DNS, conexao recusada, rejeicao do servidor, resposta HTTP inesperada e
timeout usando codigos seguros no arquivo temporario de status; nenhum token
ou erro bruto de rede aparece nesse diagnostico. A configuracao anterior e
preservada quando a validacao falha.

Para atualizar o agente instalado a partir da distribuicao local validada:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\windows\update-installed-agent.ps1
```

O script verifica manifesto/checksums/versao, copia o MSI para pasta temporaria
local, solicita elevacao, grava log e confere versao e hash do EXE instalado.
Codigo 3010 requer reinicio manual; nao reinicia automaticamente. Falha do MSI
interrompe a verificacao com indicacao do log. Configuracao e token em LocalAppData
nao sao removidos pelo MSI. Para validar o assistente atualizado, feche a janela
anterior e abra novamente pelo menu Iniciar.

O CI executa `tools/agent/msi-lifecycle.test.ps1` em Windows descartavel com
`RUN_AGENT_MSI_LIFECYCLE=true`: instalacao de fixture antiga com nome legado,
upgrade, comparacao de EXE e assistente instalados, simulacao de EXE obsoleto,
reparacao a partir de outra pasta, desinstalacao e instalacao limpa. O teste
recusa rodar sobre uma instalacao de usuario existente.

A nova distribuicao Windows precisa ser incluida na proxima imagem backend e
release web para atualizar os downloads da nuvem. Gerar/instalar o MSI local
nao publica uma nova imagem no servidor.

## Agente 1.2.0: identidade visual e configuracao guiada

Logo e icone do NodeAccess no assistente, atalho, lista de aplicativos e tela de
conclusao do MSI. A interface destaca Validar e conectar e apresenta estado,
feedback e instrucao de uso com hierarquia visual. A pasta protegida de token e
configuracao e preservada. O portal separa instalador e comandos alternativos,
com token visivel e copiavel durante o onboarding.

A preparacao agora e incremental para as tres plataformas; consulte
`OPERATIONS-agent-platform-builds.md`. Os comandos antigos de build continuam
validos, mas `build:all` e `build-release.sh` preparam os artefatos desatualizados
automaticamente quando a plataforma de build esta disponivel.

## 1.3.0: processo, inicializacao e bandeja

O MSI instala `nodeaccess-desktop.exe`, com descricao NodeAccess Agent, icone e versao do pacote. Esse aplicativo permanece aberto enquanto o assistente PowerShell exibe a bandeja. O transporte continua em `nodeaccess-agent.exe`; ambos podem ser identificados em Detalhes no Gerenciador de Tarefas. O PowerShell do assistente tambem aparece como processo auxiliar.

Ao habilitar “Iniciar quando eu entrar no Windows” durante a configuracao, o atalho por usuario `NodeAccess Agent.lnk` aponta para o aplicativo com `-Run`. A entrada pode ser gerenciada em Aplicativos de inicializacao no Windows. Atalhos antigos sao atualizados ao abrir o assistente, mantendo o nome e sem escrever em StartupApproved. A inicializacao ocorre no login, usando a rede/VPN do usuario, e nao antes do login como servico.

Fechar a janela apenas a oculta. Clique duas vezes no icone NodeAccess para reabrir. O menu exibe estado e detalhes de servidor, conexoes, versao e PID; oferece iniciar, parar e sair/parar (com confirmacao). O Windows pode colocar o icone na area de icones ocultos. O token nunca aparece na bandeja. Uma segunda abertura sinaliza a janela existente, sem criar outra bandeja na mesma sessao.

Validacao: executar `setup-ui.test.ps1`, `desktop.test.ps1` (apos build), `setup.test.ps1` e `setup-live.test.ps1`. O teste UI usa estado e identificador de instancia isolados, verifica ocultar/reabrir, credenciais, falhas e rejeicao de status pertencente a outro PID. O teste desktop verifica metadados, processo, argumento de login e encerramento junto com o assistente. A CI tambem cobre o ciclo MSI em maquina descartavel. No desktop real, confirmar visualmente a entrada de inicializacao e o comportamento apos novo login.

Referencias: [inicializacao no Windows](https://support.microsoft.com/pt-PT/Windows/experience/startup-boot/configure-startup-applications-in-windows) e [NotifyIcon](https://learn.microsoft.com/en-us/dotnet/desktop/winforms/controls/notifyicon-component-overview-windows-forms).

## 1.3.1: oferecer atualizacao ao abrir o instalador

Ao abrir interativamente um MSI mais novo, uma versao anterior com o mesmo UpgradeCode gera a tela “Atualizar NodeAccess Agent”, antes de qualquer alteracao da instalacao. O usuario pode atualizar ou cancelar. O texto informa a versao de destino, preservacao do token/configuracao e possibilidade de interrupcao das conexoes. A tela final de upgrade permite abrir o agente sem orientar o usuario a gerar outro token.

A remocao da versao anterior ocorre dentro da transacao de instalacao (`afterInstallInitialize`), permitindo rollback da remocao se a atualizacao falhar. [Referencia WiX](https://docs.firegiant.com/wix/schema/wxs/majorupgrade/).

`tools/windows/update-installed-agent.ps1` agora usa interface completa para mostrar a oferta. `/qn` e `/passive`, quando usados diretamente em automacao, continuam sem essa confirmacao. Uma versao mais antiga permanece bloqueada; abrir novamente o mesmo pacote segue o fluxo de manutencao do Windows Installer.

Nao ha consulta automatica a novas versoes na nuvem neste fluxo. A oferta ocorre ao executar o instalador novo.

O teste `msi-upgrade.test.ps1` confere as tabelas do MSI compilado, incluindo ordem de deteccao/confirmacao/execucao, cancelar e sequenciamento de rollback, sem alterar instalacoes. O ciclo de instalacao/upgrade/reparo na CI descartavel tambem verifica hashes dos arquivos de configuracao e token.

## 1.4.0: consulta automatica e download de atualizacoes

O aplicativo Windows consulta o servidor salvo em sua configuracao, 30–60 segundos apos abrir e depois a cada seis horas. Falhas voltam a ser tentadas apos 15 minutos; o menu da bandeja e a janela oferecem consulta manual. Nenhuma consulta usa token ou interrompe o transporte. O aviso de versao disponivel ocorre uma vez por versao/servidor em cada execucao; o Windows pode suprimir notificacoes, mas a oferta continua na janela e no menu.

Fluxo: notificacao → Baixar atualizacao → download e verificacao em segundo plano → Abrir instalador → confirmar interrupcao das conexoes → MSI com Atualizar/Cancelar. Nao ha instalacao silenciosa automatica. Se cancelar o MSI apos abrir, reabra o aplicativo pelo menu Iniciar. O instalador e mantido no diretorio protegido `%LOCALAPPDATA%\NodeAccess\Agent\updates`.

O servidor publica `GET /api/v1/agents/updates/windows`, sem autenticacao, como os downloads ja existentes. Retorna apenas versao do agente, plataforma/arquitetura, caminho fixo do MSI, tamanho e SHA-256 do manifesto. Manifesto/arquivo ausente ou inconsistente retorna 503 sem detalhes internos. O agente aceita HTTPS do servidor configurado (WSS e normalizado para HTTPS), bloqueia redirecionamentos, compara versoes numericamente e confere tamanho/hash antes de oferecer abrir o MSI. Um pacote que mudar durante o download sera rejeitado; baixar novamente consulta metadados novos. Atualizacoes iguais ou inferiores nao sao oferecidas.

Publicacao: gerar o release completo contendo backend com essa rota e os artefatos atualizados. O build existente valida manifesto e integridade dos pacotes. Instalar manualmente 1.4.0 uma vez nos computadores com versoes anteriores; elas ainda nao possuem a consulta automatica. Depois, novas versoes publicadas no mesmo servidor sao descobertas automaticamente. Nao e necessario alterar ou gerar outro token.

Testes: `updates.test.ps1` cobre comparacao de versoes, origem, integridade e arquivos parciais; `updates-live.test.ps1` usa HTTP local apenas no teste para exercitar streaming, timeout de cabecalhos/corpo, 503 e redirecionamentos. A producao continua exigindo HTTPS com validacao de certificado. `setup-ui.test.ps1` cobre oferta, download verificado, erro com retry e resposta de servidor antigo ignorada. Testes backend cobrem manifestos validos/invalidos e a rota publica.
