# Operação do SSO OIDC

## Pré-requisitos de métricas

No Helm chart, defina `config.FEATURE_METRICS: "true"` e mantenha um
`METRICS_TOKEN` forte no Secret indicado por `existingSecret`. O
`ServiceMonitor` usa esse Secret diretamente; o token não é copiado para
ConfigMap ou manifesto renderizado.

Os recursos `ServiceMonitor` e `PrometheusRule` são opcionais e permanecem
desativados por padrão para instalações sem Prometheus Operator.

## Alertas

### NodeAccessOidcDiscoveryFailures

1. valide DNS e TLS entre o pod da API e o issuer configurado;
2. consulte o documento `/.well-known/openid-configuration` do IdP;
3. confirme issuer exato, endpoints HTTPS e algoritmos aceitos;
4. não desative a validação TLS ou altere issuer para contornar a falha.

### NodeAccessOidcTokenValidationFailures

1. valide a disponibilidade do `jwks_uri` publicado no discovery;
2. confirme rotação das chaves e propagação do novo `kid`;
3. revise issuer, audience, nonce e relógio dos nós;
4. mantenha o login local de emergência conforme a política break-glass.

### NodeAccessOidcLoginOperationalErrors

1. valide Redis e saúde da API;
2. verifique disponibilidade e latência do endpoint de token do IdP;
3. correlacione com os dois alertas anteriores e logs sanitizados;
4. rejeições esperadas de domínio, vínculo ou política não acionam este alerta.

## Segurança

As métricas não incluem tenant, issuer, e-mail, subject, claims, códigos ou
tokens. Não adicione esses valores como labels: além do risco de exposição,
eles causam cardinalidade não controlada no Prometheus.
