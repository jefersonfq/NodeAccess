# PRD SSH Importers Lite

## Objetivo
Reduzir a friccao de adocao do NodeAccess permitindo importar hosts SSH e metadados basicos de ferramentas ja usadas pelo mercado, com preview, deduplicacao e importacao segura.

## Motivacao
Um dos maiores atritos para trocar ou adotar uma plataforma de acesso SSH e recadastrar manualmente hosts, usuarios, portas, grupos, pastas, tags e chaves.

O importador deve permitir que o usuario chegue ao primeiro valor rapidamente:
- importar inventario existente
- revisar antes de gravar
- corrigir campos invalidos na propria tela
- evitar expor ou importar segredos sem intencao explicita

## Criterios de sucesso
- reduzir tempo de onboarding de equipes que ja usam clientes SSH
- permitir importar ao menos `nome`, `host/ip`, `porta`, `usuario`, `grupo/pasta` e `tags` quando disponiveis
- nao importar senhas, passphrases ou chaves privadas sem confirmacao clara
- fornecer relatorio de importacao com criados, ignorados, duplicados e erros
- falhar de forma segura sem criar hosts parcialmente inconsistentes

## Ferramentas e formatos alvo
### Prioridade 1
- CSV generico do NodeAccess
  - formato mais previsivel para migracao assistida
  - bom para clientes legados sem export estruturado
- OpenSSH config
  - `Host`, `HostName`, `User`, `Port`, `IdentityFile`, `ProxyJump`
  - nao importar segredo; apenas referencia/caminho como metadado opcional
- Apache Guacamole
  - importacao inicial de `user-mapping.xml` para conexoes SSH
  - mapear conexoes por usuario para hosts pessoais ou escopo escolhido pelo admin
- MobaXterm
  - importar arquivo de sessoes/export quando disponivel
  - suportar fluxo guiado para arquivo `.ini`/export de sessoes, com aviso sobre variacoes de versao
- mRemoteNG
  - importar XML/CSV de conexoes
  - aproveitar pasta/grupo como pasta ou tag no NodeAccess

### Prioridade 2
- PuTTY
  - export de sessoes do registry/arquivo gerado pelo usuario
  - mapear `HostName`, `PortNumber`, `UserName`, `PublicKeyFile`
- Termius
  - priorizar CSV/JSON/OpenSSH config exportavel pelo usuario
  - nao tentar acessar cloud/vault do Termius
- SecureCRT
  - importar arquivos de sessao quando fornecidos pelo usuario
- Royal TS / Royal TSX
  - avaliar export estruturado como evolucao
- Remmina
  - importar arquivos `.remmina` para SSH quando aplicavel

### Fora do escopo inicial
- RDP, VNC, Telnet e protocolos nao SSH
- descriptografar cofres proprietarios
- importar senhas armazenadas em cliente local
- conectar em APIs/clouds de terceiros para buscar dados automaticamente
- sincronizacao continua bidirecional

## UX recomendada
### Entrada principal
Adicionar acao `Importar hosts` na tela de Hosts para usuarios com permissao de gerenciar hosts.

### Wizard sugerido
1. `Fonte`
   - selecionar ferramenta/formato
   - mostrar texto curto sobre o que sera importado e o que nao sera
2. `Arquivo`
   - upload ou arrastar arquivo
   - alternativa para colar conteudo em textarea nos formatos texto
3. `Preview`
   - tabela com hosts detectados
   - status por linha: valido, duplicado, incompleto, nao suportado
   - edicao rapida de campos obrigatorios
   - escolha de escopo: pessoal, equipe ou global conforme permissao
   - escolha de pasta/tag padrao para todos
4. `Confirmacao`
   - resumo antes de gravar
   - confirmar tratamento de chaves/segredos quando houver referencias
5. `Resultado`
   - criados, ignorados, duplicados, erros
   - download de relatorio CSV/JSON

## Microcopy essencial
- `Senhas nao serao importadas. Configure credenciais depois ou use 1Password/Chave PEM.`
- `Chaves privadas so serao importadas se voce selecionar explicitamente um arquivo/conteudo de chave.`
- `Hosts duplicados podem ser ignorados ou atualizados conforme sua escolha.`
- `Campos nao suportados pela ferramenta original serao ignorados sem bloquear a importacao.`

## Regras de permissao
- usuario sem permissao de gerenciar hosts nao ve importador
- usuario comum com permissao importa apenas hosts pessoais, salvo permissao futura via RBAC
- admin pode importar como:
  - pessoal
  - equipe/grupo
  - global
- superadmin nao deve atravessar tenant implicitamente; importacao sempre ocorre no tenant ativo

## Modelo normalizado de importacao
Antes de criar hosts reais, qualquer parser deve converter para um modelo intermediario:

```ts
type ImportedHostDraft = {
  source: string
  sourceId?: string
  name: string
  ip: string
  port?: number
  sshUser?: string
  folderPath?: string
  groupName?: string
  tags?: string[]
  authHint?: 'password' | 'pem' | 'agent' | 'unknown'
  pemReference?: string
  bastionHint?: {
    host?: string
    port?: number
    user?: string
  }
  raw?: unknown
  warnings: string[]
}
```

Esse modelo evita acoplar a tela ou o service de Hosts a detalhes de cada ferramenta.

## Mapeamento para NodeAccess
- `name`
  - nome da conexao original
  - fallback: `sshUser@ip` ou `ip`
- `ip`
  - `HostName`, `hostname`, `server`, `address` ou equivalente
- `port`
  - default `22`
- `sshUser`
  - usuario do arquivo quando existir
- `folderPath`
  - pasta pessoal no NodeAccess
- `groupName`
  - pode virar grupo apenas se admin confirmar e grupo existir
  - no MVP, grupo desconhecido vira tag ou pasta, nao cria grupo automaticamente
- `tags`
  - ferramenta de origem, protocolo, pasta original, ambiente quando inferivel
- `bastion`
  - `ProxyJump`/jump host vira sugestao de bastion, nao criacao automatica obrigatoria
- `PEM`
  - `IdentityFile` vira referencia textual/aviso; upload real da chave deve ser separado e explicito

## Deduplicacao
Regra inicial sugerida:
- considerar possivel duplicado quando `tenantId + ip + port + sshUser` bater
- se nome for igual mas destino diferente, nao tratar como duplicado automatico
- opcoes no preview:
  - ignorar duplicados
  - criar mesmo assim
  - atualizar existentes, apenas para admin e com confirmacao

## Seguranca
- nunca persistir segredo vindo de arquivo importado sem passo explicito
- nunca exibir segredo detectado no preview
- mascarar campos sensiveis quando encontrados
- salvar chaves privadas apenas usando fluxo existente de Chave PEM e criptografia em repouso
- registrar auditoria administrativa:
  - usuario que importou
  - ferramenta/formato
  - quantidade de linhas
  - criados/ignorados/erros
  - escopo escolhido
- manter isolamento por tenant em todas as etapas

## Backend recomendado
Criar modulo proprio de importacao para baixo acoplamento:
- `host-import.parsers`
  - parser por formato
- `host-import.normalizer`
  - converte para `ImportedHostDraft`
- `host-import.validator`
  - valida campos obrigatorios e permissoes
- `host-import.service`
  - preview, deduplicacao e commit

Endpoints sugeridos:
- `POST /api/v1/host-imports/preview`
- `POST /api/v1/host-imports/commit`

O commit deve receber um `previewId` ou payload assinado/temporario para evitar divergencia entre preview e importacao.

## Frontend recomendado
- reutilizar modal/wizard de importacao existente se houver baixo risco
- manter a tela de Hosts como ponto de entrada
- parser pode ser no backend para consistencia e seguranca
- frontend deve focar em upload, preview, correcao e feedback
- tabela de preview deve suportar muitos registros sem travar a tela

## Observabilidade
Metricas/eventos:
- formato selecionado
- tamanho do arquivo
- quantidade de hosts detectados
- quantidade de hosts criados
- quantidade de duplicados
- quantidade de linhas com erro
- tempo de parse
- tempo de commit

Logs devem evitar payload bruto quando houver risco de segredo.

## Roadmap sugerido
### Fase 1
- CSV generico NodeAccess
- OpenSSH config
- preview + deduplicacao + commit
- auditoria basica

### Fase 2
- Apache Guacamole `user-mapping.xml`
- MobaXterm export/sessoes
- mRemoteNG XML/CSV
- relatorio de resultado para download

### Fase 3
- PuTTY
- Termius por CSV/JSON/OpenSSH
- SecureCRT/Remmina/Royal TS conforme demanda real
- importacao assistida de bastion

### Fase 4
- API de importacao para parceiros
- importacao via CLI/admin script
- jobs assincronos para arquivos grandes

## Riscos e trade-offs
- formatos proprietarios podem variar por versao
- importar senha aumenta risco e suporte; melhor deixar fora do MVP
- criar grupos automaticamente pode gerar modelo de acesso errado; melhor exigir confirmacao
- parser no frontend pode vazar mais detalhes e duplicar regra; backend e melhor fonte de verdade
- muitos importadores de uma vez aumentam manutencao; priorizar por demanda real

## Referencias externas
- Apache Guacamole documenta `user-mapping.xml` como configuracao de usuarios/conexoes no metodo default.
- MobaXterm documenta import/export de sessoes via sidebar e menciona edicao de `MobaXterm.ini`.
- mRemoteNG documenta import/export de conexoes em XML e CSV.
- Termius documenta uso de hosts, grupos, chaves, snippets, port forwarding e known hosts; para importacao inicial, preferir formatos exportaveis pelo usuario como OpenSSH/CSV/JSON quando disponiveis.
