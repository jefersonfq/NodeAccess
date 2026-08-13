# NA-0015 — Resultados de teste Helm/Kubernetes

Data: 2026-08-12

## Cluster efêmero real

- kind 0.31.0 com Kubernetes 1.35.0: aprovado;
- kubectl 1.36.0 e Helm 3.17.3: aprovados;
- MySQL 8.0 e Redis 7 externos no namespace isolado: aprovados;
- migration `pre-install` e `pre-upgrade`: aprovada;
- instalação da API e gateway com imagem `nodeaccess-backend:2.0.42`: aprovada;
- `helm test` de saúde da API: aprovado;
- `helm test` de conectividade do gateway: aprovado;
- upgrade com rollout da API de uma para duas réplicas: aprovado;
- rollback para a revisão inicial e retorno a uma réplica pronta: aprovado.
- falha de migration por banco indisponível bloqueou o upgrade antes de alterar
  Deployments: aprovado;
- workloads da revisão anterior permaneceram prontos durante a falha: aprovado;
- restauração do banco e novo upgrade recuperaram a release: aprovado.
- WebSocket com sessão SSH real permaneceu ativo durante o `SIGTERM` do pod:
  aprovado;
- readiness do gateway em drenagem retornou HTTP 503: aprovado;
- 20 comandos e 57 blocos de saída trafegaram após o início do rollout, com
  fechamento normal pelo cliente (`1000`): aprovado;
- rollout do gateway concluiu após o encerramento da sessão: aprovado;
- `helm test` da API e do gateway após a imagem corrigida: aprovado.
- Ingress Nginx real com terminação TLS: aprovado (`200`, certificado
  validado com `ssl_verify_result=0`);
- WSS/SSH pelo Nginx: aprovado, com 5 comandos, 16 mensagens de saída e
  fechamento normal (`1000`);
- Ingress Traefik real com terminação TLS: aprovado (`200`, certificado
  validado com `ssl_verify_result=0`);
- WSS/SSH pelo Traefik: aprovado, com 5 comandos, 16 mensagens de saída e
  fechamento normal (`1000`);
- release Traefik reconciliada como `deployed` e Deployment pronto: aprovado.

## Correções encontradas pelo teste real

- definido UID/GID não-root explícito, pois o kubelet rejeitava imagens sem
  usuário declarado quando `runAsNonRoot` estava ativo;
- ConfigMap e Job de migration deixaram de injetar variáveis opcionais vazias,
  que faziam o backend rejeitar `APP_FRONTEND_URL=""` durante o bootstrap.
- o lease de drenagem era liberado quando `handleConnection()` terminava de
  registrar os listeners; agora acompanha `close/error` do WebSocket.
- corrigidas referências de tipo no bootstrap (`Redis`) e acesso ao decorator
  Fastify que impediam o build da imagem atual.
- schema do chart passou a validar `ingress.className`, annotations e secret
  TLS; harness ganhou renderização explícita para Traefik.

## Validação estática

- `helm lint`: aprovado;
- render mínimo e de produção: aprovado;
- guard de migration, datastores externos e hooks de conectividade: aprovados.

## Harnesses reproduzíveis

- `npm run test:helm-chart`: lint, renders e guards do chart;
- `tools/deploy/helm-migration-recovery-harness.sh`: falha e recuperação de
  migration em release já instalada;
- `PROFILE_FILE=<perfil> npm run test:helm-gateway-drain`: preservação de SSH
  durante rollout, readiness 503 e conclusão posterior do Deployment;
- `PROFILE_FILE=<perfil> INGRESS_PORT=<porta> INGRESS_HOST=<host>`
  `INGRESS_CA_FILE=<certificado> npm run test:helm-ingress-wss`: TLS, upgrade
  WebSocket e tráfego SSH pelo controlador selecionado.

Os harnesses de drenagem e Ingress esperam cluster, release, mock SSH e perfil
efêmero previamente provisionados. Não criam nem removem clusters implicitamente.

`npm run test:helm-kind-certification` orquestra o cenário completo: constrói a
imagem atual, cria um cluster kind, instala dependências e release, executa
migration recovery, drenagem, Nginx e Traefik e remove o cluster ao final. O
workflow `Kubernetes certification` executa esse cenário semanalmente ou sob
disparo manual, fora do gate rápido de pull request.

O orquestrador completo foi executado localmente em 2026-08-13 com imagem já
construída e aprovado em uma única passagem:

```json
{"install":true,"helmTest":true,"migrationRecovery":true,"gatewayDrain":true,"nginxTlsWss":true,"traefikTlsWss":true}
```

Downloads transitórios dos charts Nginx e Traefik falharam uma vez e foram
recuperados pelo retry limitado; os testes funcionais não são repetidos nem
ignorados. Em volumes WSL montados em `/mnt`, o build pode preparar contexto em
`/tmp`; `SKIP_IMAGE_BUILD=true` permite certificar uma imagem local existente.

## Escopo Kubernetes validado

- instalação, migration, upgrade e rollback;
- falha e recuperação de migration;
- `helm test` no cluster;
- sessão WebSocket SSH durante rollout e drenagem do gateway;
- Ingress Nginx e Traefik com TLS e WSS real.
