# Laboratórios Docker de degustação (operador)

Este serviço separado implementa o contrato HTTPS de `HttpTrialProvisioner`.
Não altera usuários, tenants ou hosts da aplicação. Só cria/remove recursos Docker
com UUID e label `io.nodeaccess.trial` correspondentes ao inventário privado.
A flag da instalação continua controlando somente novos cadastros públicos.

**Estado: implementação local; implantação condicionada à homologação real de
SSH, SFTP, isolamento, reinício e rollback no ambiente alvo.** Não executar no VPS
antes de backup de banco, imagens, configuração e regras de firewall atuais.

## Limites e confiança

- Por padrão um host por trial, no máximo dois trials simultâneos; perfil `alpine-ssh-v1`,
  `machineCount=1`, `maxSessions` de 1 a 2. Memória 128 MiB (sem swap), CPU 0,25,
  64 processos, 256 descritores. Planejado para VPS de 2 CPU/3,6 GiB com produção.
- SSH/SFTP na porta 2222, usuário `demo` sem sudo; senha e chave de host exclusivas.
  O daemon inicia como root com somente SETUID, SETGID e SYS_CHROOT para autenticar
  por senha e executar privsep; a sessão é não-root e sem capabilities.
- Capabilities restantes removidas, `no-new-privileges`, root filesystem somente
  leitura, tmpfs limitados para `/etc`, `/run`, `/tmp`, `/home/demo`; sem bind mounts,
  Docker socket, portas publicadas ou dispositivos adicionados. Dados de laboratório
  são descartáveis e o conteúdo tmpfs desaparece ao parar/reiniciar o container.
- Forwarding TCP, agente, X11, túnel, root login e user rc desabilitados no SSH.
- Rede interna /28 por UUID: gateway SSH `.2`, API/SFTP `.3`, hosts a partir de `.4` (relativos
  à sub-rede alocada). Gateway e API já existentes são conectados apenas a essa
  rede adicional. Não se muda a rede de produção. IPs não colidem com redes Docker
  existentes nem com alocações persistidas. O CIDR precisa ser reservado pelo operador
  e não colidir com rotas externas/VPN/rede física (verificação operacional obrigatória).
- IPv6 desabilitado; DNS upstream do container aponta para seu loopback. Filtros
  DOCKER-USER permitem somente controles -> host:2222 e respostas ESTABLISHED;
  bloqueiam o restante da origem/destino da sub-rede. INPUT bloqueia origem lab
  para host; OUTPUT bloqueia host para lab. Nenhuma policy global é substituída.
- Mesmo kernel do VPS: containers **não equivalem ao isolamento de VMs**. Falhas de
  kernel/runtime podem afetar produção. Este template não é indicado para execução
  irrestrita de código hostil. Serviço operador tem poder de Docker/root e seu token
  não pode ser exposto ao navegador nem ao ambiente de demonstração.

A quantidade pode crescer por PUT no mesmo UUID, preservando IPs, senhas e chaves
das máquinas existentes. Redução retorna HTTP 409 sem apagar máquinas. Falhas na
ampliação mantêm inventário reservado e permitem retry; DELETE remove todas.
`maxMachinesPerTrial` aceita 1 a 10 e `maxTotalMachines` limita o total reservado
(inclui provisões incompletas). Os defaults 1/2 preservam o orçamento do VPS; elevar
limites exige análise de capacidade. O cadastro de hosts externos pelo usuário é
regra separada da aplicação, não altera imagens/redes desse serviço.

## Preparação e execução

Requer Linux com Docker Engine usando backend iptables, cadeia DOCKER-USER e
`net.bridge.bridge-nf-call-iptables=1`. O preflight não habilita sysctls nem muda
policies automaticamente. Imagem, SSH keygen, Node 24, iptables e sysctl devem existir.

```sh
docker build -t nodeaccess-trial-ssh:2.1.0 scripts/trial-lab
node scripts/trial-lab/provider.mjs /etc/nodeaccess-trial/provider.json
```

Configuração JSON root:root 0600; diretório de estado root:root 0700:

```json
{
  "bind": "127.0.0.1",
  "port": 9443,
  "token": "SUBSTITUIR_POR_SEGREDO_ALEATORIO_DE_32_BYTES_OU_MAIS",
  "tlsKey": "/etc/nodeaccess-trial/server.key",
  "tlsCert": "/etc/nodeaccess-trial/server.crt",
  "stateDir": "/var/lib/nodeaccess-trial",
  "image": "nodeaccess-trial-ssh:2.1.0",
  "controls": ["NOME_CONTAINER_GATEWAY", "NOME_CONTAINER_API"],
  "networkCidr": "10.207.68.0/24",
  "maxActiveTrials": 2,
  "maxMachinesPerTrial": 1,
  "maxTotalMachines": 2
}
```

Bind somente loopback. O operador deve publicar acesso HTTPS privado para API/gateway
por proxy com ACL de rede, sem tornar esse endpoint público. CA própria precisa ser
confiada pelo processo Node cliente via `NODE_EXTRA_CA_CERTS`; nunca desligar validação
TLS. SAN do certificado deve corresponder ao hostname configurado. A implantação do
proxy/ACL e confiança da CA pertencem ao runbook do ambiente e precisam ser testadas.
Não colocar segredos em argumentos, logs ou Git. Não usar esta configuração exemplo
sem substituir todos os caminhos/nomes/segredos.

Executar uma única instância pelo comando CLI acima, que adquire `flock` exclusivo
no mesmo processo antes do servidor. O kernel libera o lock após crash/SIGKILL.
Não remover o arquivo `.instance.lock` nem usar o argumento interno `--locked`
para iniciar manualmente, pois isso contorna a exclusão do entrypoint. Persistir/guardar com acesso restrito o inventário,
que contém credenciais de labs ativos. Escrita de estado usa rename+fsync; DELETE
persiste tombstone antes da remoção e apaga credenciais após confirmação. PUT de UUID
removido nunca recria o laboratório. Erro de inspeção Docker não significa ausência.

Sem política automática de restart nos labs: após reboot, PUT do ciclo de vida
revalida firewall, propriedade e controles atuais antes de iniciar o container.
Atualização que recrie gateway/API precisa preservar seus nomes configurados; PUT
reconecta os containers novos e valida IPs. Não iniciar labs manualmente fora do
provider. Alterações externas de firewall/runtime exigem suspender os labs antes.

## Homologação e rollback

Testes unitários sem mutações de Docker/firewall:

```sh
node --test scripts/trial-lab/provider.test.mjs
```

A homologação real separada deve comprovar SSH e SFTP por ambos controles, quotas,
usuário sem root/capabilities, escrita somente nos tmpfs, ausência de Docker socket,
bloqueio de `/proc/1/root` privilegiado, acesso negado ao host, a outro trial, à
produção e à Internet (incluindo DNS externo), reconexão após recriar controles,
resiliência a falha entre create/start/configure e DELETE concorrente/repetido.

Antes do rollback da aplicação: fechar novos cadastros, revogar/remover labs pelo
serviço e confirmar ausência de containers/redes por UUID. Desligar a flag sozinha
não remove labs. DELETE só apaga regras com match/comentário exatos e recursos de
propriedade comprovada; endpoint estranho na rede causa erro, nunca remoção cega.
Guardar tombstones para não ressuscitar UUIDs em retries atrasados. Não restaurar
inventário antigo sem reconciliar Docker e lifecycle do banco. Não remover cadeias
DOCKER-USER/INPUT/OUTPUT nem aplicar flush global para rollback.
