# NA-0158 — Registro da implementação

## Pedido e objetivo

Concluir conformidade Sonar e corrigir colaterais encontrados no CI.

## Implementação

Base SHA 9a47efdba488adeff100ebf28dfb3f74798e1d4d. O inventário real contém uma ocorrência FIXED antiga de ImportHostsModal com a mesma regra/hash de uma ocorrência atual. Excluir somente FIXED da detecção de ranges extras; toda ocorrência ativa, aceita ou classificada continua bloqueando se não revisada. Não transicionar o histórico.

## Validação

Ran: 41 contratos PASS, incluindo seis estados históricos e negativa de escrita em ocorrência não relacionada. Planned: CI no candidato integrado.

## Recuperação

Branch independente; reversão por PR.

## Pendências

CI, revisão independente e homologação humana pendentes. Sem alterações no Sonar principal.

## Diário de interações

### 2026-11-04T14:10:04-03:00 — Continuidade solicitada

Usuário pediu continuar. Falha reproduzida, causa isolada e correção localizada com testes. 41 contratos PASS, incluindo seis estados históricos e negativa de escrita em ocorrência não relacionada. Próximo passo: consolidar e repetir gates.
