# PRD — Email OTP (MFA via E-mail)

**Status:** Proposta  
**Data:** 2026-04-24  
**Autor:** Jeferson Quintana

---

## Problema

O MFA atual exige um app autenticador (Google Authenticator, Authy, etc.) com TOTP.  
Isso cria fricção no onboarding e deixa usuários sem recuperação caso percam acesso ao app.  
Não existe hoje nenhum canal de email no produto.

---

## Proposta

Criar um **serviço de envio de email** configurável por tenant (Gmail, Outlook ou SMTP genérico) e usá-lo para enviar um **código OTP de 6 dígitos** como segundo fator de autenticação.

O email OTP não substitui o TOTP — convive com ele como **método alternativo ou de recuperação**.

---

## Avaliação

### Vantagens
- Menor fricção: usuário não precisa instalar nenhum app
- Resolve o problema de ausência de backup/recovery codes
- Canal de email abre caminho para notificações futuras (alertas de acesso, etc.)
- SMTP genérico cobre qualquer provedor corporativo (Exchange, Zoho, etc.)

### Riscos / Desvantagens
- Email é **menos seguro** que TOTP (sujeito a phishing, sequestro de conta de email)
- Dependência de entregabilidade — email em spam bloqueia o login
- Latência de entrega pode frustrar o usuário
- Requer que cada tenant configure suas próprias credenciais SMTP

### Decisão de design
Email OTP deve ser usado como **alternativa ao TOTP**, não como substituto.  
Usuário com TOTP configurado continua usando TOTP por padrão.  
Email OTP fica disponível como opção de "Usar outro método" ou "Esqueci o acesso ao app".

---

## Escopo

### Módulo: `email`

Serviço isolado de envio de email, sem acoplamento ao módulo de auth.  
Configurado por tenant via tabela `emailConfig`.

### Módulo: `auth` (extensão)

Dois novos endpoints para solicitar e verificar o OTP por email.

---

## Schema de Banco de Dados

```prisma
model EmailConfig {
  id         Int      @id @default(autoincrement())
  tenantId   Int      @unique @map("tenant_id")
  provider   String   // "gmail" | "outlook" | "smtp"
  host       String?  // para SMTP genérico
  port       Int?     // para SMTP genérico (ex: 587)
  secure     Boolean  @default(false)
  user       String   // endereço/login do remetente
  password   String   // senha ou app password (encriptado em repouso)
  fromName   String   @map("from_name") // ex: "NodeAccess"
  createdAt  DateTime @default(now()) @map("created_at")
  updatedAt  DateTime @updatedAt @map("updated_at")

  tenant Tenant @relation(fields: [tenantId], references: [id])

  @@map("email_configs")
}
```

**OTP:** armazenado no **Redis** (não no banco), com TTL de 10 minutos.  
Key: `otp:email:{userId}` → valor: código de 6 dígitos + tentativas restantes.

---

## API

### Configuração de email (admin)

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| `GET` | `/api/v1/email-config` | Retorna config atual do tenant (sem senha) |
| `PUT` | `/api/v1/email-config` | Cria ou atualiza config |
| `POST` | `/api/v1/email-config/test` | Envia email de teste para validar a config |
| `DELETE` | `/api/v1/email-config` | Remove config |

### Auth — OTP por email

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| `POST` | `/api/v1/auth/request-email-otp` | Envia OTP para o email do usuário |
| `POST` | `/api/v1/auth/verify-email-otp` | Verifica o OTP e emite tokens de sessão |

---

## Fluxo de Login com Email OTP

```
[LoginView]
  ↓ Email + Password → POST /auth/login
  ↓ Retorna tempToken

  ├─ [VerifyTotpView] — fluxo TOTP padrão
  │   └─ Link "Usar código por email" → dispara POST /auth/request-email-otp
  │
  └─ [VerifyEmailOtpView] — novo
      ├─ POST /auth/request-email-otp
      │   ├─ Valida tempToken
      │   ├─ Verifica que tenant tem EmailConfig ativo
      │   ├─ Gera OTP de 6 dígitos (crypto.randomInt)
      │   ├─ Salva no Redis: otp:email:{userId} (TTL 10 min, max 3 tentativas)
      │   └─ Envia email via EmailService
      │
      └─ POST /auth/verify-email-otp
          ├─ Valida tempToken
          ├─ Lê OTP do Redis
          ├─ Compara código (timing-safe)
          ├─ Decrementa tentativas; se 0 → invalida e retorna erro
          ├─ Log MFA_VERIFIED (eventType existente)
          └─ Emite accessToken + refreshToken
```

---

## Segurança

| Controle | Detalhe |
|----------|---------|
| OTP no Redis | TTL 10 min; invalidado após uso ou 3 tentativas |
| Geração | `crypto.randomInt(100000, 999999)` — CSPRNG |
| Comparação | timing-safe (sem early exit) |
| Credencial SMTP | Encriptada com a mesma estratégia dos `Secrets` existentes |
| Rate limit | Reutilizar middleware de rate limit existente no endpoint de request |
| Auditoria | Reusa `AuthEventType.MFA_VERIFIED` / `MFA_FAILED` no `authLog` |

---

## Provedores Suportados

| Provedor | Host | Porta | Observação |
|----------|------|-------|------------|
| Gmail | `smtp.gmail.com` | 587 | Requer "App Password" (2FA ativo na conta Google) |
| Outlook/Hotmail | `smtp.office365.com` | 587 | Requer senha de app ou OAuth |
| SMTP Genérico | configurável | configurável | Exchange, Zoho, SendGrid SMTP, etc. |

Biblioteca: **Nodemailer** (madura, zero dependências externas, suporte nativo a todos os provedores).

---

## Frontend

### Nova tela: `VerifyEmailOtpView.vue`
- Input de 6 dígitos (mesmo estilo do `VerifyTotpView`)
- Contador regressivo de 10 minutos
- Botão "Reenviar código" (após 60 segundos)
- Mensagem de erro após 3 tentativas inválidas

### Tela admin: `EmailConfigView.vue`
- Formulário: provider (select), host, port, user, password
- Botão "Testar conexão" → chama `POST /email-config/test`
- Exibe status: configurado / não configurado

### Mudança em `VerifyTotpView.vue`
- Adicionar link "Não tenho acesso ao app autenticador" → redireciona para `VerifyEmailOtpView`
- Condicional: só exibe o link se o tenant tiver `EmailConfig` configurado

---

## Dependências a Adicionar

```json
"nodemailer": "^6.9.x",
"@types/nodemailer": "^6.4.x"
```

---

## Fora do Escopo (por ora)

- Email OTP como **único fator** (substituindo senha)
- Notificações de login por email
- Templates HTML elaborados (texto puro é suficiente para OTP)
- OAuth2 para autenticação SMTP (App Password cobre os casos de uso)
- Envio de emails transacionais genéricos (welcome, reset de senha)

---

## Próximos Passos

1. Validar decisão: email OTP como alternativa ou obrigatoriedade quando TOTP não está configurado?
2. Criar migração Prisma para `emailConfig`
3. Implementar `EmailService` com Nodemailer
4. Implementar endpoints de config + teste
5. Implementar endpoints de auth OTP
6. Criar views frontend
7. Testar com Gmail, Outlook e SMTP genérico (Mailtrap para testes)
