# Inventario de estado para HA

Objetivo: definir quais dados do NodeAccess precisam ser compartilhados,
replicados ou aceitos como volateis antes de evoluir para warm standby,
active/passive com VRRP ou active/active parcial.

## Principio

HA nao deve comecar duplicando containers. Primeiro e preciso decidir onde vive
cada estado. Componentes stateless podem escalar; componentes stateful precisam
de dono claro, backup, restore, replicacao ou storage compartilhado.

## Matriz de estado

| Estado | Onde vive hoje | Critico | Multi-node | Decisao inicial |
| --- | --- | --- | --- | --- |
| MySQL | `DATABASE_URL` / volume `mysql_data` | Sim | Deve ser unico ou replicado | Centralizar em um MySQL primario; manter backup/restore testado antes de replica |
| Redis | `REDIS_URL` / volume `redis_data` | Medio/alto | Deve ser comum entre API/gateway | Um Redis compartilhado no primeiro HA; depois Sentinel/gerenciado |
| Chunks de auditoria SSH | `SESSION_AUDIT_STORAGE_DIR` / `session_audit_data` | Sim | Nao pode ficar em disco efemero por no | Curto prazo backup; medio prazo storage compartilhado ou replicacao |
| Avatares de usuario | `USER_AVATAR_STORAGE_DIR` / `user_avatar_data` | Medio | Precisa ser comum para UI consistente | Usar volume persistente e incluir no plano de backup; em HA mover para storage compartilhado |
| Backups | `BACKUP_DIR` | Sim | Nao devem depender apenas do no ativo | Diretorio externo/replicado; copiar para destino fora da VM |
| Segredos de ambiente | `.env`, `JWT_SECRET`, `PEM_ENCRYPTION_KEY` | Sim | Devem ser identicos onde aplicavel | Distribuir por cofre ou procedimento controlado; nunca regenerar em restore |
| Certificados TLS locais | `TLS_CERT_PATH`, `TLS_KEY_PATH` | Sim quando TLS local | Devem ser consistentes no par ativo/passivo | Preferir reverse proxy externo; se local, replicar com controle |
| Sessoes SSH/WebSocket ativas | Memoria do gateway | Sim para experiencia, nao recuperavel | Stateful por conexao | Exigir sticky session; se gateway cair, reconexao manual no MVP |
| SFTP em progresso | Memoria/conexao SSH | Medio | Stateful por conexao | Operacao deve falhar de forma clara; usuario reabre apos reconectar |
| Tunnels/port forwarding ativos | Processo gateway/SSH | Alto para sessao | Stateful por gateway | Sticky session e draining; sem retomada automatica no MVP |
| Jobs operacionais futuros | API/Redis/MySQL | Alto se duplicados | Precisam lock distribuido | Nao rodar em todos os nos sem trava; usar lock Redis/MySQL |
| Observabilidade local | Memoria da API | Baixo | Por no | Aceitar local-only; agregador multi-node depois |
| Logs de aplicacao | stdout/container/host | Medio | Devem ser centralizados para suporte | Coletar por Docker/log agent; nao usar disco local como unica fonte |
| Build frontend | Imagem/volume estatico | Baixo | Deve ser identico | Mesmo artefato de release em todos os nos |

## Decisoes para o primeiro HA suportavel

Primeiro corte recomendado: **active/passive operacional**.

- Um no ativo atende usuarios.
- Um no secundario fica pronto com mesma release.
- MySQL fica centralizado, replicado ou restaurado periodicamente.
- Redis fica centralizado ou restauravel conforme uso aceito.
- Auditoria SSH e avatares ficam em storage persistente com backup.
- Failover pode derrubar sessoes SSH ativas; isso deve ser documentado.
- Doctor deve passar no no secundario antes de considerar standby valido.

Segundo corte recomendado: **active/active parcial**.

- Frontend/Nginx podem ser balanceados.
- API REST pode ser balanceada se compartilhar MySQL, Redis e storage.
- Gateway SSH entra atras do balanceador apenas com sticky session e draining.
- Jobs e tarefas agendadas precisam lock distribuido antes de mais de uma API
  executa-los.

## Regras de readiness para HA

Um no so deve receber trafego se:

- `/health/ready` da API estiver `ok`;
- `/health/ready` do gateway estiver `ok`;
- MySQL estiver acessivel;
- Redis estiver acessivel;
- `SESSION_AUDIT_STORAGE_DIR` existir e permitir escrita/leitura;
- `USER_AVATAR_STORAGE_DIR` existir e permitir escrita/leitura quando avatar
  estiver habilitado;
- volume `user_avatar_data` existir no compose quando usando Docker;
- versao/release bater com os demais nos do grupo;
- segredos criticos estiverem presentes e iguais aos do ambiente restaurado.

## Regras de backup/restore

Backup minimo:

- MySQL;
- auditoria SSH;
- avatares de usuario;
- manifests/checksums;
- referencia da release;
- copia segura dos segredos necessarios para descriptografar dados.

Restore minimo:

- restaurar MySQL;
- restaurar chunks de auditoria;
- restaurar avatares;
- subir mesma release;
- preservar `PEM_ENCRYPTION_KEY`;
- rodar doctor com smoke/deep health;
- validar login, listagem de hosts, abertura de terminal, leitura de auditoria e
  carregamento de avatar.

Scripts de avatar:

```bash
bash scripts/backup/backup-user-avatars.sh ./backups
bash scripts/backup/restore-user-avatars.sh ./backups/nodeaccess-user-avatars-YYYYMMDD-HHMMSS.tar.gz --yes
```

Backup agregado recomendado para rotina operacional:

```bash
bash scripts/backup/backup-all-nodeaccess.sh ./backups
```

Por padrao ele exige MySQL, auditoria SSH e avatares. Em ambientes antigos ou
de transicao, `REQUIRE_STATEFUL_BACKUPS=false` permite continuar quando um
backup stateful ainda nao estiver disponivel, registrando alerta no output.

Harness isolado:

```bash
bash tools/deploy/backup-all-nodeaccess-harness.sh
bash tools/deploy/backup-user-avatars-harness.sh
```

## Pontos que ainda precisam decisao

- Redis guarda apenas estado toleravel a perda ou tambem estado critico?
- Qual sera o destino externo de backup: compartilhamento, NAS, S3 compativel ou
  solucao do cliente?
- Auditoria SSH deve ir para storage compartilhado primeiro ou object storage?
- Avatares devem continuar em filesystem ou migrar para blob/object storage?
- Havera um scheduler unico para jobs operacionais ou lock distribuido?
- O load balancer sera Nginx, HAProxy, Traefik, appliance ou VRRP direto?

## Proximo passo tecnico

Harness inicial implementado em
`scripts/deploy/ha-state-readiness.sh`.

Harness de sanidade isolado:

```bash
bash tools/deploy/ha-state-readiness-harness.sh
```

Uso basico:

```bash
bash scripts/deploy/ha-state-readiness.sh
```

Com health e observabilidade:

```bash
RUN_HEALTH_CHECKS=true RUN_OBSERVABILITY_CHECK=true \
  bash scripts/deploy/ha-state-readiness.sh
```

Saida JSON:

```bash
HA_READINESS_OUTPUT=json bash scripts/deploy/ha-state-readiness.sh
```

O harness valida:

- variaveis obrigatorias;
- diretorios stateful;
- permissao de escrita/leitura em auditoria e avatares;
- backup recente de MySQL, auditoria e avatares;
- health API/gateway;
- resposta da observabilidade;
- relatorio final em texto e JSON.
