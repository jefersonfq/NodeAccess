# PRD Lite - SSH Gateway Auditavel

## Objetivo
- permitir acesso SSH nativo passando pelo NodeAccess como proxy/gateway
- manter auditoria, autorizacao, politicas e gravacao equivalentes ao terminal web
- permitir conexao a hosts cadastrados sem expor credenciais para o cliente SSH
- suportar comandos SSH padrao, `ProxyCommand`, SCP, SFTP e execucao remota quando viavel

## Contexto
Este fluxo e diferente do SSH CA direto. No SSH Gateway, o usuario usa um cliente
SSH nativo, mas a sessao passa pelo NodeAccess antes de chegar ao host final.

O NodeAccess autentica o usuario, valida MFA conforme configuracao, resolve o host
cadastrado, confere permissao e abre a conexao SSH real usando as credenciais
definidas no cadastro do host.

Existem dois fluxos principais:
- entrada no ambiente SSH do NodeAccess, sem destino inicial, para pesquisar e
  conectar em hosts cadastrados
- entrada com destino completo no comando inicial, para autenticar no NodeAccess
  e cair diretamente no host desejado

## Decisao principal
Priorizar o modo gerenciado pelo NodeAccess para sessoes com auditoria completa.
Nesse modo, o cliente SSH conecta no NodeAccess como servidor SSH, informa o
destino desejado, e o NodeAccess abre a conexao real com o host usando as
credenciais cadastradas.

`ProxyCommand` deve ser suportado com cuidado. O uso puro de `ssh -W %h:%p`
normalmente cria um tunel TCP para o host final. Nesse formato, o cliente SSH
externo autentica no host final e o NodeAccess nao consegue aplicar a mesma
auditoria profunda da sessao web sem uma camada adicional de proxy SSH
protocol-aware.

Por isso, o PRD separa:
- modo gerenciado auditavel: prioridade do produto
- modo `ProxyCommand` compatibilidade: opcional, com limitacoes explicitas

## Arquitetura proposta
### Modo gerenciado auditavel
```
cliente SSH nativo
  -> NodeAccess SSH Gateway
  -> validacao de usuario, MFA, permissao e politica
  -> credenciais cadastradas do host
  -> host final
```

O gateway deve criar uma sessao no mesmo modelo conceitual da sessao web:
- `source = native_ssh_gateway`
- usuario autenticado no NodeAccess
- host cadastrado resolvido
- usuario SSH efetivo no host
- data de inicio/fim
- status e motivo de encerramento
- referencia para gravacao/auditoria quando habilitada

### Modo ambiente NodeAccess
```
cliente SSH nativo
  -> NodeAccess SSH Gateway
  -> login/MFA
  -> shell controlado do NodeAccess
  -> usuario pesquisa/lista/conecta em hosts autorizados
  -> host final
```

Esse modo deve funcionar em qualquer cliente SSH comum. O usuario conecta apenas
no NodeAccess e, dentro do ambiente, usa comandos como `sshs`, `hosts` ou
`connect` para pular para um host cadastrado.

### Modo tunel compatibilidade
```
cliente SSH nativo
  -> ProxyCommand ssh -W
  -> NodeAccess SSH Gateway
  -> tunel TCP para host final
```

Esse modo pode ser util para compatibilidade com OpenSSH, SCP e SFTP, mas nao
deve ser vendido como equivalente ao modo web se o NodeAccess apenas encaminhar
bytes criptografados para o host final.

Para manter auditoria completa via `ProxyCommand`, o gateway precisaria terminar
ou interpretar o protocolo SSH do cliente externo e criar uma segunda conexao SSH
gerenciada ate o host final. Isso deve ser tratado como evolucao tecnica propria.

## Configuracao do Gateway SSH
- porta padrao sugerida: `2222`
- porta configuravel pela interface administrativa do NodeAccess
- configuracao inicial recomendada: por instancia/ambiente do gateway
- tenants devem herdar o padrao no primeiro corte
- override por tenant deve ficar fora do primeiro corte, salvo necessidade clara

Configuracoes esperadas:
- habilitar/desabilitar SSH Gateway
- porta de escuta
- metodos de autenticacao permitidos
- exigencia de MFA
- timeout de autenticacao
- timeout de sessao inativa
- politicas de auditoria/gravacao
- suporte a SCP/SFTP/execucao remota

## Autenticacao no NodeAccess
### Primeiro corte
- usuario e senha do NodeAccess
- MFA interativo no terminal quando configurado:
  - codigo por email
  - authenticator/TOTP

Exemplo de experiencia no modo gerenciado:
```
$ ssh -p 2222 'pulsesuporte@root@172.16.1.2'@186.250.124.90
pulsesuporte@186.250.124.90's password:
MFA code:
```

### Futuro
- chave SSH do usuario para autenticar no NodeAccess Gateway
- chave SSH + MFA
- certificado SSH emitido pelo NodeAccess
- sessao/token temporario emitido por CLI ou painel

Chave SSH no gateway e uma evolucao desejavel porque melhora automacao e reduz
senha interativa, mas deve manter MFA ou politica equivalente para acessos sensiveis.

## Resolucao de destino
O destino solicitado deve resolver para exatamente um host cadastrado no NodeAccess.

Entradas aceitas:
- IP cadastrado
- hostname cadastrado
- alias do host

Regras:
- se nao existir host cadastrado, bloquear
- se houver ambiguidade, bloquear e orientar o usuario a usar alias/hostname unico
- se o usuario autenticado nao tiver acesso ao host, bloquear
- a autorizacao deve seguir as mesmas regras do acesso web: escopo pessoal, equipe, grupo e global
- o backend/gateway e sempre a fonte de verdade; o cliente SSH nao decide permissao

## Usuario SSH do destino
O usuario antes do host final representa o usuario SSH desejado no destino.

Exemplo:
```
ssh -p 2222 'pulsesuporte@root@172.16.1.2'@186.250.124.90
```

Interpretacao:
- `pulsesuporte` = usuario autenticado no NodeAccess
- `186.250.124.90` = endpoint publico do NodeAccess SSH Gateway
- `root` = usuario SSH desejado no host final
- `172.16.1.2` = host cadastrado no NodeAccess

Se o usuario SSH do destino for omitido:
```
ssh -p 2222 'pulsesuporte@172.16.1.2'@186.250.124.90
```

O NodeAccess deve usar o usuario padrao cadastrado no host.

## Credenciais usadas no host final
O cliente SSH nao envia senha/PEM do host final.

O NodeAccess deve abrir a conexao real usando:
- credencial padrao cadastrada no host
- bastion efetivo do host, se existir
- regras ja existentes de resolucao de credenciais e bastion

Se houver varias credenciais no host, o primeiro corte deve usar a credencial
padrao do host. Seletores adicionais podem entrar depois.

## Exemplos de conexao
### Entrar somente no NodeAccess
O usuario pode conectar apenas no gateway, sem informar destino final:
```
ssh -p 2222 pulsesuporte@nodeaccess.empresa.com
```

Depois de autenticar e passar pelo MFA quando exigido, o NodeAccess abre um
ambiente SSH controlado:
```
NodeAccess SSH Gateway

Digite para pesquisar hosts ou use comandos:
  sshs        abrir seletor de hosts
  hosts       listar hosts acessiveis
  connect     conectar por alias, IP ou hostname
  exit        sair
```

Exemplos dentro do ambiente:
```
sshs
hosts
connect db-prod-01
connect root@172.16.1.2
connect 172.16.1.2
```

Ao executar `connect`, o NodeAccess deve validar se o host existe, se o usuario
tem permissao e qual credencial padrao deve ser usada no host final.

### Modo gerenciado auditavel
Com usuario SSH explicito:
```
ssh -p 2222 'pulsesuporte@root@172.16.1.2'@186.250.124.90
```

Com endpoint DNS:
```
ssh -p 2222 'pulsesuporte@root@db-prod-01'@nodeaccess.empresa.com
```

Com usuario SSH omitido, usando usuario padrao do host:
```
ssh -p 2222 'pulsesuporte@db-prod-01'@nodeaccess.empresa.com
```

Com IP conhecido do host cadastrado:
```
ssh -p 2222 'pulsesuporte@root@172.16.1.2'@nodeaccess.empresa.com
```

Executando comando remoto pelo gateway gerenciado:
```
ssh -p 2222 'pulsesuporte@root@db-prod-01'@nodeaccess.empresa.com uptime
```

Observacao: no OpenSSH, o host da conexao fica depois do ultimo `@`. Por isso o
endpoint do NodeAccess deve ser o ultimo trecho:
```
ssh -p 2222 'usuarioNodeAccess@usuarioSSH@hostDestino'@nodeaccess.empresa.com
```

O formato abaixo nao deve ser o formato principal, porque tende a fazer o cliente
conectar no ultimo host como destino da conexao SSH:
```
ssh -p 2222 pulsesuporte@root@nodeaccess.empresa.com@172.16.1.2
```

### ProxyCommand compatibilidade
Tunel TCP padrao:
```
ssh -o ProxyCommand="ssh -p 2222 -W %h:%p pulsesuporte@nodeaccess.empresa.com" root@172.16.1.2
```

Execucao remota via tunel TCP:
```
ssh -o ProxyCommand="ssh -p 2222 -W %h:%p pulsesuporte@nodeaccess.empresa.com" root@172.16.1.2 uptime
```

SCP via tunel TCP:
```
scp -o ProxyCommand="ssh -p 2222 -W %h:%p pulsesuporte@nodeaccess.empresa.com" ./arquivo.txt root@172.16.1.2:/tmp/
```

SFTP via tunel TCP:
```
sftp -o ProxyCommand="ssh -p 2222 -W %h:%p pulsesuporte@nodeaccess.empresa.com" root@172.16.1.2
```

Limitacao: se implementado como tunel TCP puro, esse modo valida o usuario
NodeAccess e pode validar permissao ao host, mas nao usa a credencial padrao
cadastrada do host nem grava terminal com a mesma profundidade do modo gerenciado.

### Configuracao em `~/.ssh/config`
```
Host nodeaccess-gateway
  HostName nodeaccess.empresa.com
  Port 2222
  User pulsesuporte

Host db-prod-01-via-nodeaccess
  HostName nodeaccess.empresa.com
  Port 2222
  User pulsesuporte@root@db-prod-01
```

Exemplo de uso:
```
ssh db-prod-01-via-nodeaccess
```

Observacao: esse exemplo usa o modo gerenciado. Para `ProxyCommand`, a
configuracao pode usar `ProxyCommand ssh -p 2222 -W %h:%p`, mas com as limitacoes
do modo tunel.

## Formato compacto opcional
Formato de conveniencia:
```
ssh -p 2222 'pulsesuporte@root@172.16.1.2'@186.250.124.90 -o IdentitiesOnly=yes
```

Interpretacao:
- `pulsesuporte` = usuario NodeAccess
- `root` = usuario SSH do host final
- `172.16.1.2` = host final cadastrado
- `186.250.124.90` = endpoint publico do NodeAccess Gateway

Variacao com host por alias:
```
ssh -p 2222 'pulsesuporte@root@db-prod-01'@nodeaccess.empresa.com
```

Riscos desse formato com multiplos `@`:
- parsing proprio
- ambiguidades com usuarios, aliases e hosts
- menor compatibilidade com ferramentas SSH
- conflito se o usuario NodeAccess for um email

Alternativa menos ambigua para avaliar:
```
ssh -p 2222 'pulsesuporte+root+db-prod-01'@nodeaccess.empresa.com
```

O delimitador final deve ser definido antes da implementacao.

## Utilitario `sshs` no SSH do NodeAccess
Quando o usuario conectar diretamente no SSH Gateway sem destino final, o
NodeAccess deve oferecer um ambiente SSH controlado. Dentro dele, o utilitario
`sshs` permite pesquisar hosts acessiveis e iniciar a conexao sem voltar para a
interface web.

Exemplo:
```
ssh -p 2222 pulsesuporte@nodeaccess.empresa.com
```

Apos autenticar:
```
NodeAccess SSH Gateway

Digite para pesquisar hosts ou use comandos:
  sshs        abrir seletor de hosts
  hosts       listar hosts acessiveis
  connect     conectar por alias, IP ou hostname
  exit        sair
```

Exemplos dentro do utilitario:
```
sshs
connect db-prod-01
connect root@172.16.1.2
connect 172.16.1.2
```

Regras do utilitario:
- listar somente hosts autorizados para o usuario autenticado
- buscar por nome, alias, IP e hostname
- permitir conexao por host escolhido no seletor
- permitir conexao por string digitada, como `root@172.16.1.2`
- indicar favoritos e recentes quando existirem
- nao exibir segredos, senha, PEM ou credencial resolvida
- ao conectar, criar sessao auditavel igual ao acesso gerenciado direto
- ao omitir usuario SSH, usar usuario padrao cadastrado no host
- se o host nao existir ou o usuario nao tiver permissao, bloquear antes de
  iniciar qualquer conexao SSH ao destino

Este utilitario deve se alinhar ao PRD `docs/PRD-sshs-like-host-switcher-lite.md`.

## Credencial informada pelo usuario
O fluxo principal deve usar a credencial padrao cadastrada no host para evitar
expor segredos e preservar auditoria centralizada.

Se a configuracao do ProxySSH permitir credencial sob demanda, o gateway pode
solicitar usuario/senha do host final de forma interativa apos autenticar no
NodeAccess. Esse modo deve ser opcional por politica e registrar que a credencial
foi fornecida pelo usuario durante a sessao.

Exemplo conceitual:
```
$ ssh -p 2222 'pulsesuporte@root@172.16.1.2'@nodeaccess.empresa.com
pulsesuporte@nodeaccess.empresa.com's password:
MFA code:
Target password for root@172.16.1.2:
```

Guardrails:
- nunca aceitar senha do host final embutida na linha de comando
- nao persistir a senha fornecida sem confirmacao/politica explicita
- aplicar autorizacao do NodeAccess antes de pedir a senha do destino
- registrar auditoria diferenciando credencial cadastrada de credencial sob demanda

## Auditoria e politicas
O SSH Gateway deve passar pelo mesmo pipeline de controle da sessao web sempre
que possivel.

Requisitos:
- registrar metadados da sessao
- gravar terminal completo quando habilitado
- permitir sessao ao vivo quando aplicavel
- preservar trilha de auditoria por usuario, host e horario
- preparar integracao com bloqueio de comandos restritos
- aplicar politica antes de abrir conexao e durante a sessao quando suportado

Bloqueio de comandos sera detalhado em PRD proprio, mas este gateway deve nascer
compativel com essa politica para acesso web e acesso SSH/proxy.

## Suporte a comandos, SCP e SFTP
### Shell interativo
Obrigatorio no primeiro corte.

### Execucao remota
Desejavel no primeiro corte no modo gerenciado se o pipeline de auditoria
conseguir registrar comando e saida de forma confiavel.

### SCP/SFTP
Desejavel, mas exige cuidado porque:
- trafego nao e igual a terminal interativo
- bloqueio de comandos pode nao se aplicar da mesma forma
- auditoria deve registrar metadados e transferencia quando possivel
- pode exigir politicas separadas de upload/download
- via `ProxyCommand -W`, tende a operar como tunel TCP e nao como sessao
  gerenciada com credenciais cadastradas

Recomendacao:
- primeiro corte: shell interativo
- segundo corte: execucao remota
- terceiro corte: SCP/SFTP com politica propria

## Requisitos de seguranca
- autenticar usuario NodeAccess antes de qualquer conexao ao host final
- exigir MFA conforme configuracao do ProxySSH
- validar permissao do usuario no host antes de conectar
- revalidar permissao no gateway, mesmo que o host tenha sido listado antes
- nao expor credenciais do host para o cliente SSH
- registrar tentativas negadas
- limitar brute force por IP/usuario
- configurar timeout de autenticacao
- configurar timeout de sessao inativa
- validar host key conforme politica existente do NodeAccess
- manter isolamento por tenant

## UX administrativa
Tela de configuracao do ProxySSH/SSH Gateway:
- status habilitado/desabilitado
- porta do gateway
- endpoint publico sugerido
- metodos de autenticacao permitidos
- MFA obrigatorio/opcional conforme politica
- suporte a shell, execucao remota, SCP e SFTP
- instrucao de uso com exemplos copiaveis
- teste de porta/configuracao
- aviso quando a porta configurada nao estiver acessivel externamente

UX para o usuario:
- exemplos de conexao gerados com o usuario logado
- exemplos por host: `ProxyCommand`, execucao remota, SCP e SFTP quando habilitados
- mensagem clara quando o acesso for negado
- mensagem clara quando o host nao existir ou for ambiguo
- orientacao para usar `sshs` quando conectar apenas no gateway

## Estados e erros esperados
- usuario/senha invalido
- MFA exigido, invalido ou expirado
- host nao encontrado
- host ambiguo
- usuario sem permissao no host
- host sem credencial padrao valida
- bastion efetivo indisponivel
- falha de conexao SSH no host final
- politica bloqueou a sessao
- timeout de autenticacao
- timeout de inatividade

## Prioridade sugerida
### Primeiro corte
- servidor SSH Gateway escutando porta configuravel
- autenticacao NodeAccess com usuario/senha
- MFA interativo
- modo gerenciado auditavel com destino informado no usuario/comando
- resolucao de host cadastrado por IP/hostname/alias
- autorizacao igual ao acesso web
- conexao ao host final usando credencial padrao cadastrada
- sessao auditavel com metadados e gravacao de terminal interativo
- mensagens de erro claras

### Segundo corte
- utilitario `sshs` ao conectar direto no gateway
- execucao remota auditavel
- autenticacao por chave SSH no NodeAccess Gateway
- exemplos gerados na interface por host
- politicas iniciais de bloqueio de comandos
- `ProxyCommand` em modo tunel com limitacoes explicitas, se fizer sentido

### Depois
- SCP/SFTP com politicas especificas
- `ProxyCommand` protocol-aware com auditoria completa, se for tecnicamente viavel
- certificado SSH para autenticar no gateway
- override de porta/configuracao por tenant, se necessario
- selecao avancada de credencial quando houver mais de uma credencial no host
- integracao com CLI para gerar `~/.ssh/config`

## Arquivos provaveis
- `apps/backend/src/modules/ssh-gateway/*` - servidor SSH Gateway e autenticacao
- `apps/backend/src/modules/ssh/*` - reutilizacao do fluxo de conexao/auditoria
- `apps/backend/src/modules/hosts/*` - resolucao e permissao de hosts
- `apps/backend/src/modules/bastions/*` - resolucao de bastion efetivo
- `apps/backend/prisma/schema.prisma` - configuracao do gateway e sessoes se necessario
- `apps/frontend/src/views/admin/*` - configuracao administrativa do ProxySSH
- `apps/frontend/src/views/HostsView.vue` - exemplos de conexao por host, se aplicavel
- `packages/shared/src/schemas/*` - schemas de configuracao e validacao

## Fora do escopo inicial
- substituir SSH CA
- permitir acesso a IPs nao cadastrados
- expor senha/PEM do host final ao cliente
- importar automaticamente `~/.ssh/config`
- multi-hop arbitrario alem do bastion efetivo ja modelado
- politicas completas de SCP/SFTP no primeiro corte

## Questoes ainda abertas
- nome final da funcionalidade na UI: `ProxySSH`, `SSH Gateway` ou `Gateway SSH`
- se autenticacao por chave SSH no gateway entra no segundo corte ou fica para depois
- se execucao remota deve entrar no primeiro corte junto com shell interativo
- como representar na UI quando SCP/SFTP estiverem desabilitados por politica
