# Operação da degustação e recuperação da instalação

## Estado e limites

A degustação é uma capacidade opcional da mesma instalação. A flag de cadastro
não converte usuários/tenants existentes nem altera a criação administrativa
normal. Somente o onboarding público aplica o perfil de trial. Desligar inscrições
não encerra o ciclo de vida dos trials existentes nem remove suas restrições.

O perfil, quotas e template são configurados pela Plataforma. O laboratório deve
usar máquinas e credenciais exclusivas, com isolamento de rede comprovado contra
outros trials, produção e controle. O provisionador externo e o envio de e-mail
precisam estar configurados e homologados antes de abrir inscrições.

Este guia descreve ferramentas operacionais. A presença delas no pacote não
comprova homologação do provedor, conformidade jurídica, backup remoto ou restore.
Resultados efetivamente executados ficam no registro da frente NA-0068.

## Perfil completo (NA-0074)

`experience: full` habilita a experiência normal do tenant dentro das quotas;
ausência do campo ou `guided` preserva o perfil restrito anterior. O proprietário
recebe administração apenas do tenant, nunca da plataforma. `features` e
`integrations` permitem desabilitar capacidades específicas; suas configurações
e credenciais continuam pertencendo ao tenant. O perfil completo habilita MCP, IA
e auditoria nesse tenant mesmo quando as flags gerais estão desligadas, respeitando
exclusões explícitas no perfil e a licença. As flags e filas dos tenants normais
permanecem inalteradas. Serviços externos continuam exigindo configuração e
disponibilidade próprias; o gateway SSH nativo depende do listener da instalação.

O padrão novo é um host de demonstração automático, total de quatro hosts (três
próprios), três usuários, duas sessões simultâneas, sete dias e aviso destacado
nas últimas 24 horas. Todos esses limites são configuráveis pela plataforma.
A criação de usuários considera convites pendentes; criação/importação de hosts
considera reservas do provisionador. Hosts gerenciados não podem ter destino,
credenciais ou exclusão alterados pelas rotas normais nem por operações em massa.

`maxAiRequests` (padrão 100) limita requisições de geração durante todo o teste,
inclusive tentativas de provedores; `maxAiConcurrentRequests` (padrão 1) limita
requisições simultâneas. O contador persiste no snapshot e não é reiniciado pela
edição de limites mensais do tenant. Não representa medição ou orçamento de tokens.
Integrações externas exigem credenciais próprias e HTTPS; LDAP exige TLS validado.
O app OAuth pode ser infraestrutura compartilhada, mas os tokens de acesso e os
recursos autorizados continuam separados por tenant. O perfil não fornece créditos
pagos de IA nem acesso a recursos contratados por outros clientes.

Destinos diretos do teste aceitam IPv4 público permitido; metadata, controle e
outros laboratórios são negados. SSH e túneis permitem redes privadas por rotas
exclusivas de agentes do próprio tenant, sem fallback direto. O SFTP independente,
o gateway gráfico e as automações diretas não ganham uma rota de agente implícita.
Loopback de túnel significa o host SSH remoto; listeners no servidor permanecem
locais. Expiração fecha transportes antes de depender de persistência no banco.

Conversão de um teste existente é explícita via `TrialService.promoteToFull`,
com IDs conferidos e ator ativo da plataforma. Preserva tenant, hosts, senha,
MFA e vencimento; altera papel/licença e incrementa a versão da sessão. O usuário
precisa entrar novamente para receber seu novo papel. Contas normais nunca são
convertidas por coincidência de e-mail ou por habilitar a flag de cadastro.

Após liberar o perfil completo, a retenção antiga não cobre os novos domínios.
Não executar rollback automático para uma release com limpeza limitada depois
da promoção; preferir correção adiante ou recuperação explicitamente revisada.
Backups anteriores não podem substituir gravações feitas após a reabertura.

## Configurar em instalação nova ou existente

1. Preservar o `.env` existente; não substituí-lo pelo exemplo de uma nova release.
2. Definir `TRIAL_PUBLIC_URL` com a URL HTTPS do frontend, `TRIAL_PROVISIONER_URL`
   e token interno, e `TRIAL_SMTP_HOST`, `TRIAL_SMTP_PORT` (padrão 587),
   `TRIAL_SMTP_USER`, `TRIAL_SMTP_PASSWORD` e `TRIAL_SMTP_FROM`. Usar TLS no SMTP.
3. Manter `TRIAL_REGISTRATION_ENABLED=false` enquanto configura perfil,
   preferências/aviso de privacidade, remetente e laboratório na Plataforma.
4. Validar o fluxo de ponta a ponta em instalação descartável com os mesmos
   artefatos: contas normais, cadastro, confirmação, MFA, SSH/SFTP, vencimento,
   encerramento, isolamento e destruição dos recursos.
5. Habilitar a flag e aplicar a configuração na janela de manutenção:

```bash
node scripts/deploy/configure-trial.mjs --env-file /opt/nodeaccess/shared/.env --enable
```

O utilitário exige Node.js com `util.parseEnv` (20.12 ou superior; runtime do projeto
segue seu próprio requisito em `package.json`). Ele valida os campos locais,
altera somente a flag e conserva uma cópia privada `.trial-<id>.bak` ao lado do
arquivo real. Symlinks de releases para o `.env` compartilhado são preservados.
Não testa acesso à rede, provisionador ou banco; a prontidão também deve ser
verificada pelo backend. O comando não reinicia processos, não grava no banco e
não modifica contas. Protege operações concorrentes com um diretório de lock.

Para consultar ou fechar inscrições:

```bash
node scripts/deploy/configure-trial.mjs --env-file /opt/nodeaccess/shared/.env --check
node scripts/deploy/configure-trial.mjs --env-file /opt/nodeaccess/shared/.env --disable
```

`--disable` funciona mesmo quando o provedor/e-mail estiver indisponível. Depois
recriar a API usando o compose/projeto originais e a configuração já homologada;
`docker compose restart` sozinho não recarrega variáveis de ambiente. Essa aplicação
pode interromper requisições: usar janela informada e executar smoke check. Não
reiniciar o gateway desnecessariamente para uma flag usada apenas pelo cadastro.

O operador pode editar a flag diretamente no `.env` durante a instalação; o padrão
é `false`. Não exportar a configuração inteira no terminal, tickets ou screenshots.
Nenhuma variável de infraestrutura/SMTP deve ser exposta como `VITE_*`.

Se houver lock abandonado após queda, confirmar que não há processo configurando
trial antes de removê-lo. Um erro nunca autoriza apagar `.env` ou usar um exemplo
sobre o arquivo de produção. Backups de configuração contêm segredos e seguem
permissões, retenção e acesso restritos.

## Backup obrigatório antes de 2.1.0

Antes da implantação remota, registrar janela, release atual, compose/projeto,
volumes, serviços externos e ponto de retorno. Preservar acesso administrativo de
recuperação. Coordenar suspensão de gravações durante o backup final e a troca;
o dump transacional não torna banco e arquivos simultaneamente consistentes se
continuarem sendo alterados. Não parar produção sem a janela combinada.

Executar a ferramenta nova apontando para a release **atualmente em uso**, antes
de promover a nova release. O diretório de saída deve ser absoluto e ainda não
existir. Espaço livre deve comportar banco, arquivos e imagens.

```bash
DEPLOYMENT_ROOT=/opt/nodeaccess/current \
ENV_FILE=/opt/nodeaccess/shared/.env \
COMPOSE_FILE=/opt/nodeaccess/current/docker-compose.prod.yml \
COMPOSE_PROJECT_NAME=nodeaccess \
bash /caminho/release-2.1.0/scripts/backup/backup-release-state.sh \
  /opt/nodeaccess/backups/pre-2.1.0-AAAAmmdd-HHMMSS
```

A ferramenta:

- conserva IDs das imagens realmente vinculadas aos containers e gera
  `images.tar.gz`; não assume que tags ainda apontem à mesma imagem;
- grava `compose.rollback-images.yml` com IDs fixos e `pull_policy: never`;
- copia `.env`, compose, versão e configurações locais disponíveis (incluindo
  certificados e chave SSH no caminho padrão) em diretório privado;
- chama o backup agregado existente para MySQL, auditoria e avatares, com falhas
  obrigatórias, e valida checksums;
- só cria `BACKUP-COMPLETE` depois de todas as etapas. Isso comprova coleta e
  integridade local, **não comprova restaurabilidade**.

Arquivos/composes adicionais, overrides TLS/HA, chave SSH em caminho personalizado,
configuração do proxy externo (sites Clavinci/NodeAccess), certificados fora da
release, segredos externos e volumes customizados devem ser inventariados e
preservados separadamente. O script não captura a configuração inteira do host
nem todos os serviços externos. Não limpar imagens antigas ou volumes neste deploy.
Fazer também cópia do conjunto fora do servidor, protegida conforme a política.

## Ensaio e retorno à versão anterior

1. Conferir `BACKUP-COMPLETE`, checksums e arquivos obrigatórios. Executar restore
   em MySQL/volumes descartáveis, jamais sobre o banco atual para testar. Usar os
   harnesses de restore existentes em `tools/deploy/restore-*-isolated-harness.sh`.
2. Carregar `images.tar.gz` no host de ensaio com `docker image load`, aplicar a
   release antiga e o overlay de imagens salvas. Validar login, MFA, tenant,
   credenciais cifradas, SSH/SFTP, auditoria e avatares com dados de ensaio.
3. Só depois aplicar migrations/upgrade 2.1.0 pelo fluxo de release existente.
   Revalidar contas normais antes de abrir novos cadastros de trial.
4. Para rollback real, primeiro bloquear novas inscrições e acesso aos laboratórios,
   revogar sessões e tratar trials ativos antes de executar uma versão sem suporte
   a trial. Desligar apenas a flag não remove os metadados nem garante esse bloqueio.
5. Parar gravações na janela de recuperação e preservar também o estado que falhou
   para análise. Restaurar banco/volumes/configuração coerentes com o ponto anterior,
   usando `restore-mysql.sh`, `restore-session-audit.sh` e `restore-user-avatars.sh`.
   Restaurar o banco perde gravações posteriores: reconciliar esse intervalo e obter
   a decisão operacional antes de executar. Não presumir downgrade de schema seguro.
6. Promover a release anterior com o fluxo `switch-release.sh` e subir o compose
   original com o overlay `compose.rollback-images.yml`, sem pull/migrations novas.
   Não combinar arquivos relativos do backup com um diretório de projeto diferente
   sem conferir mounts e rede. Verificar smoke check e os acessos existentes.
7. Recursos de laboratório criados depois do backup continuam no provedor: conservar
   o inventário atual antes do restore e reconciliá-los pela propriedade registrada.
   Nunca apagar recursos de produção por nomes semelhantes aos de trial.

## Evidências de instalação

Testes de configuração e falhas simuladas:

```bash
node --test tools/deploy/trial-installation.test.mjs
bash -n scripts/backup/backup-release-state.sh scripts/release/build-release.sh
```

Esses testes usam arquivos e Docker simulado. A restauração real, o ambiente remoto
e a aplicação efetiva de 2.1.0 são gates separados e não podem ser inferidos deles.

## Quantidades e hosts próprios

O perfil da Plataforma define os limites aplicados pelo servidor:

- `machineCount`: quantidade inicial de máquinas de demonstração, de 1 a 10.
- `maxMachines`: quantidade máxima solicitável, entre a inicial e `maxHosts`.
  Se ausente em um perfil antigo, vale a quantidade inicial.
- `allowCustomHosts`: habilita o cadastro de hosts pessoais; ausente significa
  desabilitado. Quando habilitado, `maxCustomHosts` deve ser maior que zero.
- `maxCustomHosts`: quota de hosts pessoais, de 0 a 10 e nunca superior a `maxHosts`.
- `maxHosts`: limite combinado de máquinas de demonstração e hosts pessoais,
  de 1 a 10. Pedidos de expansão reservam a quantidade desejada antes da criação,
  impedindo que um cadastro concorrente ultrapasse esse limite.

A configuração do provisionador tem limites próprios, como `maxMachinesPerTrial`
e `maxTotalMachines`. Não elevar o perfil acima da capacidade operacional disponível.
A expansão conserva as máquinas existentes, suas credenciais e o prazo do trial;
falhas ficam pendentes para nova tentativa, sem encerrar o laboratório em uso.

Hosts próprios aceitam somente IPv4 público literal, conexão SSH direta e
credenciais próprias por senha ou PEM. Não há resolução de hostname, criação de
VPN ou acesso a endereços privados, locais, reservados ou ao plano de controle.
Configure `TRIAL_PROTECTED_ADDRESSES` com os IPv4 do VPS, proxies e demais serviços
do plano de controle, separados por vírgula, incluindo os endereços públicos.
A lista precisa estar preenchida e conter somente IPv4 válidos; configuração
incompleta não torna seguro um endereço público omitido. Cadastro e edição ficam
indisponíveis se a lista estiver ausente ou inválida. Homologue os bloqueios antes
de habilitar `allowCustomHosts`.

Credenciais são cifradas e a ACL do host pessoal é individual. Hosts de demonstração
mantêm permissões explícitas por host, sem conceder acesso aos hosts pessoais de
outro participante. A exclusão ou troca de IP/porta revoga conexões em andamento;
o fluxo de alteração também exige encerrar as sessões ativas. Essas regras não
convertem nem alteram o perfil de tenants normais.

A validação de PEM ocorre fora do processo da API, com até dois processos filhos
simultâneos por processo da API e prazo de dois segundos, seguido de SIGKILL em
caso de timeout. A chave tem limite de 64 KiB; a senha da chave aceita até 4096
caracteres e 16 KiB em UTF-8. O filho limita a entrada serializada a 256 KiB e o
heap antigo do JavaScript a 32 MiB; esse último valor não representa um limite de
memória total do processo. Segredos seguem por stdin, nunca por argumentos ou
variáveis de ambiente. Saturação e timeout retornam indisponibilidade temporária,
permitindo nova tentativa sem bloquear o event loop da API.

## Contrato do provisionador de laboratório

`HttpTrialProvisioner` é o cliente da aplicação. O serviço que cria os laboratórios
é implantado separadamente e precisa ser homologado. O repositório inclui um
[provisionador Docker para operação administrativa](../scripts/trial-lab/README.md),
adequado ao piloto no VPS atual sem KVM. A aplicação não recebe o Docker socket;
o serviço separado executa as operações de infraestrutura.

Os laboratórios Docker compartilham o kernel do host e não equivalem ao isolamento
de VMs. O template executa a sessão SSH como usuário não-root, sem sudo ou
capabilities. O daemon SSH usa root com somente SETUID, SETGID e SYS_CHROOT,
necessários à autenticação e separação de privilégios. São aplicados filesystem
somente leitura, tmpfs limitados, restrições de CPU/memória/processos e regras de
rede específicas por trial. Os defaults do operador são dois trials, uma máquina
por trial e duas máquinas no total; os limites precisam corresponder ao perfil
da aplicação e à capacidade do VPS.

O retorno `isolated: true` é uma declaração do serviço, não uma prova de isolamento.
A homologação deve testar acesso entre trials, ao host, ao plano de controle,
às redes privadas de produção e a destinos externos proibidos. Também deve testar
DNS, IPv6, SSH/SFTP pelos controles autorizados, reinício, recriação dos controles
e recuperação de provisionamento ou exclusão interrompidos.

O endpoint HTTPS configurado recebe `PUT /v1/labs/:trialId` com Bearer interno e
`idempotency-key` igual ao UUID. O corpo contém `templateId`, `machineCount`,
`networkCidr` e `maxSessions`; templates são definidos pelo operador. Responder
JSON em até 15 segundos e 32 KiB, sem redirects:

- `trialId`: UUID solicitado; `isolated`: true.
- `state`: `preparing` enquanto o serviço provisiona ou `ready` após validação.
- `hosts`: lista com `name`, IPv4, `port`, `sshUser`, senha exclusiva com pelo menos
  20 caracteres e fingerprint `SHA256:` da chave SSH. Não registrar esse corpo em
  logs. Em `ready`, a quantidade deve corresponder ao perfil; IPs devem ser únicos,
  pertencer à rede permitida e não coincidir com hosts já cadastrados.

Repetir PUT com a mesma quantidade deve retornar o mesmo laboratório, sem duplicar
máquinas. Aumentar `machineCount` adiciona somente as máquinas solicitadas,
preservando IPs, credenciais e chaves existentes; reduzir a quantidade retorna
HTTP 409 sem apagar recursos. O serviço mantém inventário durável por UUID e
reconcilia criação parcial após falha. Trials ACTIVE também são reconciliados
quando não há expansão pendente, para recuperar conexões de rede após reinício ou
recriação da API/gateway. CPU, memória, disco, firewall e quotas globais são limites
do template e do provisionador; o perfil da aplicação não os configura.

`DELETE /v1/labs/:trialId` exige confirmação JSON com o mesmo UUID,
`state: removed`, `isolated: true` e `hosts: []`. Deve ser idempotente, destruir
somente recursos com propriedade comprovada e manter tombstone de cancelamento:
DELETE concorrente ou anterior ao fim de PUT impede criação tardia e elimina
recursos parciais. Um timeout não prova remoção; a aplicação mantém reconciliação
pendente e revoga acesso antes da remoção física.

Credenciais e rede do provisionador não podem ficar acessíveis aos laboratórios.
Cada trial exige destinos exclusivos, roteáveis pela API e pelo gateway autorizados,
e credenciais novas; não reutilizar
uma máquina de produção ou o host SSH do servidor como laboratório público.

## Comunicações e retenção

A fila durável envia aviso operacional de ambiente pronto e de expiração, com
antecedência configurável de 1 a 23 horas (padrão 6). Falhas de SMTP são tentadas
novamente. Uma queda depois de o SMTP aceitar a mensagem pode causar duplicata;
o envio é pelo menos uma vez, sem promessa de entrega na caixa postal. A fila não
guarda endereço, corpo ou token e é eliminada na retenção do cadastro. Trial
cancelado ou vencido não recebe aviso pendente de disponibilidade.

Marketing e pesquisa têm preferências separadas, opcionais e revogáveis; não
habilitam coleta de comandos, arquivos ou telemetria comportamental para vendas.
Avisos operacionais usam a finalidade do serviço solicitado. Documentar bases,
finalidades, destinatários e prazos no aviso de privacidade antes da abertura.
Retenção da aplicação não apaga cópias em backups, provedores ou sistemas externos:
esses destinos precisam de políticas próprias e procedimento de atendimento.

## Telefone opcional e identidade visual (NA-0072)

O telefone do cadastro é opcional e serve apenas ao contato solicitado sobre a degustação. Não autoriza marketing por telefone ou WhatsApp. É cifrado no registro de degustação e removido na rotina de retenção; não é enviado ao provedor de máquinas, às notificações nem às respostas públicas. A coluna nova é nullable e não muda cadastros anteriores. Não consultar ou exportar telefones para finalidades incompatíveis. Pedidos de correção ou exclusão seguem o canal de privacidade.

A migração deve anteceder o backend atualizado; rollback do aplicativo pode manter a coluna nullable. Preservar backup atual antes de publicar e não reutilizar snapshots anteriores à reabertura. A página mantém limites obtidos do perfil, sem embuti-los no texto comercial.

## Comunicação e ciência do encerramento (NA-0079)

O acompanhamento do cadastro apresenta atividade indeterminada durante a preparação, a partir do estado retornado pelo servidor. Não representa percentual nem prazo estimado. Falhas de consulta permitem nova tentativa sem recriar o cadastro.

E-mails de confirmação, disponibilidade e vencimento possuem apresentação HTML e alternativa texto. A apresentação não substitui a fila durável nem comprova entrega na caixa de entrada. A mensagem continua compreensível com imagens bloqueadas e não usa carregamento remoto para rastrear abertura.

Novos cadastros recebem versão do aviso de ciclo de vida em seu snapshot. A ativação exige ciência explícita do vencimento e encerramento, separada dos termos e das preferências opcionais. O evento registra a versão do aviso, o vencimento e a retenção apresentados. Cadastros legados sem marcador e contas já ativas não recebem bloqueio retroativo. Não registrar ciência em nome do usuário.

O prazo encerra o acesso e as máquinas de demonstração são removidas. A exclusão dos dados do ambiente segue a retenção configurada, contada do encerramento concluído. Máquinas externas cadastradas não são apagadas por essa rotina. Backups e exportações seguem seus próprios prazos e procedimentos.

A migração de metadata de TrialConsentEvent é aditiva e nullable. Aplicar antes do backend atualizado; um rollback do aplicativo mantém a coluna e os eventos, sem restaurar um banco anterior por conveniência. Preservar backup consistente e cópia externa verificada antes da implantação.
