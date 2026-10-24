# NA-0061 — Registro da implementação

## Pedido e objetivo

Inspecionar a instalação antiga do NodeAccess, confirmar tentativas inválidas no banco e configurar Fail2ban. O usuário confirmou acesso SSH administrativo como root na porta 2251 e destacou que o Nginx atende também outro site.

## Implementação

Base SHA: `66444a9dd4c167453004bb6089278548bdd2c0d9`.

Instalação inspecionada: NodeAccess 2.0.3, Rocky Linux 8.10, Fail2ban 1.0.2, Docker e Nginx. A auditoria inicial agregou 176959 LOGIN_FAILED, 80462 LOGIN_BLOCKED e 17 MFA_FAILED. Consulta posterior restrita a `userAgent=native-ssh-gateway` encontrou 176953 LOGIN_FAILED e 80477 LOGIN_BLOCKED; são fotografias de momentos diferentes, com eventos novos durante a investigação. A amostra de 1000 falhas continha 107 origens distintas, sem IP privado ou ausente. Os logs HTTP não explicavam esse volume; o código instalado e os eventos do gateway confirmaram entrada pelo SSH nativo em TCP 2222.

Arquivos remotos criados:

- `/usr/local/sbin/nodeaccess-f2b-collect`: consulta somente eventos malsucedidos do gateway, exporta data UTC e IP público IPv4, sem nomes ou credenciais; cursor persistente por ID e limite superior capturado antes da consulta. Lote máximo de 10000 eventos. Primeira execução considera somente os últimos 10 minutos.
- `/etc/systemd/system/nodeaccess-f2b-collect.{service,timer}`: coleta aproximadamente a cada 15 segundos após concluir a execução anterior, usando as credenciais já disponíveis no container API, sem copiá-las.
- `/etc/fail2ban/filter.d/nodeaccess-native-ssh.conf` e `/etc/fail2ban/jail.d/nodeaccess-native-ssh.local`: 5 eventos/10 minutos, banimento de 7 dias (inicialmente 24 horas; ampliado a pedido), DROP apenas TCP 2222 na cadeia DOCKER-USER.
- `/etc/logrotate.d/nodeaccess-fail2ban`: rotação diária, 7 arquivos, compressão retardada.
- Estado em `/var/lib/nodeaccess-fail2ban/cursor`; log protegido em `/var/log/nodeaccess-fail2ban/auth.log`.

Nginx, sites, aplicação e schema do banco não foram alterados. Jail `sshd` preservada. Cópias revisáveis dos artefatos ficam em `artifacts/`; o instalador é evidência da execução inicial, não deve ser reexecutado sobre a instalação ativa.

## Validação

- Ran: conexão SSH administrativa em 2251. Tentativas iniciais em 22 falharam antes da autenticação.
- Ran: consultas agregadas via Prisma, inspeção dos proxies, código instalado e cadeia Docker.
- Ran: `fail2ban-regex` sobre os 40 eventos inicialmente exportados: 40 correspondências, 40 datas reconhecidas, nenhuma linha perdida.
- Ran: `fail2ban-client -t`: configuração válida; reload concluído.
- Ran: serviço coletor com Result=success e ExecMainStatus=0; timer habilitado e ativo; cursor monotônico. Compatibilidade corrigida para Python 3.6 antes de ativar a jail.
- Ran: cinco eventos sintéticos com IP reservado geraram bloqueio automático e regra DROP; desbloqueio confirmado.
- Ran: teste externo controlado com a própria origem da manutenção: cinco eventos geraram bloqueio TCP 2222; firewall contou seis pacotes descartados; SSH 2251 permaneceu acessível. Bloqueio de teste removido em finally; banner SSH do gateway novamente acessível.
- Ran: HTTPS local com SNI/certificado para os três virtual hosts: HTTP 200 em todos.
- Ran: `logrotate -d` validou a configuração sem forçar rotação.
- Observado: um IP real bloqueado além das origens temporárias de teste, removidas ao final. Isso comprova detecção operacional; os seis pacotes citados são do teste controlado, não uma métrica de ataques.
- Skipped: reinício de Docker/host/firewalld em produção e testes de UI/PTY, pois não houve alteração na aplicação ou terminal.

## Recuperação

Backup remoto prévio: `/root/nodeaccess-fail2ban-backup-20261022/`, com configuração do Fail2ban e snapshot de iptables. Não restaurar indiscriminadamente o snapshot sobre regras Docker atuais.

Para suspender esta proteção: `systemctl disable --now nodeaccess-f2b-collect.timer`, `systemctl stop nodeaccess-f2b-collect.service` e `fail2ban-client stop nodeaccess-native-ssh`. Para mantê-la desabilitada após reload/reboot, definir `enabled = false` no arquivo desta jail. Isso remove suas regras sem desabilitar a jail administrativa. Nenhuma migração ou restauração de banco necessária.

Consulta operacional: `fail2ban-client status nodeaccess-native-ssh`. Desbloqueio individual: `fail2ban-client set nodeaccess-native-ssh unbanip IP`. Verificar coletor com `systemctl status nodeaccess-f2b-collect.timer` e `journalctl -u nodeaccess-f2b-collect.service`.

## Pendências

- Escopo IPv4 corresponde à publicação atual do Docker; IPv6 não está publicado no gateway e ip6tables é incompatível com o kernel atual. Rever se a publicação mudar.
- Coleta depende do nome atual do container API e do schema AuthLog; rever durante upgrade/recriação com mudança de nome.
- Revalidar encadeamento DOCKER-USER após manutenção de Docker/firewalld. A ação padrão verifica a regra ao aplicar novos bans, mas reinício desses serviços não foi ensaiado em produção.
- Pequena latência de coleta é esperada (aproximadamente 15 segundos mais consulta/processamento). IP compartilhado/NAT pode bloquear outros usuários da mesma origem por 7 dias.
- Não foram bloqueados retroativamente todos os IPs do histórico. Proteção implantada cobre os eventos do gateway; não adiciona jail de autenticação web.
- Sem commit/publicação. Alterações locais preexistentes preservadas; registro adicionado no checkout atual sem trocar sua branch.

## Diário de interações

### 2026-10-22T20:04:05-03:00 — Acesso e esclarecimento de infraestrutura

Usuário autorizou inspeção e configuração remota, confirmou usuário root e corrigiu porta SSH para 2251. A conexão na porta informada funcionou. Informação de Nginx compartilhado determinou a necessidade de limitar o bloqueio ao serviço efetivamente atacado.

### 2026-10-22T20:13:00-03:00 — Diagnóstico, implantação e validação

Auditoria e código remoto identificaram gateway SSH nativo como origem das falhas. Instalados coletor, timer, filtro, jail e rotação, com backup prévio. Validado bloqueio automático e real na rede, desbloqueio, preservação do SSH administrativo e HTTP 200 dos sites. Próximo passo operacional: acompanhar jail e coletor e revalidar após mudanças de infraestrutura; nenhuma ação adicional do usuário necessária para ativação.

### 2026-10-23T00:03:36-03:00 — Ampliação do bloqueio para uma semana

Usuário solicitou sete dias para esses ataques. Alterado `bantime` para 604800 somente na jail remota `nodeaccess-native-ssh`, preservando 5 falhas/600 segundos e TCP 2222. Dois bans ativos foram removidos e reaplicados imediatamente para iniciar o novo prazo de sete dias. Backup anterior em `/root/nodeaccess-fail2ban-backup-20261022/native-ssh-before-7days.local`.

Ran: teste de configuração e reload exclusivo da jail; leitura de bantime efetivo; consulta somente leitura à tabela `bips` confirmou 604800 segundos nos dois bans renovados; regras DROP individuais e encadeamento DOCKER-USER confirmados; Fail2ban, timer e Nginx ativos. Inspeção do código do Fail2ban 1.0.2 confirmou que a limpeza de `bips` considera o prazo do ban, sem necessidade de alterar retenção global. Não foi reiniciado o servidor. Cópia temporária da chave esvaziada. Artefato local atualizado para refletir sete dias; nenhuma alteração operacional no ambiente de desenvolvimento. Próximo passo: acompanhamento normal da jail.

### 2026-10-23T09:07:36-03:00 — Avaliação da origem no histórico
Pedido: avaliar a ambiguidade entre entrada pelo site e gateway e a proposta de Origem do acesso. Inspeção estática local confirmou: native-ssh-gateway.service.ts grava marcador fixo e IP do cliente; log.service.ts entrega ambos; LogsView.vue exibe IP, mas esconde userAgent no tooltip do usuário. auth.controller.ts recebe User-Agent do cliente HTTP, portanto inferência histórica não é prova definitiva do canal. Recomendada coluna independente do resultado, com Gateway SSH, Interface web quando identificável e Não identificada, mantendo IP e detalhe técnico; para novos registros, campo explícito preenchido pelo servidor é mais confiável. Base local 66444a9dd4c167453004bb6089278548bdd2c0d9. Ran: leitura de código e registro anterior NA-0061; nenhum teste de execução, acesso remoto ou consulta atual ao banco. Sem alteração de produto, autenticação ou bloqueios nesta interação. Próximo passo: implementar classificação/apresentação se solicitado, com testes de registros legados e ambíguos.
