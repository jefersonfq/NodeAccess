---
change_id: NA-0015
title: SSO corporativo e instalação Kubernetes via Helm
type: discovery
status: passed
created_at: 2026-08-10T10:25:00-03:00
base_branch: feature/NA-0014-20260809-terminal-experience-reliability
base_sha: 87c9720
branch: feature/NA-0015-20260810-sso-helm-evaluation
owner: codex
planner: codex
risk: high
issue: null
---

# NA-0015 — SSO corporativo e Helm

## Diagnóstico atual

- O produto já possui login local, LDAP e Google SSO/Workspace.
- `apps/backend/src/modules/auth/identity-provider.ts` antecipa tipos `oidc` e `saml`, mas ainda não há implementação genérica desses protocolos.
- O Google atual é específico do fornecedor e valida ID token por endpoint próprio; não constitui uma camada OIDC reutilizável.
- Não existe chart Helm/Kubernetes. O `docker-compose.yml` separa MySQL, Redis, guacd, API e SSH gateway, oferecendo uma base de topologia.
- O mapa detalhado do fluxo de entrada, riscos e propriedade das configurações está em `auth-entry-policy-map.md`.

## Recomendação SSO

Implementar primeiro um provedor **OIDC genérico**, usando Authorization Code com PKCE, discovery `/.well-known/openid-configuration`, validação de `issuer`, `audience`, assinatura/JWKS, `state`, `nonce` e expiração. Isso cobre Microsoft Entra ID, Okta, Keycloak, Auth0 e outros IdPs compatíveis sem criar integrações específicas.

Configuração por tenant:

- nome e estado do provedor;
- issuer/discovery URL;
- client ID e client secret cifrado;
- redirect URI calculada e exibida para cópia;
- scopes (`openid profile email` por padrão);
- mapeamento configurável de `subject`, e-mail, nome e grupos;
- domínio permitido, JIT provisioning e grupo/papel inicial;
- opção de exigir SSO, preservando conta local administrativa de emergência;
- eventos de auditoria e revogação/desativação previsíveis.

Fases sugeridas:

1. OIDC genérico + Entra ID, Okta e Keycloak como matriz certificada.
2. Mapeamento de grupos e política de MFA delegada ao IdP.
3. SCIM 2.0 para provisionamento/desativação; manter Google Directory como adaptador legado durante migração.
4. SAML 2.0 somente se demanda comercial concreta exigir clientes legados.

## Recomendação Helm

Criar `charts/nodeaccess` com:

- Deployments separados para API e SSH gateway; frontend/ingress separado quando a imagem de release exigir;
- Services distintos para HTTP, WebSocket e gateway;
- Job de migration Prisma com hook controlado e política de retry;
- ConfigMap para configuração não sensível e referência a Secret existente por padrão;
- Ingress configurável, TLS, WebSocket e timeouts de sessões longas;
- probes de startup/readiness/liveness específicas por processo;
- resources, autoscaling, affinity, tolerations, topology spread, PDB e NetworkPolicy configuráveis;
- ServiceAccount sem privilégios por padrão e `securityContext` restritivo;
- MySQL e Redis externos como padrão de produção; subcharts opcionais apenas para avaliação/desenvolvimento;
- guacd opcional e isolado, habilitado quando acesso gráfico estiver licenciado;
- `values.schema.json`, `NOTES.txt`, exemplos de values e testes `helm lint`/render.

API e gateway são stateless e devem usar Deployment. Bancos embutidos, quando habilitados para ambiente não produtivo, precisam de StatefulSet/PVC por meio de dependências mantidas, não templates stateful próprios sem necessidade.

## Critérios de aceite da futura implementação

- Login OIDC testado contra Entra ID, Okta e Keycloak, com isolamento por tenant.
- Não há token, secret ou claim sensível em logs.
- JIT, usuário desativado, domínio inválido, `state`/`nonce` inválidos e rotação JWKS têm testes.
- Helm instala, atualiza e faz rollback em cluster efêmero; `helm lint` e render de valores mínimos/produção passam.
- WebSocket SSH permanece estável atrás do Ingress e durante rollout.
- Migration executa uma vez e falha de forma observável, sem iniciar API incompatível com o schema.

## Riscos principais

- SSO obrigatório sem conta break-glass pode bloquear todo o tenant.
- Claims de grupos variam por IdP e podem exceder o token; mapeamento não deve assumir formato único.
- Escalar gateway durante sessões exige afinidade ou estratégia explícita de drenagem; Redis não substitui o socket SSH vivo.
- Ingress com timeout baixo encerra terminal silenciosamente.
- Subcharts de banco habilitados por padrão criariam uma expectativa de produção que o chart não deve assumir.

## Referências

- Microsoft Entra OIDC: https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols-oidc
- Helm chart best practices: https://docs.helm.sh/docs/chart_best_practices/
- Kubernetes workloads: https://kubernetes.io/docs/concepts/workloads/controllers/
- Kubernetes security: https://kubernetes.io/docs/concepts/security/

## Decisão proposta

`GO` para discovery técnico detalhado e spike de OIDC genérico + skeleton Helm. Não implementar SAML nem bancos embutidos de produção na primeira entrega.

Antes do adaptador OIDC, executar a primeira etapa do mapa de entrada: resolver o tenant sem fallback ambíguo e somente então apresentar os provedores disponíveis.

## Implementação iniciada

- Resolução de tenant alterada para falhar fechado quando o slug não existir.
- Google SSO passou a ser consultado e apresentado somente depois da escolha do tenant no fluxo `email-first`.
- Slug selecionado passa a acompanhar tanto a consulta da configuração quanto o login Google.
- Quando o e-mail ainda não possui vínculo, o tenant pode ser resolvido pelo hostname/proxy para preservar JIT provisioning, sem fallback de slug inválido.
- Adicionado resolvedor puro de política efetiva com precedência da instalação, defaults compatíveis e limites para MFA, JIT, linking, descoberta, lockout e TTLs.
- Persistência e aplicação dessa política permanecem deliberadamente desacopladas até o contrato estar coberto por testes.
- Criada persistência `TenantAuthPolicy` e API administrativa `GET/PUT /api/v1/tenant-auth-policy`, com retorno separado entre valores solicitados e efetivos e auditoria de alterações.
- A API sinaliza `enforcementEnabled=false`; ativar a política no login continua bloqueado até existir provedor OIDC e break-glass completo.
- Iniciado adaptador OIDC genérico com discovery HTTPS estrito, Authorization Code + PKCE, `state`, `nonce`, allowlist de algoritmos e validação de assinatura/issuer/audience via JWKS.
- Adicionada configuração administrativa OIDC por tenant em `GET/PUT /api/v1/integrations/oidc`; client secret é cifrado e omitido da resposta e auditoria.
- Adicionada transação OIDC interna de cinco minutos no Redis, consumida atomicamente por `GETDEL`, com troca de código e verificação do ID token.
- Adicionado vínculo `ExternalIdentity` por `tenant + issuer + subject`; e-mail serve apenas para linking/JIT governado, nunca como chave da identidade externa.
- O índice MySQL de identidade usa hashes SHA-256 fixos de issuer/subject, preservando os valores completos e evitando o limite de 3072 bytes do `utf8mb4`.
- Publicados discovery, início e conclusão do login OIDC; o callback troca `code/state` via POST e nunca transporta tokens na URL.
- JIT, linking automático e descoberta por e-mail possuem gates globais da instalação; defaults permanecem conservadores (`false`, `false`, `true`).
- Criado skeleton `charts/nodeaccess` para API, gateway, migration hook, Services, Ingress, PDB, NetworkPolicy e guacd opcional; MySQL/Redis permanecem externos.
- Adicionado target frontend `prod-k8s` HTTP/rootless e configurável por upstream, sem alterar o target Docker `prod`; o chart pode habilitá-lo explicitamente.

## Encerramento

Discovery encerrado pelas entregas incrementais NA-0017 a NA-0030. OIDC genérico,
política, break-glass, MFA delegado, sessão, segurança de entrada, observabilidade,
mapeamento de grupos e certificação Helm/kind estão implementados e testados.
Login interativo Entra/Okta permanece uma homologação externa condicional a
tenants controlados, sem bloquear o encerramento técnico desta frente.
