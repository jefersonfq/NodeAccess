# VaultNAccess — contrato de segurança v1

## 1. Status, limites e precedência

Este é o contrato de engenharia para implementação futura, definido na NA-0177. Não cria endpoints nem ativa revelação. Substitui ambiguidades dos adendos da NA-0175 sobre sessão, permissões e consumo; o [parecer híbrido](../NA-0175-cofre-extensao/hybrid-delivery-review.md) continua regendo criptografia e isolamento operacional. Nomes de campos/rotas abaixo são contratos propostos v1, sujeitos apenas à adequação de convenções na implementação, sem relaxar as invariantes.

A fase 1A permite catálogo/gerenciamento de metadados e entrada de novos valores. Ela não concede leitura de valores salvos. A finalidade deste contrato é impedir que a futura extensão transforme autorização de uso backend em autorização de extração.

As decisões e números abaixo são escolhas conservadoras desta frente, não valores prescritos pelas fontes nem política já aplicada aos tenants. A implementação deverá versionar a política e apresentar seus efeitos antes de habilitar o recurso.

## 2. Fronteiras e garantias

- A autenticação central continua autoridade de identidade, tenant, atividade e revogação. Uma sessão do cofre nunca prolonga ou recria acesso central revogado.
- Lock/expiração/revogação **do cofre** não faz logout central, não fecha terminal, não altera SSH/RDP/WebSocket, não interrompe snippets ou consumidores server-side existentes. Logout/revogação central legítimos mantêm seu comportamento atual.
- Gateway, SecretService.resolveValueById/resolvePlaceholders e resolvedores PEM não passam pelo delivery. Nenhum heartbeat de cofre entra na cadeia operacional.
- Portal e extensão obedecem às mesmas políticas de negócio, mas têm autorizações, instâncias e desbloqueios independentes. Desbloquear um cliente não desbloqueia o outro.
- O backend conhece segredos operacionais. Entrega cifrada por operação não é E2EE. E2EE por categoria é outro projeto; não migrar chaves operacionais implicitamente.
- XSS no portal, extensão comprometida, malware local, captura de tela/clipboard e página maliciosa após autofill continuam ameaças residuais. Criptografia não prova integridade do navegador ou do DOM.
- Sem armazenamento offline de valores, exportação em massa ou extração de PEM/passphrase no piloto. Cadastro de dispositivo prova vínculo/posse conforme mecanismo aprovado, não atestação de hardware.

## 3. Inventário e arquitetura limpa

Inventário na base indicada em plan.md:

| Existente | Reuso permitido | Limite |
|---|---|---|
| AuthService.refresh, sessionVersion e revogação | Adaptador read-only de contexto central e validade | Não reutilizar refresh token no plugin nem alterar guards globais |
| SecretService.assertAccessibleById e resolvedores | Autorização básica e leitura interna após decisão completa | Acesso operacional não implica reveal/copy/fill |
| SecretPublicSchema e listagem atual | Metadados públicos | Nunca acrescentar value/ciphertext/chaves à listagem |
| PemKeyService | Cadastro/uso backend atual | PEM permanece inelegível para delivery nesta versão |
| Auditoria existente | Integração por adaptador e consumidor/outbox | Não copiar comportamento best-effort para novas entregas |

Domínio sem dependência de Vue, Fastify, Redis ou ORM: VaultSession, VaultPolicy, VaultDevice, VaultOperation e serviços de decisão. Casos de uso separados: RegisterClient, UnlockVault, LockVault, RequestOperation, ConsumeOperation, RevokeDevice. Ports: IdentityContext, EntitlementPolicy, SecretReader, SessionStore, DeviceStore, OperationStore, AtomicAuditCommit, EnvelopeSealer, Clock e EntropySource. Controladores somente validam DTO/contexto e invocam casos de uso; componentes/worker não decidem autorização final.

Adapters de banco/Redis/cripto são substituíveis e injetados. SecretReader não exporta acesso genérico à descriptografia. Política é uma função de contexto autoritativo, ação e item; testar separadamente da persistência. Não criar serviço genérico com responsabilidades de sessão, criptografia, DOM e gateway misturadas.

## 4. Identidade, bootstrap e dispositivos

`clientKind = portal | extension`; `clientInstanceId` é emitido pelo servidor, vinculado a tenant, usuário e cliente. `deviceId` identifica registro lógico; é obrigatório para extensão e não é fingerprint invasivo do computador. Portal usa uma instância de aba/documento, sem alegar identidade física. IDs enviados pelo cliente não substituem o vínculo autenticado.

A extensão é cliente público, sem client secret embutido. Login/consentimento ocorre em página confiável do NodeAccess; senha central, PIN do Windows e refresh token do portal nunca são copiados para popup/content script. O handoff utiliza código opaco de uso único com PKCE S256, state imprevisível e redirect URI exata previamente cadastrada; bind de tenant, usuário, clientInstance, extension ID e chave de dispositivo no registro server-side. Código: 60 s; troca atômica; um código interceptado não libera sessão sem verifier e prova exigida. Não usar implicit flow nem retornar tokens em URL. TLS e consentimento não atestam a extensão; identidade de instalação/pacote é gate do piloto.

A autorização de cliente retornada pelo exchange é uma credencial opaca independente da sessão do cofre, com 30 min de validade absoluta, limitada também ao prazo da sessão central de origem. No piloto não há refresh dessa autorização: expiração exige novo handoff/consentimento; sessão central válida pode ser reutilizada pelo portal, mas não dispensa o step-up exigido para desbloquear. Armazenar a credencial somente em memória do contexto privilegiado, nunca em content script, URL, localStorage, IndexedDB ou disco. Perda/reinício do worker elimina a credencial e exige novo bootstrap. Metadados não secretos de configuração/deviceId podem persistir. Este piloto implica desbloqueios mais frequentes quando o navegador suspende o worker; melhoria de conveniência é evolução explícita, não justificativa para persistir credenciais sem revisão.

O registro autoritativo associa essa autorização a `originSessionRef`, uma referência revogável à sessão central específica que consentiu, além de sessionVersion/tenant/user/client/device e prazos. Cada consumo verifica a validade atual dessa referência; logout daquela sessão central invalida as autorizações derivadas, sem depender só de expiração do JWT ou entrega de evento. A implementação precisa demonstrar a correspondência com o registro real de sessão/refresh atual e o ponto de revogação do logout. Se essa referência não existir ou não puder ser consultada/serializada, o bootstrap/delivery permanece desabilitado; não tratar sessionVersion global isoladamente como prova de logout de uma sessão. Nenhuma credencial de origem é enviada à extensão. O logout central não passa a chamar o delivery para funcionar; o delivery consulta o estado autoritativo de origem por adaptador. A autorização cliente não pode ser renovada por uma sessão do cofre, nem o inverso.

Dispositivo: PENDING → ACTIVE → REVOKED; PENDING expira em 10 min. Ativação exige autenticação central, step-up fresco e consentimento explícito. Rotação de chave cria novo vínculo validado; a chave anterior é revogada, sem janela silenciosa de aceitação. Reinstalação/troca de perfil exige novo registro. Dispositivo revogado não pode ser reativado por refresh; novo cadastro requer nova cerimônia. Usuário pode revogar seus dispositivos; administração usa permissão específica e trilha de auditoria.

Prova de posse de dispositivo deve usar protocolo mantido e revisado (candidato DPoP/OAuth quando aplicável), com nonce, audience, método/URI e replay verificados; não inventar assinatura customizada. Escolha final e interoperabilidade são gates do item 3. O contrato não promete sender-constraining antes dessa prova existir. Registro com chave exportável não garante TPM; passkey sincronizada não equivale a vínculo de hardware.

## 5. Sessões e desbloqueio

Estado: LOCKED → CHALLENGE_PENDING → UNLOCKED → LOCKED; EXPIRED e REVOKED são terminais para aquele identificador. Nova cerimônia emite novo identificador opaco aleatório (256 bits de entropia), armazenado no servidor como digest. A sessão é vinculada ao contexto central, tenant, usuário, clientInstance, device quando aplicável, método/prova de step-up, versões de política e revogação. O identificador sozinho não é autorização: toda operação exige também contexto central e vínculo do cliente válidos. Armazenamento indisponível nega operação sensível.

A API não deve tratar expiração do cofre como 401 da autenticação central: usar erro de domínio 423 VAULT_LOCKED/EXPIRED. O adaptador do cliente não chama logout ou refresh global em resposta a esse erro. Uma falha central real continua seguindo os fluxos centrais existentes.

Política inicial do piloto:

| Parâmetro | Valor | Semântica |
|---|---|---|
| Inatividade | 5 min | Servidor calcula; polling/status não renovam |
| Duração absoluta | 30 min | Não é estendida por atividade/refresh |
| Desafio de desbloqueio | 120 s | Uso único; vinculado à sessão/instância/contexto |
| Prova fresca para reveal/copy e administração de dispositivo | 60 s | Exige novo step-up se prova mais antiga |
| Autorização por operação | 30 s | Nunca ultrapassa a validade da sessão ou prova |
| Exibição do valor | Até 15 s | Ocultar antes em blur/lock/troca de contexto |
| Background/fechamento observado | Limpeza local imediata; lock remoto best-effort | Cerimônia e fill têm sequência explícita abaixo; manter sessão central |

Para fill, a prova do desbloqueio continua elegível somente enquanto aquela sessão permanece válida (inatividade e duração absoluta); não se aplica freshness de 60 s. Reveal/copy/admin exigem prova recente com idade máxima de 60 s. O vencimento de cada grant é o mínimo de agora+30 s, validade da autorização cliente/origem, sessão e janela da prova exigida pela ação. Uma prova de step-up vinculada à operação não se reutiliza em outra operação; a prova de desbloqueio admite operações distintas apenas conforme a política acima.

Ações sensíveis autorizadas renovam somente o relógio de inatividade; status, listagem e heartbeat não mantêm cofre aberto. Cliente pode bloquear antes; nunca estender prazos do servidor. Tempo autoritativo do servidor, sem tolerância que aceite grant expirado. Dois relógios cliente/servidor são tratados conservadoramente. Reinício/suspensão do worker perde estado e bloqueia; não persistir chave efêmera para recuperar operação.

Lock explícito confirmado pelo servidor invalida sessão, desafios e grants pendentes daquele cliente no ponto de commit. Portal: recarregar/fechar aba, troca de tenant/usuário, navegação para outro contexto ou ocultação causam descarte local quando observáveis. Extensão: suspensão/reinício do worker, alteração de perfil/tenant, revogação ou lock explícito descartam estado local; o servidor pode não receber o evento. Enviar lock/cancel é best-effort ao desaparecer o cliente: não existe garantia de invalidação remota instantânea por fechar aba/popup ou suspender worker. Sem recebimento, a autorização permanece no servidor até expiração/revogação; grants já emitidos podem persistir até 30 s, e a sessão até seus prazos autoritativos. A posse de credencial/chave roubada nesse intervalo permanece risco residual. Não entregar ao cliente reaparecido um resultado cuja operação perdeu o contexto/chave. Cancelar mensagens pendentes e limpar referências/DOM; descarte JS é melhor esforço, não garantia de zeragem física.

Sequência de UI normativa do piloto:

1. Portal normal: sessão pertence à instância da aba. Ocultação limpa valores e solicita lock. Desafio WebAuthn pendente não é sessão desbloqueada; diálogo nativo do autenticador pode mudar foco sem invalidar automaticamente a cerimônia. Troca de documento, usuário/tenant, prazo ou cancelamento explícito invalida o desafio. Resposta só é aplicada após retorno à mesma instância/contexto ativo.
2. Extensão inicia handoff em aba dedicada confiável. O worker retém apenas identidade da solicitação, state/verifier e desafio pendente, sem sessão desbloqueada nem valor. Fechar o popup ao abrir essa aba não cancela sozinho o desafio. O servidor autoriza o retorno apenas para a instância/solicitação originalmente vinculadas. Se worker suspender/perder contexto, recusar o retorno e reiniciar bootstrap; não reconstruir verifier/token persistido.
3. Após step-up, a aba de consentimento não desbloqueia o cofre do portal. Ela emite somente resultado/código de uso único vinculado à instância da extensão. O exchange de bootstrap continua emitindo somente autorização cliente com cofre LOCKED. O worker verifica o retorno; quando uma superfície da extensão voltar a estar ativa por gesto explícito, a transição validada por /sessions/unlock, com prova vinculada, pode emitir/aplicar a sessão desbloqueada. O código de bootstrap sozinho nunca desbloqueia o cofre. Código vence em 60 s e não contém segredo. Sem retorno ativo, não há reveal/fill automático.
4. Reveal/copy ocorrem no popup ativo. Fechar popup descarta valor e solicita lock. Fill começa com gesto explícito no popup e fixa aba/frame/documento de destino antes da solicitação; o worker pode concluir **somente essa operação** durante a transição do popup para a aba de destino, dentro de 30 s e sem mudar contexto. Isso não é sessão aberta em background para novas operações. Navegação, foco em outra aba, erro, deadline ou perda do worker cancelam localmente e solicitam cancel/lock. Terminou o fill, limpar estado e solicitar lock; não auto-submit. Permissões de browser necessárias para observar esses eventos precisam de prova no piloto.
5. Se o cliente desaparecer durante consume, o servidor aplica a regra atômica normal: antes do commit, cancelar pode vencer; após o commit, não reabrir operação e não prometer revogação do conteúdo que já saiu. A UI não repete o preenchimento automaticamente.


Preferência de step-up: WebAuthn com userVerification=required na origem HTTPS do portal e RP ID aprovado, desafio server-side único. Windows Hello pode atuar como autenticador conforme compatibilidade; servidor valida challenge, RP ID, origin exata, assinatura, UP/UV, usuário e credencial. Não recebe PIN/biometria. signCount é sinal conforme tipo de autenticador, não único critério para aceitar/rejeitar passkeys sincronizadas. Cadastro/recuperação de autenticador exigem autorização fresca e auditoria.

Fallback aprovado por política pode usar reautenticação central completa (senha NodeAccess + MFA aplicável, ou step-up do IdP com assurance verificável). SSO sem prova recente suficiente não desbloqueia por mera sessão existente. Não usar senha do Windows nem TOTP isolado como substituto automático. Sem método elegível, manter bloqueado e oferecer recuperação; não reduzir assurance por indisponibilidade do WebAuthn. Recuperação nunca revela segredos; invalida sessões/grants/dispositivos afetados e exige fluxo central aprovado.

## 6. Permissões e elegibilidade

Decisão efetiva = identidade central válida ∧ tenant ativo/licenciado ∧ ACL atual do item ∧ entitlement específico da ação ∧ item elegível/ativo ∧ política vigente ∧ sessão/cliente/dispositivo válidos ∧ step-up exigido ∧ flag habilitada. Default deny. Usuário/tenant/roles no body são rejeitados ou ignorados como autoridade; admin e proprietário não recebem extração implicitamente.

| Ação | Sessão do cofre | Entitlement novo | Condição adicional |
|---|---|---|---|
| Catálogo/metadados existentes | Não exigida por esta camada | Nenhum novo | ACL/licença atuais permanecem |
| Cadastro/edição/rotação existentes | Preservar contratos atuais | Nenhum implícito | Não devolver valor antigo |
| Reveal web | Desbloqueada | vault.secret.reveal | Prova fresca; ação explícita |
| Copy web | Desbloqueada | vault.secret.copy | Prova fresca; consentimento de clipboard |
| Fill web | Desbloqueada | vault.secret.fill | Origem HTTPS permitida e gesto local |
| Uso SSH/RDP/snippet backend | Não | Nenhum novo | Autorizações operacionais existentes |
| Exportar PEM/passphrase/em massa | Negada | Não disponível no piloto | Projeto separado |
| Administrar política/dispositivo | Prova fresca | vault.policy.manage / vault.device.revoke | Não concede leitura de conteúdo |

Elegibilidade web é metadado aditivo explícito por item, com origens permitidas e versão; default false para todos os Secrets existentes. Não inferir por alias, host ou URL fornecida pelo cliente. Migração não converte credenciais operacionais para web automaticamente. Permissão de uso operacional não autoriza alterar elegibilidade; exigir permissão administrativa específica, step-up e auditoria. Política pode permitir criação pessoal web explicitamente; não derivar isso de proprietário por acidente. Grant de acesso sensível a si próprio por administrador exige aprovação independente conforme política corporativa, sem bypass de superadmin implícito.

## 7. Operações e fronteira com a entrega criptográfica

Estados: REQUESTED → AUTHORIZED → CONSUMED; terminais DENIED, EXPIRED, CANCELLED. Uma operação define exatamente uma ação (reveal, copy ou fill), um item tipado, uma versão, uma instância e um destino. Não converter fill em reveal nem reutilizar autorização entre clientes/tenants. GET/status nunca retorna segredo ou envelope.

Registro server-side contém operationId, contexto autoritativo, finalidade, versão do segredo/política/ACL/revogação, fingerprint da chave destinatária, prazo e origem normalizada quando fill. A chave destinatária efêmera é distinta da chave de dispositivo e da credencial WebAuthn. Contexto é imutável após autorização. Assinatura/AEAD/AAD e algoritmos concretos serão fechados no item 3; até lá, delivery real permanece desabilitado, sem fallback plaintext.

Na liberação: revalidar todas as condições e versões; preparar envelope em memória sem expor; realizar consumo atômico e auditoria durável; só então responder. Não segurar transação durante cerimônia MFA, chamada a IdP ou interação humana. Concorrência: somente um consumidor vence compare-and-set; perdedores recebem erro sem payload. Resposta perdida após consumo não permite segunda entrega do mesmo grant: usuário inicia operação nova validada. ACK cliente é informativo, nunca reabre concessão ou prova que o usuário recebeu o segredo.

Revogação/rotação/alteração de ACL versus consumo precisam de ponto de linearização único no storage autoritativo. A implementação deve compartilhar barreira transacional/versão com as mutações relevantes, incluindo desativação de usuário/tenant e sessionVersion; TTL/eventos Redis isolados não bastam. Se a revogação vencer, negar consumo; se consumo vencer, registrar que a entrega foi autorizada antes dela. Sem essa integração demonstrada por teste de corrida, flag de delivery permanece off. Adaptações de escritores existentes exigem revisão própria e não inserem chamada ao cofre no gateway.

Revogar bloqueia futuras liberações; não recupera plaintext/ciphertext/chave já entregue. Invalidar senha conhecida exige rotação no destino. Mudança de política endurece ou invalida sessões/grants existentes; não relaxa concessão já emitida. Eventos de revogação aceleram limpeza no cliente, mas servidor verifica estado atual em cada consumo, inclusive se evento foi perdido.

## 8. Contratos HTTP de referência

Prefixo proposto `/api/v1/vault-security`; rotas existentes `/secrets` e `/pem-keys` não passam a revelar dados. HTTPS obrigatório; política global TLS atual permanece intocada. Registrar capability de transporte por ambiente; não afirmar TLS 1.3 exclusivo sem teste de handshake.

| Método/rota proposta | Entrada principal | Saída pública / efeito |
|---|---|---|
| POST /clients/requests | clientKind, redirect cadastrado, PKCE challenge, chave pública | requestId e URL confiável de consentimento; sem token em URL |
| POST /clients/exchange | código, verifier, prova de cliente | Credencial de cliente em memória, validade absoluta até 30 min, sem refresh; sessão inicia LOCKED |
| POST /sessions/challenges | clientInstanceId, método elegível | challengeId, expiração e opções da cerimônia |
| POST /sessions/unlock | challengeId, prova | vaultSessionId, prazos e política efetiva; sem segredo |
| POST /sessions/lock | vaultSessionId | 204 idempotente; invalidar grants |
| GET /sessions/current | Contexto autenticado | Estado/prazos; não renova atividade |
| GET /devices | Contexto autenticado | Metadados mínimos de dispositivos próprios/autorizados |
| POST /devices/:id/revoke | motivo categorizado, prova fresca | 204 idempotente; revogar sessões/grants vinculados |
| POST /operations | sessionId, action, itemRef, recipientKey, destination | operationId, estado/prazo, step-up se necessário |
| POST /operations/:id/authorize | challengeId e prova quando exigida | Estado público; contexto original imutável |
| POST /operations/:id/consume | sessão, prova de posse quando exigida | Envelope v1 somente após commit; uma liberação |
| GET /operations/:id | Contexto autenticado | Estado público, nunca payload |
| POST /operations/:id/cancel | Contexto autenticado | 204; não reverte CONSUMED |

Todos os objetos rejeitam campos desconhecidos; IDs opacos, strings limitadas, enums fechados, chaves verificadas por algoritmo/versionamento. Limites iniciais: body 16 KiB, segredo entregue 8 KiB, até 20 origens por item; itens maiores falham explicitamente sem truncamento. Metadados não contêm senha, chave privada, token, verifier, assertion inteira ou URL com query/fragment.

Erros: 401 somente identidade central inválida; 403 ação/contexto não autorizado (sem enumerar item); 404 item/operação não visível, resposta uniforme; 409 OPERATION_UNAVAILABLE para consumo/replay/versão incompatível; 423 VAULT_LOCKED; 429 limite com Retry-After; 503 dependência indisponível. Falhas não devolvem stack, detalhe de ACL ou valor. Erro 409/timeout não dispara retry de consume com nova operação automaticamente.

Respostas sensíveis/estado: Cache-Control no-store, sem cache CDN/service worker; nunca GET com segredo, redirect com token ou logs de body. Proteção CSRF/Origin quando credenciais ambientais forem aceitas; CORS allowlist exata, sem wildcard credenciado. O browser/extension ID enviado não é autenticação. IDs/códigos não vão para analytics/referer. Cookies, caso usados no handoff, Secure/HttpOnly/SameSite adequados à cerimônia, com anti-CSRF explícito; não modificar cookies globais nesta frente.

## 9. Portal, extensão, origem e clipboard

Reveal em componente privilegiado do portal/popup, mascarado por padrão, gesto explícito, máximo 15 s. Ocultar ao perder foco/visibilidade; não persistir valor em store global, URL, localStorage, IndexedDB, disco, logs ou crash reports. Não colocar senha em atributos DOM, título, tooltip ou acessibilidade enquanto oculta. Limpar drafts/cancelar operações após troca de tenant ou unmount.

Fill restrito a origens HTTPS exatas cadastradas e normalizadas (scheme/host/porta efetiva), sem wildcard, matching por substring ou confiança em query/path. Servidor valida allowlist cadastrada, mas origem enviada é declaração do cliente, não prova do DOM. Worker valida tabId/frameId/documentId e origem antes e imediatamente depois da entrega; navegação invalida. Content script recebe apenas valor daquela operação/campo e nenhum token/chave; mensagens com schema e remetente verificados. Iframes cross-origin, documentos opacos, HTTP, campos ocultos e autosubmit são negados no piloto. Permissões de host concedidas sob demanda; sem captura geral de teclas ou leitura de todas as páginas.

Copiar é liberação explícita para clipboard do SO, potencialmente acessível a outros programas. Não prometer apagamento automático: só limpar sob suporte e condições verificadas sem apagar conteúdo posterior do usuário. Autoocultar não revoga o que já foi copiado. Preenchimento expõe o valor ao site; página comprometida pode capturá-lo. Esses limites devem aparecer na UX de consentimento, sem jargão criptográfico.

## 10. Auditoria, disponibilidade e limites

Eventos próprios: CLIENT_REGISTERED, DEVICE_REVOKED, VAULT_UNLOCKED, VAULT_LOCKED, UNLOCK_DENIED, OPERATION_AUTHORIZED, DELIVERY_RELEASE_COMMITTED, OPERATION_DENIED/EXPIRED/CANCELLED e POLICY_CHANGED. Payload mínimo: eventId, UTC, tenant/user IDs internos, clientKind/instance/device, action, itemRef/versão, operationId, policyVersion, assurance class, reasonCode, correlationId. Usar origem canônica apenas quando necessário, nunca URL completa/query, segredo, ciphertext, chave privada, token, assertion, verifier ou conteúdo do terminal. Acesso/retention seguem política existente de auditoria, sem prazo novo inventado.

DELIVERY_RELEASE_COMMITTED significa autorização consumida, não confirmação de visualização/preenchimento. Consumo e evento/outbox durável devem estar na mesma transação lógica. Falha antes do commit: nada liberado; depois: operação consumida mesmo se resposta falhar. Falha ao publicar outbox após persistência não perde evento; consumidor idempotente por eventId. Não retornar conteúdo quando não foi possível persistir a intenção de entrega. Auditoria de negativas deve evitar amplificação; limitar volume sem perder eventos de liberação/revogação/política. Nunca alterar silenciosamente a auditoria histórica SSH/RDP.

Limites iniciais exclusivos da camada nova: 5 desafios de unlock por 5 min por usuário+tenant e instância, com limite agregado por usuário contra troca de device; 10 registros de cliente por hora por usuário; 30 requests de operação por minuto por usuário+tenant e no máximo 5 operações pendentes por cliente; uma liberação em curso por cliente. IP apenas sinal adicional, não identidade. Contadores autoritativos compartilhados entre réplicas. Limite não bloqueia login/SSH/RDP globalmente. Valores são política inicial a medir em piloto, não resultado de benchmark.

Pools/filas de delivery limitados e timeouts próprios; quota por tenant também deve ser definida no deploy antes de habilitar. Degradação do Redis/banco/policy/crypto/auditoria nega nova entrega; não encaminha chamada para rota sem proteção. Feature flags independentes vault-unlock, vault-reveal, vault-copy, vault-fill e bridge. Desligar flag cancela novas autorizações/grants pertinentes. Vault indisponível não entra no fluxo operacional, mas recursos compartilhados ainda podem competir: medir carga e limites antes de prometer isolamento de desempenho.

## 11. Aceites de implementação e sequência

| ID | Cenário obrigatório | Resultado observável |
|---|---|---|
| SEC-01 | Cofre bloqueado/expirado/revogado com terminal e snippet ativos | Novas extrações negadas; fluxo operacional preservado |
| SEC-02 | Logout central, sessionVersion, usuário/tenant desativado | Portal/extensão não autorizam novo consumo |
| SEC-03 | Polling, clock skew, worker suspenso, aba oculta, troca tenant, lock não entregue | Não estender prazo; descartar estado local; respeitar janela residual server-side |
| SEC-04 | Admin/proprietário/ACL operacional sem entitlement de extração | Reveal/copy/fill negados |
| SEC-05 | Secret antigo não classificado; PEM; item revogado | Nenhuma entrega |
| SEC-06 | Challenge/código reutilizado, PKCE/state/redirect/UV/origin incorretos | Rejeitar sem token ou segredo |
| SEC-07 | Duas instâncias/tenants, chave trocada, versão/ação alterada | Rejeitar substituição de contexto |
| SEC-08 | 20 consumes concorrentes do mesmo grant | No máximo uma liberação e um evento durável |
| SEC-09 | Revogação/ACL/rotação concorrente ao consumo | Resultado linearizado, sem liberação após revogação vencedora |
| SEC-10 | Falha/crash antes/depois de commit, auditoria offline, ACK falso | Sem entrega antes do commit; sem reabrir grant |
| SEC-11 | Navegação/iframe/opener/mensagem falsa/host parecido | Nenhum fill em documento diferente |
| SEC-12 | API erro, cache, logs, storage, clipboard, blur | Nenhum segredo persistido intencionalmente; limites documentados |
| SEC-13 | Cliente perdido/reinstalado, autorização expirada, logout da sessão de origem, chave rotacionada, replay | Revogação consultada por originSessionRef; novo bootstrap/cadastro conforme caso |
| SEC-14 | Outage/overload do delivery/bridge/step-up | Negar extração e medir não regressão operacional |
| SEC-15 | Login local/SSO/MFA/refresh, SSH direto/bastion/agente, RDP, PEM, snippets, auditoria | Baseline/regressão com dados descartáveis; mocks não substituem ensaio real aplicável |

Adicionar ensaios SEC-16: popup → aba de consentimento → retorno ativo; o desafio não deve entrar em loop de cancelamento, e worker perdido não aceita retorno. SEC-17: popup → fill vinculado → aba de destino; uma operação permitida, fechamento/navegação indevidos negados, sem novas operações em background. SEC-18: logout da sessão central de origem com JWT ainda não expirado e evento perdido; consume nega por estado autoritativo; outras sessões centrais mantêm sua política atual.

Antes de código: revisar esquema aditivo e barreiras transacionais, escolher protocolo/biblioteca de posse/envelope com vetores oficiais, fixar modelo de bootstrap/pacote e provar WebAuthn Windows/Chrome/Edge com conta de teste. Falta de suporte não autoriza downgrade. Depois: implementar sessões/policy e interfaces sem revelar; testar contratos e falhas; implementar entrega cifrada do item 3; habilitar reveal/copy em piloto; extensão/autofill só após gates próprios. Bridges e E2EE posteriores.

Esta frente encerra **a definição do contrato**, não esses aceites runtime. Implementação posterior exige plano aprovado, baseline, testes, Sonar, revisão independente e homologação. Qualquer limitação de revogação, bootstrap ou auditoria exige bloquear a feature e revisar o contrato antes de liberar dados reais.

## 12. Referências consultadas

- [WebAuthn Level 3, W3C](https://www.w3.org/TR/webauthn-3/): cerimônia, RP/origin, challenge e verificação do usuário. Windows Hello é possibilidade de autenticador; integração específica ainda requer prova local.
- [OWASP — Transaction Authorization](https://cheatsheetseries.owasp.org/cheatsheets/Transaction_Authorization_Cheat_Sheet.html): separar autenticação de autorização da operação e controlar transições server-side.
- [OWASP — Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html): expiração/invalidação e controles server-side. Os tempos desta proposta são decisão NodeAccess.
- [RFC 9700 — OAuth 2.0 Security BCP](https://www.rfc-editor.org/rfc/rfc9700.html): orientação para fluxo de cliente público, PKCE e prevenção de redirecionamento/replay; não afirma que o backend atual já implemente OAuth authorization server.
- [RFC 9449 — OAuth DPoP](https://www.rfc-editor.org/rfc/rfc9449.html): candidato padronizado para prova de posse; escolha/integração são gates do item 3, sem protocolo customizado.
- [Parecer híbrido NodeAccess](../NA-0175-cofre-extensao/hybrid-delivery-review.md): HPKE, limites de E2EE, bridge e preservação do gateway.
