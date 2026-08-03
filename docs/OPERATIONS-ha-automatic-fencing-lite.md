# Política de promoção HA: degradação e falha

Esta política mantém um único escritor e separa explicitamente dois fluxos:

| Situação | Primário responde? | Decisão | Promoção |
| --- | --- | --- | --- |
| Degradação ou manutenção | Sim | Troca planejada, iniciada pelo operador | Assistida, com quiesce e sincronização final |
| Falha ou queda de serviço | Não, após várias amostras | Failover emergencial validado pelo witness | Automática somente após fencing confirmado |

Keepalived não promove banco, Redis ou aplicação por conta própria. Ele publica
a VIP somente no nó que concluiu a promoção.

## 1. Promoção por degradação

Use este fluxo quando o primário ainda está acessível, mas precisa sair de
operação: manutenção, pressão de recursos, latência persistente, falha parcial
ou atualização planejada.

1. O operador escolhe o standby e executa o preflight.
2. O primário é colocado em quiesce, bloqueando novas escritas.
3. A sincronização final confirma MySQL, Redis e arquivos.
4. O standby é promovido e assume o papel `PRIMARY`.
5. A VIP é publicada no novo primário.
6. O nó antigo retorna somente após rejoin e validação de paridade.

Qualquer gate reprovado interrompe a troca. Esse fluxo não depende de concluir
que o primário morreu; ele usa sua disponibilidade para realizar uma transição
ordenada.

### Evidência witness na troca planejada

Nesse fluxo, o witness não executa `poweroff`. Ele assina uma autorização curta
para a topologia exata, contendo os IDs do PRIMARY e do STANDBY. Gere os
arquivos no terceiro host, nunca em um dos nós:

- **Máquina de origem:** host externo que executa o witness;
- **Programa gerador:** `ha-witness-issue-evidence.sh`;
- **Local de geração:** definido por `OUTPUT_PREFIX`;
- **Arquivos resultantes:** `<OUTPUT_PREFIX>.txt` e `<OUTPUT_PREFIX>.sig`;
- **Destino:** `/opt/nodeaccess/shared/ha/witness/` no standby;
- **Chave privada:** permanece no host witness e nunca acompanha os arquivos.

Na preparação inicial da terceira máquina, instale o comando uma única vez a
partir do pacote NodeAccess:

```bash
sudo bash scripts/deploy/install-ha-witness-authorizer.sh
```

O instalador cria o par de chaves se ele ainda não existir, instala o comando e
preserva chaves existentes. Copie somente
`/var/lib/nodeaccess-ha-witness/keys/witness-public.pem` para os dois nós.

Durante a troca, execute apenas:

```bash
sudo nodeaccess-ha-witness-authorize \
  planned <ID_PRIMARY> <ID_STANDBY> /tmp/switchover-planejado
```

O script usa por padrão a chave
`/var/lib/nodeaccess-ha-witness/keys/witness-private.pem`. Para uma instalação
com chave em outro local, informe o caminho como quinto argumento.

Copie somente `.txt` e `.sig` para o standby:

```bash
scp /tmp/switchover-planejado.txt /tmp/switchover-planejado.sig \
  root@<IP_STANDBY>:/opt/nodeaccess/shared/ha/witness/
```

No painel, informe apenas os nomes dos arquivos, sem o diretório. A chave
privada permanece exclusivamente no witness. Como a evidência expira, emita-a
somente depois do preflight e imediatamente antes de iniciar a troca.

## 2. Promoção por falha ou queda

Use este fluxo quando o primário deixa de responder. O modo automático mantém
exatamente dois nós NodeAccess e usa um serviço externo como autoridade de
fencing. O serviço deve executar fora das duas VMs e possuir acesso ao
hypervisor.

Sequência de decisão:

1. O standby confirma que seu próprio `/health/deep` está saudável.
2. O health do primário falha por `FAILURE_THRESHOLD` ciclos consecutivos.
3. O standby solicita uma decisão ao witness por uma rede independente.
4. O witness repete seus próprios probes.
5. Se ainda alcançar o primário, recusa a promoção.
6. Se confirmar a falha, executa o fencing pelo hypervisor.
7. Somente depois de confirmar `poweroff` ou `aborted`, emite evidência assinada.
8. O standby valida a evidência, promove o estado e publica a VIP.

Uma falha isolada nunca promove um nó. Sem witness, sem fencing, com health
local degradado ou com evidência inválida, a decisão segura é bloquear.

## Exemplos de comportamento

| Caso | Resultado |
| --- | --- |
| Um timeout da API do primário | Contador incrementa; nenhuma promoção |
| O primário volta a responder antes do limite | Contador volta a zero |
| Limite atingido, mas o witness alcança o primário | Fencing recusado; promoção bloqueada |
| Limite atingido, witness confirma falha e desliga a VM | Evidência assinada; promoção automática |
| Standby com `/health/deep` degradado | Contador zerado; não solicita fencing |
| Modo `observe-only` | Registra a decisão, mas nunca desliga VM nem promove |

## Gates obrigatórios

- somente um nó com papel local `STANDBY` pode solicitar fencing;
- o health profundo local deve estar saudável;
- o peer deve falhar por vários ciclos consecutivos;
- o witness repete as verificações por caminho independente;
- pedidos `observe-only` nunca executam `poweroff`;
- em `enforce`, a evidência RSA só é emitida depois de o hypervisor confirmar
  a VM de origem em `poweroff` ou `aborted`;
- a promoção valida MySQL, Redis, arquivos, assinatura e nonce;
- o nó cercado retorna com a rede de produção isolada e passa por rejoin antes
  de voltar como `STANDBY`.

## Componentes

- `tools/ha-witness/fencing-service.mjs`: API externa, lease e adaptador
  VirtualBox;
- `scripts/deploy/ha-auto-failover-watch.sh`: observador executado nos nós;
- `systemd/nodeaccess-ha-auto-failover.{service,timer}`: ciclo local;
- `/etc/sysconfig/nodeaccess-ha-autofailover`: configuração root-only;
- `/var/lib/nodeaccess-ha-agent/auto-failover/journal.jsonl`: journal do nó;
- `state/fencing-journal.jsonl`: journal externo do witness.

## Configuração nos nós

Arquivo root-only: `/etc/sysconfig/nodeaccess-ha-autofailover`.

| Variável | Função | Política recomendada |
| --- | --- | --- |
| `AUTO_FAILOVER_ENABLED` | Liga o observador local | `true` após configurar ambos os nós |
| `AUTO_FAILOVER_MODE` | `observe-only` ou `enforce` | Começar em `observe-only` |
| `PEER_NODE_ID` | ID imutável do outro nó | Deve corresponder ao cadastro do witness |
| `PEER_HEALTH_URL` | Health profundo do primário | HTTPS em rede conhecida |
| `LOCAL_NODE_IP` | IP do nó que pode assumir | Nunca usar a VIP |
| `WITNESS_URL` | API externa de fencing | Preferir rede de gerenciamento independente |
| `WITNESS_TOKEN` | Autenticação do pedido | Segredo root-only, mínimo de 24 caracteres |
| `WITNESS_PUBLIC_KEY` | Verificação da evidência | Distribuir apenas a chave pública |
| `FAILURE_THRESHOLD` | Falhas locais consecutivas | Entre 2 e 60; laboratório atual usa 6 |
| `PROBE_TIMEOUT_SECONDS` | Timeout de cada probe | Menor que o intervalo do timer |
| `COOLDOWN_SECONDS` | Intervalo mínimo entre pedidos | Evita repetição agressiva |

O timer padrão executa o observador a cada 5 segundos. Com limite 6, o pedido
ao witness ocorre após aproximadamente 30 segundos de falha persistente, além
dos tempos dos probes. O witness possui seu próprio `failureThreshold`,
`failureIntervalMs` e `requestTimeoutMs`; portanto a promoção leva também o
tempo necessário para a confirmação independente e o fencing.

## Configuração do witness

Use `tools/ha-witness/fencing.config.example.json` como referência:

- `mode`: deve acompanhar a política dos nós;
- `failureThreshold` e `failureIntervalMs`: número e intervalo dos probes
  independentes;
- `evidenceTtlSeconds`: validade curta da evidência assinada;
- `nodes[].id`: ID exato usado pelo agente;
- `nodes[].healthUrl`: health acessível pelo terceiro host;
- `nodes[].vm`: identificador inequívoco da VM no hypervisor;
- `privateKey`: permanece somente no witness.

## Ativação segura

Comece sempre em `observe-only`. Habilite `enforce` somente depois de validar
conectividade independente, mapeamento exato entre `nodeId` e VM, chave
pública nos dois nós, fencing real e procedimento de rejoin.

No laboratório VirtualBox, uma NIC host-only dedicada evita que a decisão de
fencing dependa da mesma rede usada pela VIP. Em produção, substitua o
adaptador VirtualBox pelo hypervisor, IPMI, PDU ou API de cloud do cliente.

## Retorno após a falha

O nó cercado não pode reiniciar como escritor. Ele deve voltar com a rede de
produção isolada, assumir `STANDBY`, permanecer sem VIP e somente leitura, e
executar o rejoin contra o primário atual. GTIDs errantes, arquivos divergentes
ou réplica incompleta bloqueiam o retorno e podem exigir re-seed.
