# VaultNAccess — sessão isolada e entrega por operação (NA-0178)

## Estado e limites

NA-0178 implementa o backend do piloto portal/local; NA-0179 adiciona revelar/copiar no portal sob os mesmos pré-requisitos. Extensão, autofill, WebAuthn/Windows Hello, bridge e E2EE continuam em fases posteriores. Não há pacote de extensão ou armazenamento offline. JWE acrescenta proteção de aplicação; o servidor continua conhecendo segredos operacionais. Nenhum tenant/item existente ganha permissão de extração com a migração.

Pré-requisitos para ativação: validações da frente aprovadas, homologação do piloto, HTTPS e proxy confiável corretamente configurados, tenant comercial com licença Secrets, contas locais com senha e TOTP ativos, dois gestores distintos, dados de teste e quota acordada. Trial, login externo/SSO/break-glass, tenant delegado, PEM e fill são recusados neste piloto. Reautenticação local é opção explícita prevista no contrato, não fallback automático de uma falha WebAuthn. Não foi realizada prova Windows Hello nesta frente.

## Implantação e configuração inicial

Aplicar a migração aditiva pelo processo normal de release (`npm run db:deploy`), após backup e ensaio. Gerar cliente Prisma no build normal. Não executar `db push` em produção. O bootstrap usa `DATABASE_URL` disponibilizada pelo ambiente protegido de implantação; não colocar credenciais na linha de comando ou no histórico.

O operador de implantação cadastra dois gestores locais ativos e distintos. O comando abaixo é **dry-run**; os IDs são exemplos e devem ser substituídos pelos responsáveis aprovados:

```sh
node tools/vault-security/manage.mjs bootstrap '{"tenantId":5,"origin":"https://nodeaccess.example","managerIds":[31,42],"allowLocalReauthentication":true}'
```

Após revisão do tenant/origem/responsáveis e gates, repetir com `--apply`. Não há ativação automática: reveal/copy ficam false; nenhum entitlement ou item elegível é criado. O operador de banco continua sendo uma autoridade privilegiada de implantação; o bootstrap é auditado como `DEPLOYMENT_BOOTSTRAP` com actor0 e IDs dos gestores, e deve ser correlacionado ao registro humano da implantação. IDs não substituem aprovação humana. O bootstrap recusa reconfigurar um tenant já inicializado.

Cada gestor passa por autenticação central, bootstrap próprio e senha+TOTP. Um propõe e o outro aprova dentro da validade da proposta (`proposalSeconds` da política, 120 s a 24 h, padrão 120 s; NA-0188); o beneficiário não pode ser nenhum dos dois atores na concessão. Depois do bootstrap, gestores são incluídos ou retirados pelo portal com a mudança `manager`, pela mesma regra de dois gestores: ninguém propõe nem aprova a própria gestão, e uma proposta é recusada (`VAULT_NO_APPROVER`) quando não resta gestor ativo além de quem propõe e de quem é afetado — por isso retirar um gestor exige pelo menos três e o tenant sempre mantém pelo menos dois. ADMIN/superadmin não promovem gestores sozinhos (o administrador cria contas e redefine senha/TOTP). Retirar um gestor apaga as propostas abertas dele; reduzir a validade encurta as propostas abertas. Atenção: desativar ou excluir contas de gestores na guia Usuários reduz os gestores ativos fora dessa regra; se restarem menos de dois, a administração do cofre fica parada até reativar as contas ou refazer o bootstrap pelo operador. A permissão explícita está em `vault_managers`, não decorre de ADMIN. Usuários/gestores são rechecados no tenant e sob locks. A configuração de reveal/copy, a elegibilidade de cada item e cada entitlement são mudanças independentes. Cada aprovação incrementa a geração e invalida todos os clientes/sessões/grants anteriores; fazer novo bootstrap/desbloqueio antes da próxima aprovação. Não editar diretamente grants/elegibilidade ou reutilizar versão para evitar invalidação.

## Contratos HTTP

Prefixo `/api/v1/vault-security`. Todas as rotas usam POST para que IDs e capacidades não apareçam em query/URL. Bearer central válido, HTTPS real e `Origin` exata configurada são obrigatórios. Proxy deve sobrescrever headers de forwarding e ser a única origem confiável conforme configuração existente; não habilitar confiança irrestrita em proxy para este recurso. Corpo até16KiB, campos desconhecidos rejeitados. Respostas no-store; erros do cofre não instruem logout global.

| Rota | Corpo | Resultado |
|---|---|---|
| `/clients` | `refreshToken` do portal | `clientId`, `expiresAt`; sem refresh/token central de resposta |
| `/sessions/challenges` | `{}` | `challengeId`, `expiresAt` |
| `/sessions/unlock` | `challengeId`, senha NodeAccess em `password`, TOTP em `token` | `sessionId`, `idleUntil`, `expiresAt` |
| `/sessions/current` | `{}` | Estado e prazos, sem renovar atividade |
| `/sessions/lock` | `{}` | LOCKED; idempotente para cliente já removido |
| `/operations` | `sessionId`, `action: reveal\|copy`, `secretId`, `recipient` | `operationId`, AUTHORIZED, `expiresAt`, `serverNow`, `context` autorizado completo |
| `/operations/consume` | `sessionId`, `operationId` | `envelope` JWE somente após consumo e auditoria |
| `/operations/status` | `operationId` | Apenas estado |
| `/operations/cancel` | `operationId` | CANCELLED ou estado terminal; não reabre consumo |
| `/administration/proposals` | `sessionId`, `change` | `proposalId` |
| `/administration/approve` | `sessionId`, `proposalId` | APPLIED e geração invalidada |

Após `/clients`, enviar `x-vault-client: clientId` nas chamadas. Guardar clientId/sessionId somente em memória da instância privilegiada. O backend guarda digests das capacidades e referências internas; não persistir esses valores no frontend. O refresh token é validado somente pelo backend no bootstrap portal e não entra no storage do cofre. Não usar este contrato para registrar extensão: o handoff PKCE/posse/dispositivo tem gate próprio.

`change` é união estrita:

- `{kind:"grant", userId, action:"reveal"|"copy", enabled:boolean}`;
- `{kind:"item", secretId, enabled:boolean}`;
- `{kind:"policy", reveal:boolean, copy:boolean, tenantQuota:1..300}`.

403 nega contexto/ação sem enumerar existência do item; 409 operação indisponível/consumida; 423 cofre/origem bloqueado ou prova desatualizada; 429 quota; 503 dependência indisponível/ocupação. 401 pertence ao guard central. Sem retry automático de consume: timeout/resposta perdida podem significar operação consumida. Criar operação nova somente após gesto e nova autorização.

## Sessão, criptografia e concorrência

Instância cliente e sessão duram no máximo30min, limitadas pela origem central. Idle5min; desafio120s uso único; reveal/copy/admin exigem prova de até60s; grant até30s e nunca ultrapassa prazos de origem, cliente, sessão, prova e licença. Licença inativa/expirada nega; vencimento durante selagem/commit também impede a resposta. GET/status/polling não renovam atividade. Não existe sessão do cofre global nem dependência de cofre no resolvedor operacional. Reautenticação verifica senha+TOTP fora da transação e revalida o snapshot de credenciais sob lock antes de desbloquear.

Destinatário: JWK **somente público** `{kty:"RSA",n,e:"AQAB"}`, módulo2048–4096bits, gerado para a operação. Envelope compacto JWE v1 via `jose` existente: `RSA-OAEP-256` e `A256GCM`. O protected header contém `typ: vaultnaccess+jwe` e `vault` com versão, operação, tenant/usuário, digest da instância, ação, item, snapshot do item, thumbprint destinatário, geração, expiração e origem. O cliente compara todo o contexto autorizado retornado por `/operations` e valida também a intenção local (usuário, tenant, ação, item, digest da instância, destinatário e origem) após autenticar/descriptografar; rejeitar algoritmo/contexto/expiração divergente. Nenhum key URL/JWKS remoto ou algoritmo indicado pelo cliente é aceito. Limite do segredo8KiB, sem truncamento. Não há promessa de zeragem física de strings/memória JS.

SQL usa locking reads de tenant, usuário, licença, política local, registro trial, política do cofre, entitlement, item/elegibilidade e associação de grupo usada. Writers operacionais normais disputam esses mesmos locks; não precisam chamar VaultNAccess. Snapshot inclui ciphertext/IV e ACL, sem depender só de timestamps. Consumo e evento `DELIVERY_RELEASE_COMMITTED` ficam na mesma transação; o evento significa autorização consumida, não confirmação de visualização. Sem auditoria durável, não há envelope. Não há publicação best-effort obrigatória para confirmar a entrega: `vault_audit` é o ledger durável, disponível para integração de relatórios posterior.

O refresh Redis só passa de presente para ausente/expirado; refresh não recria jti e cada login gera novo UUID. O delivery verifica a referência antes e **depois** do commit SQL, e prazo depois da selagem/commit. Ausência/erro pós-commit nega o envelope e mantém operação consumida. Sob essa monotonicidade, presença pós-commit comprova que logout não venceu antes do consumo; não se afirma transação distribuída. Na administração, a última checagem Redis ocorre dentro da transação após todas as decisões/escritas provisórias e locks, antes do commit; logout anterior a esse ponto causa rollback. Logout posterior pode permitir a configuração já autorizada concluir. Desativação SQL e remoção dos gestores continuam serializadas pelos locks.

Restauração/failover que ressuscite chaves Redis rompe a hipótese de monotonicidade: manter delivery desativado durante recuperação e revogar sessões centrais/clientes antes de reabilitar. Não reutilizar jti nem restaurar sessões como se estivessem novas. Rotação da senha no destino é necessária para invalidar uma senha anteriormente revelada.

## Limites, auditoria e manutenção

Até4 requisições em execução por processo, sem fila adicional; transação maxWait500ms/timeout2500ms; consulta da origem Redis500ms. Limites SQL compartilhados:10clientes/hora/usuário,5desafios/5min/usuário,30requests/min/usuário,5operaçõespendentes/cliente e quota tenant explícita. Tentativas de autorização negadas debitam a quota de request. Usuário bloqueado/tenant desabilitado/política off nega antes de resolver segredos. Compartilhamento de DB/Redis ainda permite contenção: estes limites não são prova de ausência de qualquer impacto sob carga.

Ledger registra configuração, desbloqueio/bloqueio, autorização, consumo e cancelamento sem senha, ciphertext, token ou assertions. Aprovação registra proposta/alteração, proponente e ator aprovador. Negativas de operação são limitadas a5eventos/min/usuário; ausência de capacidade de auditoria diagnóstica não transforma negação em aprovação. Eventos de liberação/configuração continuam obrigatórios e transacionais. O tratamento de logout central foi corrigido para não esconder erro de Redis como se fosse token inválido.

Executar manutenção fora do caminho de API/gateway, inicialmente em dry-run:

```sh
node tools/vault-security/manage.mjs maintenance
node tools/vault-security/manage.mjs maintenance --apply
```

Cada execução remove até1000registros expirados e1000propostas expiradas; ajustar periodicidade ao piloto e monitorar backlog. Nunca apaga `vault_audit`; retenção segue política existente. Auditoria de produção não deve ser copiada para evidências públicas.

## Desativação e rollback

`node tools/vault-security/manage.mjs disable <tenantId>` valida em dry-run; `--apply` desliga unlock e incrementa geração, com evento durável. A limpeza remota de um cliente já revogado/política off pode retornar negação; descartar estado local e respeitar TTL. Não faz logout central, nem toca terminal, snippets, SSH/RDP ou o ciphertext operacional. Reativação após desativação de emergência exige nova revisão de implantação/política e incremento de geração; não reusar concessões antigas.

Rollback de código remove registro de rotas/módulo, preserva tabelas de auditoria e dados existentes. Não executar downmigration destrutiva nem restore automático. Não há deploy/habilitação de tenant autorizado implicitamente por esta documentação.

## Referências e validação

[JWE RFC7516](https://www.rfc-editor.org/rfc/rfc7516.html) e [jose CompactEncrypt](https://github.com/panva/jose/blob/main/docs/jwe/compact/encrypt/classes/CompactEncrypt.md). Escolha de JWE substitui o candidato HPKE para este piloto aproveitando biblioteca já instalada; não se afirma que os protocolos sejam idênticos. Evidências e limites da implementação: [NA-0178](changes/2026/11/NA-0178-vault-delivery/implementation.md). Compatibilidade Windows, UI e extensão permanecem Planned.

Ensaio reproduzível: `npm run test:vault:real` cria MySQL/Redis próprios em loopback, usa schema base+migração real, aplica somente dados sintéticos e remove os contêineres no finally. Exige Docker e imagens locais fixadas; não aponta para banco de desenvolvimento/produção. Resultado sanitizado e fingerprint em `.tmp/NA-0178/mysql-*/execution.json`.

## Isolamento de recursos e contexto de autorização

O cofre usa um PrismaClient próprio, criado somente no primeiro acesso à API, com connection_limit=2 e pool_timeout=1 por réplica. Seu fechamento desconecta apenas esse pool. O limite de quatro operações admitidas e os timeouts SQL/Redis reduzem contenção; MySQL e Redis continuam recursos compartilhados e não há garantia de isolamento total de CPU ou locks. Nenhum pool adicional é aberto pelo gateway sem acesso ao cofre.

Se a validade da licença for encurtada após a autorização, a entrega retorna conflito antes de descriptografar ou selar. Uma nova autorização é necessária: o contexto criptográfico autorizado nunca é alterado silenciosamente.

## Portal — NA-0179

HTTP do cofre usa Bearer capturado e contrato próprio sem interceptors de refresh/retry/reloadglobais. 401 descarta estado local e orienta renovação da autenticação; não encerra terminal automaticamente. Os demais erros ficam na janela. Respostas limitadas durante streaming e timeout de 8s; perda da resposta não reabre consumo.

`serverNow` acompanha registro, desafio, desbloqueio, status e autorização. O portal calcula prazos a partir do início local da requisição, desconta margem de1s, usa relógio monotônico e limite adicional de relógio civil; movimento regressivo do relógio não prolonga a autorização. Não há heartbeat de renovação. Novo desbloqueio pode reutilizar cliente ainda válido; lock/saída/blur remove o cliente em melhor esforço com contexto original. A quota10clientes/h permanece e pode limitar alternância frequente de telas.

Cada operação gera chave RSA2048 privada nãoexportável em memória. Capabilities e valores não vão para Pinia, catálogo ou armazenamentooffline. Reveal aparece por até15s; copy aguarda gesto separado sem exibir plaintext. Falha/expiração descarta o buffer, sem fallback que coloque senha no DOM. O SO pode já ter aceitado uma escrita quando o contexto é cancelado; não há promessa de reversão ou limpeza automática da área de transferência.

Manual do operador: `docs/manual/hosts.md`. Harness HTTPS: `npm run test:vault:frontend` (`tools/vault-security/frontend-harness.mts`), com Fastify/bcrypt/TOTP/JWE reais e autoridade/Redis sintéticos; não substitui ensaio MySQL/Redis da camada backend nem homologação humana. Nenhum dado ou tenant real é utilizado.
