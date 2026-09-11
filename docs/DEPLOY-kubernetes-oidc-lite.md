# NodeAccess no Kubernetes com SSO OIDC

Guia curto para instalar o NodeAccess 2.x no Kubernetes usando o Helm chart do
próprio projeto e integrar um provedor OIDC já existente. O roteiro pressupõe
que cluster, ingress controller, DNS, certificado TLS, MySQL, Redis, registry e
IdP já estão operacionais.

## 1. Arquitetura implantada

O chart `charts/nodeaccess` cria:

- frontend web;
- API REST;
- gateway SSH/WebSocket;
- `Job` de migração Prisma antes da instalação ou atualização;
- Services, Ingress, probes, PDB e, opcionalmente, NetworkPolicy;
- ServiceMonitor e PrometheusRule opcionais.

MySQL e Redis não são criados pelo chart. Devem ser serviços externos ou
serviços gerenciados acessíveis pelos pods.

## 2. Pré-requisitos

- Kubernetes 1.25 ou superior;
- Helm 3;
- ingress controller compatível com WebSocket, como ingress-nginx;
- hostname HTTPS, por exemplo `nodeaccess.empresa.com.br`;
- Secret TLS no namespace;
- imagens backend e frontend 2.x publicadas no registry;
- conectividade da API e do gateway com MySQL, Redis, hosts SSH e o issuer OIDC;
- integração OIDC licenciada para o tenant no NodeAccess.

O Ingress precisa manter conexões WebSocket longas. O chart já configura os
timeouts do ingress-nginx em 3600 segundos.

## 3. Namespace e credenciais

Crie o namespace:

```bash
kubectl create namespace nodeaccess
```

Crie `nodeaccess-runtime-secret.yaml` fora do repositório e substitua os
valores marcados. Não versione esse arquivo.

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: nodeaccess-runtime
  namespace: nodeaccess
type: Opaque
stringData:
  NODE_ENV: production
  DATABASE_URL: "mysql://USUARIO:SENHA@mysql.infra.svc:3306/nodeaccess"
  REDIS_URL: "redis://:SENHA@redis.infra.svc:6379"
  JWT_SECRET: "SUBSTITUIR_POR_UMA_CHAVE_ALEATORIA_COM_PELO_MENOS_32_CARACTERES"
  PEM_ENCRYPTION_KEY: "SUBSTITUIR_POR_64_CARACTERES_HEXADECIMAIS"
  METRICS_TOKEN: "SUBSTITUIR_POR_TOKEN_FORTE"
  LICENSE_KEY: "SUBSTITUIR_SE_APLICAVEL"
```

Geração segura das chaves:

```bash
openssl rand -base64 48
openssl rand -hex 32
openssl rand -base64 32
```

Use os resultados, respectivamente, para `JWT_SECRET`,
`PEM_ENCRYPTION_KEY` e `METRICS_TOKEN`.

```bash
kubectl apply -f nodeaccess-runtime-secret.yaml
```

Se o registry for privado, crie também um pull secret e referencie-o em
`imagePullSecrets` no arquivo de valores.

## 4. Valores de produção

Copie `charts/nodeaccess/values-production.example.yaml` para um arquivo fora
do repositório, por exemplo `nodeaccess-values.yaml`:

```yaml
image:
  repository: registry.empresa.com/nodeaccess/backend
  tag: "2.0.0"
  pullPolicy: IfNotPresent

frontend:
  enabled: true
  image:
    repository: registry.empresa.com/nodeaccess/frontend
    tag: "2.0.0"
    pullPolicy: IfNotPresent
  replicas: 2

api:
  replicas: 2

gateway:
  replicas: 2

existingSecret: nodeaccess-runtime

config:
  APP_URL: "https://nodeaccess.empresa.com.br"
  APP_FRONTEND_URL: "https://nodeaccess.empresa.com.br"
  TENANT_BASE_DOMAIN: "nodeaccess.empresa.com.br"
  TRUST_PROXY: "true"
  AUTH_OIDC_ALLOW_JIT: "false"
  AUTH_OIDC_ALLOW_AUTOMATIC_LINKING: "false"
  AUTH_ALLOW_EMAIL_TENANT_DISCOVERY: "true"
  FEATURE_METRICS: "true"

ingress:
  enabled: true
  className: nginx
  host: nodeaccess.empresa.com.br
  tlsSecretName: nodeaccess-tls

networkPolicy:
  enabled: true
```

Observações:

- `APP_FRONTEND_URL` deve ser exatamente a URL pública HTTPS;
- `TENANT_BASE_DOMAIN` permite descoberta por subdomínio; ajuste ao modelo de
  tenancy usado na instalação;
- JIT e linking automático ficam desativados inicialmente por segurança;
- se a organização utiliza NetworkPolicies de egress, libere DNS, MySQL,
  Redis, issuer/JWKS/token endpoint do IdP e redes dos hosts SSH;
- diretórios de auditoria, avatares e modelos locais precisam de storage
  persistente quando esses recursos forem habilitados. O chart base não cria
  PVC para eles automaticamente.

## 5. Validar e instalar

Antes de alterar o cluster:

```bash
helm lint charts/nodeaccess -f nodeaccess-values.yaml

helm template nodeaccess charts/nodeaccess \
  --namespace nodeaccess \
  -f nodeaccess-values.yaml > /tmp/nodeaccess-rendered.yaml
```

Instale ou atualize:

```bash
helm upgrade --install nodeaccess charts/nodeaccess \
  --namespace nodeaccess \
  --create-namespace \
  -f nodeaccess-values.yaml \
  --atomic \
  --wait \
  --timeout 10m
```

O hook de migração executa antes dos Deployments serem atualizados. Com
`--atomic`, uma falha impede que uma instalação parcial permaneça ativa.

Confira o resultado:

```bash
kubectl -n nodeaccess get pods,svc,ingress,jobs
kubectl -n nodeaccess rollout status deployment/nodeaccess-api
kubectl -n nodeaccess rollout status deployment/nodeaccess-gateway
kubectl -n nodeaccess rollout status deployment/nodeaccess-frontend
```

Para investigar falhas:

```bash
kubectl -n nodeaccess logs deployment/nodeaccess-api --tail=200
kubectl -n nodeaccess logs deployment/nodeaccess-gateway --tail=200
kubectl -n nodeaccess get events --sort-by=.lastTimestamp
```

## 6. Configurar o cliente no provedor OIDC

Cadastre uma aplicação web confidencial no IdP:

- fluxo: Authorization Code;
- PKCE: habilitado;
- redirect URI:
  `https://nodeaccess.empresa.com.br/auth/oidc/callback`;
- scopes mínimos: `openid profile email`;
- adicione o scope/claim de grupos somente se usar mapeamento de grupos;
- logout/front-channel logout não é requisito para o primeiro rollout.

Guarde o `client_id`, o `client_secret` e o issuer exato. O issuer deve ser o
mesmo publicado em `/.well-known/openid-configuration`, incluindo caminho e
versão quando existirem.

O NodeAccess possui validações de compatibilidade para Microsoft Entra ID,
Okta, Keycloak e provedores OIDC equivalentes.

## 7. Habilitar OIDC no NodeAccess

1. Entre com uma conta administrativa local.
2. Confirme que existe uma conta local de emergência (`break-glass`) testada.
3. Abra **Administração → Integrações → SSO corporativo (OIDC)**.
4. Informe nome, issuer, client ID, client secret e scopes.
5. Use **Testar configuração** e confirme que o discovery foi validado.
6. Configure domínios permitidos e JIT somente se a política aprovada exigir.
7. Salve e habilite o provider.
8. Teste o login em uma janela anônima antes de tornar o SSO obrigatório.

O client secret é cifrado no banco e não é devolvido pela API. As flags
`AUTH_OIDC_ALLOW_JIT` e `AUTH_OIDC_ALLOW_AUTOMATIC_LINKING` são limites da
instalação: a política do tenant não consegue habilitar algo bloqueado nelas.

Para contas já existentes, prefira o fluxo revisado em **Vínculos de
identidade**. Linking automático por e-mail deve ser habilitado apenas quando
o IdP, o domínio e a governança de identidades forem confiáveis.

## 8. Checklist de aceite

- [ ] `/health` responde através do hostname público;
- [ ] frontend e API utilizam HTTPS sem erro de certificado;
- [ ] uma sessão SSH abre e permanece conectada por WebSocket;
- [ ] API e gateway alcançam MySQL e Redis;
- [ ] API alcança discovery, JWKS e token endpoint do IdP;
- [ ] discovery OIDC passa no teste da interface;
- [ ] login OIDC funciona em janela anônima;
- [ ] usuário recebe o tenant e os grupos esperados;
- [ ] conta break-glass continua funcionando;
- [ ] logs não contêm token, authorization code ou client secret;
- [ ] backup e rollback foram definidos antes de tornar SSO obrigatório.

## 9. Atualização e rollback

Atualização:

```bash
helm upgrade nodeaccess charts/nodeaccess \
  --namespace nodeaccess \
  -f nodeaccess-values.yaml \
  --atomic --wait --timeout 10m
```

Histórico e rollback:

```bash
helm history nodeaccess -n nodeaccess
helm rollback nodeaccess REVISAO -n nodeaccess --wait --timeout 10m
```

O rollback dos Deployments não desfaz automaticamente migrações de banco.
Antes de uma atualização relevante, valide compatibilidade e mantenha backup
do MySQL.

## Referências internas

- chart: `charts/nodeaccess`;
- exemplo: `charts/nodeaccess/values-production.example.yaml`;
- operação do SSO: `docs/SSO-operations-runbook.md`;
- certificação de provedores: `tools/oidc/README.md`.
