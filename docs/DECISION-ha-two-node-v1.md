# Decisão arquitetural - HA de dois nós

- Data: 2026-07-29
- Versão de fechamento: 2.0.28
- Status: aceito para homologação

## Decisão

O HA entregue nesta fase suporta formalmente dois nós de dados:

- exatamente um `PRIMARY`;
- no máximo um `STANDBY` operacional;
- uma única VIP;
- um único nó com direito de escrita;
- witness/fencing externo obrigatório para failover emergencial seguro.

A máquina de estados e o modelo de dados devem continuar preparados para
evolução, mas três ou mais nós de dados não são suportados nesta versão.

## Escopo da entrega atual

- replicação MySQL por GTID;
- réplica Redis;
- sincronização dos arquivos previstos pelo HA;
- instalação e atualização dos agentes;
- heartbeat, estado dos serviços e diagnóstico;
- Keepalived, VIP e persistência de papel/prioridade;
- scripts de promoção, rejoin e validações de prontidão;
- journal das operações, progresso, erros e logs;
- atualização rolling e rollback documentados.

O nó antigo nunca deve retornar automaticamente como primário. Após uma
promoção, seu retorno exige `rejoin`/`re-seed` e nova validação.

## Papel do Keepalived

O Keepalived elege o proprietário potencial da VIP, mas não orquestra a
promoção do ambiente. A VIP só deve ser publicada depois de confirmados:

- papel efetivo `PRIMARY`;
- MySQL gravável;
- Redis master;
- API, gateway e serviços essenciais saudáveis;
- storage disponível;
- promoção concluída no journal;
- ausência de bloqueio de fencing;
- liderança válida, quando houver lease/witness integrado.

Essa separação evita que uma eleição VRRP exponha um nó antes de banco,
cache, arquivos e containers estarem coerentes.

## Limites e responsabilidade operacional

Sem witness, STONITH ou fencing do hypervisor, dois nós não distinguem com
segurança uma queda real de uma partição de rede. Nessa condição, o sistema
deve bloquear a promoção automática e informar claramente a ação manual
necessária.

Os checkpoints que ainda dependam do operador devem aparecer na interface e
no runbook. Falhas de scripts devem permanecer registradas no journal, com
saída suficiente para diagnóstico e retomada segura.

## Evolução posterior ao fechamento

### Migração controlada por degradação

Fluxo futuro para um nó ainda acessível: confirmar degradação por vários
ciclos, abrir operação persistente, validar backup e standby, drenar sessões,
bloquear escritas, alcançar paridade, isolar o primário, promover dados e
serviços, validar health profundo, liberar a VIP e reintegrar o nó anterior.

### Failover emergencial

Fluxo futuro para perda do primário: expirar heartbeat, confirmar falha por
caminhos independentes, obter fencing/witness, validar RPO, promover dados e
serviços, liberar a VIP somente após health profundo, registrar possível
perda e exigir rejoin do nó antigo.

### Containers e múltiplos nós

O inventário futuro deve identificar `nodeId`, deployment, release, papel,
imagem/digest, rede, volumes, portas, origem do Compose e criação, permitindo
classificar réplica esperada, órfão, duplicata conflitante, versão divergente
e serviço gravável no nó errado.

Para três ou mais nós serão necessários quorum, candidaturas e prioridades
explícitas, lease distribuído, topologia de replicação, fencing por nó e
prevenção de promoções concorrentes. Também poderá ser avaliado delegar esse
consenso a MySQL InnoDB Cluster/Group Replication e Redis Sentinel/Cluster,
mantendo o NodeAccess como plano de controle.

## Próximo incremento

Depois da homologação desta versão, evoluir o orquestrador da tela em dois
fluxos separados: `Migração controlada` e `Failover emergencial`, ambos com
progresso persistente, logs, rollback e instruções manuais explícitas.

## Evidência de homologação da 2.0.28

Em 2026-07-29, a topologia de laboratório `192.168.1.100`/`.101` concluiu:

- atualização rolling dos dois nós;
- backup agregado com checksums;
- falha controlada da API e retirada da VIP;
- bloqueio da VIP em nó `STANDBY`;
- promoção real `.101 → .100` e rejoin;
- promoção inversa `.100 → .101` e rejoin;
- MySQL com GTID/lag zero, Redis e arquivos alinhados nas duas direções;
- retorno à topologia inicial, com `.101 PRIMARY`, `.100 STANDBY` e uma VIP.

Um ensaio posterior de instalação limpa confirmou que o comando de matrícula
instala somente o agente e não deve ser apresentado como provisionamento
integral. Stack, réplicas e Keepalived/VIP permanecem etapas explícitas. A
matriz de falhas também tornou o frontend local um gate obrigatório do
Keepalived, além da API e do gateway.

O re-seed limpo foi concluído após retorno do nó A: fingerprints idênticos
autorizaram a reconciliação auditada de oito GTIDs vazios do bootstrap, e o
gate final registrou `readyForFailback=true`. O instalador offline também
passou a validar o diretório raiz contido no tarball, sem depender do nome
local usado no download.

O provisionamento assistido começa por `INSTALL_RELEASE`: URL e checksum não
sensíveis podem permanecer no job, mas segredos e seeds ficam proibidos nesse
canal. A ação somente promove a release em standby sem VIP; estado e tráfego
continuam bloqueados até seus próprios gates governados.

A ação foi homologada em 2026-07-29 entre os nós `192.168.1.101`
(`PRIMARY`) e `192.168.1.100` (`STANDBY`) com a release `2.0.29`. O job
persistente chegou a `COMPLETED`, o pacote teve o checksum validado, a VIP
permaneceu exclusivamente no primário e, após ativação controlada da release,
os dois nós responderam ao health profundo na versão `2.0.29`. MySQL e Redis
permaneceram alinhados no standby.

O estágio seguinte de configuração usa criptografia assimétrica por agente.
A chave privada nunca deixa o nó; somente envelopes RSA-OAEP entram na fila e
são apagados após o consumo. O endpoint e o CTA exigem HTTPS. Aplicar os
segredos não autoriza reinício de serviços, reconfiguração de réplica nem
mudança de VIP: essas ações continuam com gates e journal próprios.

A release `2.0.30` fechou esse estágio com E2E real de aplicação, ausência de
plaintext, rollback, chave incorreta, falha de certificado e switchover
planejado completo. A promoção passou a preservar TLS. O limite arquitetural
permanece: exatamente um `PRIMARY`, um `STANDBY` operacional e witness externo;
multinó e quorum distribuído continuam fora desta versão.

A release `2.0.38` acrescentou o failover emergencial automático com autoridade
externa de fencing. O standby somente solicita a promoção após falhas
consecutivas, health profundo local saudável e confirmação independente do
witness. Em modo `enforce`, a evidência assinada só é emitida depois de o
hypervisor confirmar o primário antigo desligado. Sem esses gates, a promoção
permanece bloqueada.

O ensaio corrigiu três falhas antes do fechamento: backup MySQL sem
`RELOAD/FLUSH_TABLES`, Keepalived sem gate de papel/`FAULT`, e origem de
arquivos do rejoin baseada em diretório default incorreto.

Limitação aceita nesta versão: operações iniciadas diretamente pelos scripts
mantêm journal JSONL em `/opt/nodeaccess/shared/ha/operations`, mas não são
importadas automaticamente para `ha_operations` no painel. Até o orquestrador
integral ser entregue, o operador deve preservar esses arquivos e anexá-los à
evidência da mudança.
