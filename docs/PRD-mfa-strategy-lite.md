# PRD — Estratégia MFA de Baixa Fricção

**Status:** Proposta  
**Data:** 2026-04-24  
**Autor:** Jeferson Quintana

---

## Contexto

O MFA atual usa TOTP obrigatório (app autenticador) com `speakeasy`.  
O objetivo é reduzir a fricção do usuário sem abrir mão de segurança,  
avaliando: Email OTP (recuperação), Push Authentication e WebAuthn/Passkeys/Biometria.

---

## Comparativo de Métodos

| Método | Fricção | Segurança Real | Custo | Complexidade | Dependência |
|--------|---------|----------------|-------|--------------|-------------|
| **TOTP** (atual) | Média | AAL2 — vulnerável a phishing real-time | $0 | Feito | nenhuma |
| **Email OTP** | Média | AAL1 — mais fraco, email pode ser comprometido | $0 | Baixa | Nodemailer |
| **Push (Okta/Duo)** | Baixa | AAL2 — vulnerável a push fatigue attack | $3–5/user/mês | Média | vendor lock-in |
| **Push (Firebase custom)** | Baixa | AAL2 — idem acima | $0 (FCM) | Alta | app mobile próprio |
| **WebAuthn / Passkeys** | Muito Baixa | **AAL3** — phishing-proof, origin binding | $0 | Média | nenhuma |
| **Biometria (via WebAuthn)** | Muito Baixa | **AAL3** — chave privada nunca sai do device | $0 | Média | nenhuma |

---

## Análise de Segurança Detalhada

### Push Authentication — O que parece vs o que é

**Aparência:** Usuário toca "Aprovar" no celular. Simples e moderno.  
**Risco real:**
- **Push fatigue attack**: atacante faz múltiplas tentativas até o usuário clicar "aprovar" por cansaço ou engano (vetor real, usado contra Uber, Microsoft em 2022)
- Não tem *origin binding* — um phishing sofisticado pode relay o push
- Requer app mobile próprio (se custom via Firebase) ou vendor pago (Okta/Duo)

**Mitigação:** Okta usa "Number Challenge" — usuário vê um número na web e confirma no app. Reduz o ataque, mas não elimina.

**Conclusão:** Push não é mais seguro que TOTP. É apenas mais conveniente. O custo de implementar do zero (app mobile + Firebase) não justifica.

### WebAuthn / Passkeys / Windows Hello — O padrão certo

**Como funciona:**
1. Registro gera par de chaves (privada fica no device, pública no servidor)
2. Login: servidor envia challenge, device assina com chave privada
3. Chave privada **nunca sai do dispositivo** (secure enclave)

**Por que é superior:**
- **Phishing-proof por design**: assinatura é vinculada ao domínio (`nodeaccess.app`). Um site falso nunca consegue uma resposta válida
- **Sem replay**: counter incrementado a cada uso
- **Sem secret compartilhado**: servidor só tem chave pública
- **Biometria é local**: Windows Hello, Touch ID e Face ID são apenas o "unlock" da chave — nenhum dado biométrico sai do device

**Suporte em 2026:**
- 100% navegadores modernos (Chrome, Firefox, Safari, Edge)
- Windows Hello — disponível em qualquer Windows 10/11 com câmera ou leitor de digital
- Touch ID / Face ID — macOS + iOS nativamente
- Android Biometria — 95%+ dispositivos
- Passkeys sincroniados — iCloud Keychain, Google Password Manager, Bitwarden

**Biblioteca:** `@simplewebauthn/server` + `@simplewebauthn/browser` — open source, zero vendor lock-in, produção em grandes empresas.

---

## Estratégia Recomendada para o NodeAccess

### Princípio
**Não substituir o TOTP agora — adicionar camadas progressivamente.**  
Cada método vive como alternativa registrada, o usuário escolhe o mais conveniente.

### Fases

#### Fase 1 — Email OTP como Recuperação (curto prazo)
Escopo já documentado no `PRD-email-otp-lite.md`.

- Trigger: usuário clica "Não tenho acesso ao app" na tela de TOTP
- Envia OTP de 6 dígitos para email cadastrado
- OTP no Redis (TTL 10 min, 3 tentativas)
- **Não substitui TOTP** — é escape hatch de recuperação

#### Fase 2 — WebAuthn / Passkeys (médio prazo)
Registrar uma passkey como método alternativo ao TOTP.

- Após login TOTP bem-sucedido, usuário pode registrar uma passkey em "Configurações > Segurança"
- No próximo login, vê opção "Entrar com passkey / Windows Hello / Touch ID"
- Se disponível: biometria nativa do dispositivo sem digitar nada
- Fallback: TOTP continua funcionando
- **Setup mínimo**: 2 tabelas no banco + 2 libs npm + 4 endpoints + 2 views frontend

#### Fase 3 — Passkeys como 1º Fator (longo prazo / opcional)
Quando a adoção estiver madura, oferecer login sem senha:  
email → passkey (biometria) → sessão. TOTP como fallback para devices sem passkey.

---

## O que NÃO fazer

| Opção | Por quê não |
|-------|-------------|
| Push via Firebase custom | Requer app mobile próprio; complexidade alta; segurança não supera WebAuthn |
| Push via Okta/Duo | Vendor lock-in + custo por usuário; não atinge AAL3 |
| SMS OTP | Vulnerável a SIM swap; NIST desaconselha desde 2017 |
| Substituir TOTP por Email OTP | Email é AAL1 — rebaixamento de segurança |

---

## Schema — Fase 2 (WebAuthn)

```prisma
model WebAuthnCredential {
  id           Int      @id @default(autoincrement())
  userId       Int      @map("user_id")
  credentialId String   @unique @map("credential_id") // base64url
  publicKey    Bytes    @map("public_key")            // COSE key
  counter      BigInt   @default(0)
  deviceName   String?  @map("device_name")           // "MacBook Pro Touch ID"
  createdAt    DateTime @default(now()) @map("created_at")
  lastUsedAt   DateTime? @map("last_used_at")

  user User @relation(fields: [userId], references: [id])

  @@map("webauthn_credentials")
}
```

Um usuário pode registrar múltiplas credenciais (trabalho, pessoal, yubikey).

---

## API — Fase 2

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| `POST` | `/api/v1/auth/webauthn/register-options` | Gera challenge de registro |
| `POST` | `/api/v1/auth/webauthn/register-verify` | Verifica e salva credential |
| `POST` | `/api/v1/auth/webauthn/auth-options` | Gera challenge de autenticação |
| `POST` | `/api/v1/auth/webauthn/auth-verify` | Verifica resposta e emite tokens |
| `GET` | `/api/v1/auth/webauthn/credentials` | Lista credenciais do usuário |
| `DELETE` | `/api/v1/auth/webauthn/credentials/:id` | Remove credencial |

---

## Fluxo de Login com Passkey (Fase 2)

```
[LoginView]
  ├─ Email + Password → POST /auth/login → tempToken
  │
  └─ OU: Conditional UI (autocomplete passkey no campo email)
     └─ Teclado/biometria → POST /auth/webauthn/auth-verify → tokens direto

[VerifyTotpView] — fluxo padrão
  ├─ Código TOTP
  ├─ "Usar código por email" → VerifyEmailOtpView
  └─ "Usar passkey" (se registrada) → POST /auth/webauthn/auth-verify

[Configurações > Segurança]
  ├─ Listar credenciais WebAuthn registradas
  ├─ "Adicionar dispositivo" → register-options → biometria → register-verify
  └─ Remover dispositivo
```

---

## Dependências a Adicionar (Fase 2)

```json
"@simplewebauthn/server": "^13.x",
"@simplewebauthn/browser": "^13.x"
```

Zero dependências externas além dessas. Biblioteca open source, MIT license.

---

## Esforço Estimado

| Fase | Backend | Frontend | Total |
|------|---------|----------|-------|
| Email OTP (recuperação) | 3–4 dias | 2 dias | ~1 semana |
| WebAuthn Fase 2 | 4–5 dias | 3–4 dias | ~2 semanas |
| Passkey 1º fator (Fase 3) | 2–3 dias | 2 dias | ~1 semana |

---

## Próximos Passos

1. Confirmar: implementar **Fase 1 (Email OTP)** primeiro?
2. Definir se WebAuthn é opcional ou incentivado no onboarding
3. Decidir se Passkeys substituem senha no longo prazo (Fase 3)
