# PRD Lite - SSH Certificate Authority (SSH CA)

## Objetivo
- permitir acesso SSH direto aos hosts sem browser e sem proxy obrigatorio
- emitir certificados SSH de curta duracao por usuario, assinados pelo NodeAccess
- manter autenticacao centralizada (MFA) com experiencia 100% nativa para o usuario

## Contexto
Frente complementar ao CLI terminal. O usuario autentica uma vez no NodeAccess,
recebe um certificado SSH assinado e pode usar qualquer cliente SSH nativo para
conectar nos hosts autorizados, sem passar pelo WebSocket gateway.

## Decisao pendente
Definir se audit/gravacao de sessao e requisito:
- Se sim: cert + ProxyJump pelo backend NodeAccess (audit preservado)
- Se nao (ou opcional por tenant): cert direto para o host (experiencia pura)
- Os dois modos podem coexistir por politica de tenant

## Arquitetura proposta

### Modo 1 — Cert + ProxyJump (audit preservado)
```
nodeaccess login  →  cert assinado (TTL configuravel, ex: 8h)
ssh -J nodeaccess.empresa.com -i ~/.nodeaccess/id_cert user@host
```
- NodeAccess backend valida JWT no ProxyJump, loga a conexao
- Gravacao e sessao ao vivo continuam funcionando
- Hosts nao precisam de configuracao extra alem de confiar na CA

### Modo 2 — Cert direto (experiencia pura)
```
nodeaccess login  →  cert assinado (TTL curto, ex: 1-8h)
ssh -i ~/.nodeaccess/id_cert user@host
```
- Conexao direta, sem proxy
- NodeAccess so sabe que o cert foi emitido
- Sem gravacao, sem sessao ao vivo
- Requer que os hosts confiem na CA NodeAccess (`TrustedUserCAKeys`)

## Como funciona SSH CA
1. NodeAccess gera um par de chaves CA (uma vez por tenant ou global)
2. A chave publica da CA e distribuida para todos os hosts gerenciados
3. Cada host recebe: `TrustedUserCAKeys /etc/ssh/nodeaccess_ca.pub`
4. Ao fazer login no NodeAccess (com MFA), o usuario envia sua chave publica
5. NodeAccess assina a chave com a CA e retorna o certificado
6. O certificado carrega: usuario, hosts permitidos (principals), TTL, extensoes
7. O usuario usa o cert com `ssh -i cert` ou via `ssh-add`

## Fluxo de emissao de certificado
```
POST /ssh-ca/sign
Authorization: Bearer <jwt>
Body: { publicKey: "ssh-ed25519 AAAA...", ttlHours: 8 }

Response: { certificate: "ssh-ed25519-cert-v01@openssh.com ...", expiresAt: "..." }
```

## Seguranca
- TTL curto por padrao (configuravel por tenant: 1h a 24h)
- Certificado carrega lista de `principals` (usuarios Unix permitidos)
- Certificado pode restringir hosts via `source-address` extension
- MFA obrigatorio para emitir certificado (mesmo fluxo do login web)
- Chave privada da CA armazenada com criptografia forte (reusa padrao de secrets)
- Rotacao de CA planejada: novo par gerado, periodo de overlap para nao derrubar sessoes ativas
- Revogacao: via `RevokedKeys` no host ou TTL curto como substituto pratico

## Requisitos nos hosts gerenciados
- `TrustedUserCAKeys /etc/ssh/nodeaccess_ca.pub` no `sshd_config`
- Distribuicao da chave CA via modulo de host do NodeAccess (ou manual)
- Nenhuma chave SSH individual por usuario precisa ser gerenciada nos hosts

## Integracao com CLI
- `nodeaccess login` emite cert automaticamente alem do JWT
- Cert salvo em `~/.nodeaccess/id_cert` com permissao 600
- `nodeaccess connect myhost` usa o cert via node-pty
- Para uso nativo: usuario pode copiar o cert e usar `ssh` diretamente

## O que nao muda
- fluxo web continua igual (WebSocket gateway)
- usuarios que nao querem usar cert continuam com password/PEM por host
- nenhuma mudanca obrigatoria nos modulos existentes de host

## Limitacoes conhecidas
- hosts precisam ser reconfigurados para confiar na CA (mudanca de infraestrutura)
- sem revogacao imediata no modo direto (mitigado por TTL curto)
- no modo direto: sem gravacao de sessao e sem sessao ao vivo
- chave publica do usuario precisa ser enviada ao NodeAccess para assinatura

## Prioridade sugerida
### Primeiro corte
- endpoint de assinatura de certificado (`POST /ssh-ca/sign`)
- gerenciamento da chave CA por tenant (gerar, exportar chave publica)
- integracao com CLI: emissao automatica no login
- documentacao de configuracao nos hosts (`TrustedUserCAKeys`)

### Segundo corte
- TTL configuravel por tenant
- restricao de principals por grupo de acesso
- rotacao de CA com periodo de overlap
- exportacao da CA publica via painel admin

### Depois
- ProxyJump integrado ao backend para modo hibrido (cert + audit)
- restricao de `source-address` por certificado
- revogacao ativa via lista de chaves revogadas

## Arquivos provaveis
- `apps/backend/src/modules/ssh-ca/ssh-ca.service.ts` — gerenciamento da CA e assinatura
- `apps/backend/src/modules/ssh-ca/ssh-ca.controller.ts`
- `apps/backend/src/modules/ssh-ca/ssh-ca.routes.ts`
- `apps/backend/prisma/schema.prisma` — modelo `SshCa` por tenant
- `apps/cli/src/commands/login.ts` — emissao e armazenamento do cert
- `apps/frontend/src/views/admin/SshCaView.vue` — painel de gerenciamento da CA

## Fora do escopo inicial
- suporte a certificados de host (somente usuario por agora)
- integracao com Vault ou HSM externo para guardar a chave CA
- emissao de cert via OIDC/SSO externo
