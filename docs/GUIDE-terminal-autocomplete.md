# Guia do autocomplete do terminal

## O que e

O autocomplete do terminal do NodeAccess e um assistente de digitacao para
sessoes SSH. Ele reduz trabalho repetitivo, ajuda a encontrar caminhos e
apresenta comandos ou argumentos relevantes sem tirar do usuario o controle da
sessao.

Uma sugestao e sempre inserida como texto editavel. O autocomplete nao envia
`Enter`, nao executa comandos sozinho e nao altera permissoes do usuario.

O recurso e independente do assistente de IA:

| Recurso | Como funciona | Precisa de provider de IA? |
|---|---|---|
| Autocomplete padrao | Regras locais, contexto da linha, SFTP e informacoes observadas na sessao | Nao |
| Assistente de IA | Responde perguntas e pode propor comandos ou scripts para revisao | Sim |

Desativar a IA nao desativa nem degrada o autocomplete padrao.

## O que ele faz

### Completa caminhos reais do host

Ao digitar comandos que recebem arquivos ou diretorios, o NodeAccess consulta o
canal SFTP da propria sessao e sugere caminhos existentes.

Exemplos:

```text
cd /var/lo       -> cd /var/log/
vim /etc/ng      -> vim /etc/nginx.conf
tail -f /var/sy  -> tail -f /var/syslog
cp /tmp/a /var/l -> cp /tmp/a /var/lib/
```

Tambem sao tratados:

- caminhos absolutos e relativos;
- diretorio atual informado pelo shell via OSC 7;
- arquivos ocultos;
- espacos, acentos e Unicode;
- metacaracteres que precisam de escape;
- nomes iniciados por `-`, sugeridos com `./` para nao parecerem opcoes;
- comandos encadeados, pipes, `sudo`, flags e operacoes com origem e destino.

Diretorios podem ser explorados progressivamente: aceitar uma pasta mantem o
autocomplete disponivel para escolher o proximo nivel sem executar `ls`.

### Sugere comandos operacionais

O mecanismo local oferece comandos frequentes para diagnostico e operacao, por
exemplo:

- `systemctl status` e unidades com falha;
- `journalctl` por servico ou periodo;
- uso de disco, memoria, processos e portas;
- Docker, Kubernetes e Git;
- busca e manipulacao segura de arquivos.

As sugestoes contextuais mudam conforme o comando em digitacao. Depois de
`systemctl`, por exemplo, aparecem operacoes relacionadas a servicos, e nao uma
lista generica de comandos.

### Aprende entidades vistas na sessao

Quando o usuario executa comandos que listam recursos, o autocomplete pode
reaproveitar os nomes observados naquela mesma sessao:

- unidades do systemd;
- containers Docker;
- pods e namespaces Kubernetes;
- branches Git.

Exemplo:

```text
systemctl --failed
# a saida mostra nodeaccess-agent.service

systemctl restart node
# sugere nodeaccess-agent.service
```

Esse aprendizado nao executa consultas escondidas no host. Ele usa somente
saidas que o usuario ja produziu e que fazem parte da sessao auditada. O indice
e limitado e descartado ao encerrar ou reconectar a sessao.

### Prioriza o que e mais util

O ranking considera:

- correspondencia com o texto digitado;
- contexto do comando atual;
- frequencia e recencia por usuario e host;
- entidades observadas na sessao;
- tipo do recurso, como comando, arquivo, pasta ou link.

Quando o shell oferece OSC 133, apenas comandos finalizados com exit code zero
entram no aprendizado persistente. Comandos com falha nao sao promovidos.

O historico e isolado por usuario, tenant e host. Tokens, senhas, credenciais em
URLs, controles de terminal e valores potencialmente sensiveis sao recusados.

## Como usar

O popup abre junto ao cursor quando existem sugestoes relevantes.

| Acao | Controle |
|---|---|
| Abrir explicitamente | `Ctrl+Espaco` |
| Selecionar | `Seta para cima` ou `Seta para baixo` |
| Inserir | `Tab`, `Enter`, `Seta para direita` ou clique |
| Fechar | `Esc` |

`Enter` dentro do popup aceita a sugestao, mas nao executa o comando. Depois de
revisar o texto inserido, o usuario pressiona `Enter` novamente caso deseje
executa-lo.

O popup informa discretamente:

- origem da sugestao;
- arquivo, pasta, link ou comando;
- permissoes quando disponiveis;
- item recente;
- diretorio ou provider contextual.

## Como melhora o dia a dia

### Menos digitacao e menos troca de contexto

O usuario nao precisa executar `ls` repetidamente apenas para descobrir o
proximo diretorio, copiar nomes extensos ou alternar para outra tela para
consultar um comando comum.

### Menos erros operacionais

- nomes e caminhos sao obtidos do host conectado;
- espacos e caracteres especiais recebem escape;
- nomes que parecem flags sao neutralizados;
- sugestoes de caminho substituem a linha de forma integral, evitando caracteres
  orfaos no buffer remoto;
- nenhuma sugestao e executada automaticamente.

### Mais fluidez em ambientes diferentes

O modelo de entrada acompanha edicao no meio da linha, Home, End, Delete,
Backspace e atalhos comuns do readline. Se o usuario acessa o historico do shell
e o estado local deixa de ser confiavel, as sugestoes sao suspensas em vez de
tentar completar uma linha incerta.

### Continuidade durante falhas

Falha ou lentidao do SFTP nao bloqueia a digitacao. O recurso possui:

- debounce e cancelamento de consultas antigas;
- cache curto isolado por tenant, host e sessao;
- retry unico para erros transitorios;
- cache negativo curto para evitar repeticao excessiva;
- descarte de respostas de sockets antigos;
- restauracao do canal de autocomplete apos reconexao.

O terminal continua utilizavel mesmo quando nenhuma sugestao remota pode ser
obtida.

## Onde ajuda equipes tecnicas

| Equipe | Exemplos de ganho |
|---|---|
| NOC e operacao | Navegar rapidamente por logs, consultar servicos, disco, memoria, processos e portas |
| Suporte | Reduzir erros em procedimentos repetitivos e encontrar arquivos sem interromper o atendimento |
| SRE e plataforma | Reaproveitar unidades, containers e pods observados durante diagnosticos |
| DevOps | Trabalhar com Docker, Kubernetes, Git, arquivos de configuracao e pipelines de shell |
| DBA | Encontrar dumps, logs e configuracoes e montar comandos com origem e destino com menos digitacao |
| Seguranca e resposta a incidentes | Inserir consultas para revisao, preservar controle manual e evitar nomes interpretados como flags |
| Desenvolvimento | Navegar em arvores de projeto, branches e arquivos com nomes extensos ou especiais |
| Lideranca tecnica | Reduzir curva de aprendizado sem ocultar o comando final que sera executado |

O recurso ajuda profissionais experientes a operar mais rapido e oferece apoio
para usuarios menos frequentes sem transformar sugestao em autorizacao ou
automacao silenciosa.

## Configuracao e disponibilidade

O comportamento efetivo possui duas camadas:

1. o tenant precisa possuir o modulo/licenca e manter o recurso disponivel;
2. cada usuario pode decidir se deseja usar o autocomplete em seu perfil.

Se o tenant nao disponibilizar o modulo, a preferencia individual fica
indisponivel. Se o tenant disponibilizar, desativar no perfil afeta somente o
proprio usuario.

Para utilizar caminhos remotos, a sessao precisa oferecer SFTP operacional. As
sugestoes locais de comandos continuam funcionando quando o SFTP esta
indisponivel.

OSC 7 e OSC 133 sao opcionais:

- OSC 7 melhora a identificacao do diretorio atual;
- OSC 133 permite confirmar exit code e aprender apenas comandos bem-sucedidos;
- sem esses sinais, o terminal e o autocomplete continuam operacionais, mas nao
  presumem informacoes que o shell nao confirmou.

## Seguranca, privacidade e auditoria

- autocomplete nao concede permissao e nao contorna ACL;
- nenhuma sugestao executa `Enter` automaticamente;
- o provider de entidades nao roda comandos ocultos;
- segredos nao devem ser armazenados no ranking local;
- dados locais sao isolados por usuario, tenant e host;
- caches remotos sao isolados por tenant, host e sessao;
- a auditoria SSH continua registrando o fluxo efetivamente enviado ao host;
- IA e autocomplete padrao possuem entitlements e readiness independentes.

Sugestoes continuam exigindo revisao humana. Um comando sintaticamente correto
pode nao ser apropriado para o ambiente ou para a mudanca pretendida.

## Comportamento esperado em problemas

| Situacao | Comportamento esperado |
|---|---|
| SFTP lento | Digitacao continua; consulta antiga e cancelada ou expira |
| SFTP ocupado | Uma repeticao curta e realizada quando seguro |
| SFTP indisponivel | Popup remoto desaparece; comandos locais continuam |
| Queda do WebSocket | Requisicoes pendentes sao encerradas; reconexao SSH permanece explicita |
| Resposta atrasada da sessao anterior | Resposta e ignorada |
| Historico de shell torna a linha incerta | Sugestoes sao suspensas ate o modelo voltar a um estado confiavel |
| Comando termina com erro | Nao entra no aprendizado persistente |
| Integracao de IA indisponivel | Autocomplete padrao continua funcionando |

## Validacao rapida

1. confirme que o tenant possui `Terminal autocomplete`;
2. acesse o perfil e deixe a preferencia habilitada;
3. abra uma sessao SSH com SFTP disponivel;
4. digite `cd /var/lo` e aceite `cd /var/log/` com `Tab`;
5. digite `systemctl ` para conferir sugestoes contextuais;
6. pressione `Ctrl+Espaco` para abrir a lista explicitamente;
7. desative a preferencia no perfil e confirme que o terminal continua normal,
   sem o popup.

## Limites conhecidos

- o autocomplete nao substitui validacao tecnica nem policy de mudanca;
- aprendizado por exit code depende de OSC 133 fornecido pelo shell;
- entidades dinamicas so aparecem depois que uma saida compativel foi observada;
- hosts sem SFTP recebem apenas sugestoes que nao dependem de caminhos remotos;
- shells com line editing muito customizado podem reduzir a precisao do modelo
  local; nesses casos o recurso prefere suspender a sugestao.

## Referencias internas

- regras de produto: [`PRD-terminal-autocomplete-lite.md`](PRD-terminal-autocomplete-lite.md);
- autocomplete e IA: [`PRD-ai-platform-lite.md`](PRD-ai-platform-lite.md);
- evolucao do terminal: [`PRD-terminal-adoption-roadmap-lite.md`](PRD-terminal-adoption-roadmap-lite.md).
