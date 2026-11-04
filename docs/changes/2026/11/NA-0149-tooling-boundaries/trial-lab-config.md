# Configuração explícita dos ensaios

O harness trial-live exige `TRIAL_LIVE_ENV` com banco descartável local `na0068` e, antes de criar Prisma/Redis, confirma SSH usando:

- `TRIAL_LIVE_SSH_HOST`, `TRIAL_LIVE_SSH_PORT`, `TRIAL_LIVE_SSH_USER`, `TRIAL_LIVE_SSH_PASSWORD`;
- `TRIAL_LIVE_SSH_FINGERPRINT`: fingerprint SHA256 obtido por canal independente, sem padding;
- `TRIAL_LIVE_NETWORK_CIDR`: CIDR IPv4 do laboratório;
- `TRIAL_LIVE_DEMO_HOSTS`: JSON com três IPs distintos da rede; o primeiro é o alvo SSH;
- `TRIAL_LIVE_FORBIDDEN_HOST`: outro IP dessa rede para o teste negativo de cadastro;
- `TRIAL_LIVE_PROTECTED_ADDRESSES`: lista JSON não vazia de IPs que a política deve bloquear. Transportar a proteção existente do ambiente para essa configuração; não esvaziá-la para executar o teste.

Nenhum destino ou fingerprint é inferido. Ausência, inconsistência ou chave divergente bloqueia a execução. O handshake tem deadline de cinco segundos; a senha das contas web de laboratório é aleatória por execução. Não foi executado o fluxo trial completo com MySQL/Redis nesta frente; foram executados contratos de configuração e handshake SSH real descartável em loopback, incluindo pin divergente antes da autenticação.

O ensaio Helm/Ollama associa todos os comandos kubectl/Helm ao contexto `kind-<cluster criado>`. Não exclui cluster quando a criação falhou; se uma criação parcial deixou recursos, inspecionar ownership antes de cleanup manual. Secret sintético desse chart é inutilizado pelos workloads API/gateway/frontend desabilitados; não representa credencial operacional. A frente validou este fluxo por doubles de comandos e preservou os argumentos, sem subir cluster ou baixar modelo.
