# NodeAccess — Instruções ao Codex: Segurança, Pentest e Central de Segurança

> **Plano de execução vigente — 05/11/2026:** executar as etapas abaixo na ordem indicada. As seções antigas denominadas “Fase 1–6” e a extensão de segurança adaptativa permanecem como **especificação de requisitos**, mas sua numeração **não** define a ordem de implementação. **Primeira entrega: Central de Segurança**. Não iniciar hardening estrutural sem diagnóstico e aprovação.

## Plano executivo por etapas (ordem obrigatória)

| Etapa | Objetivo e entregáveis | Condição para avançar |
|---|---|---|
| **0 — Inventário mínimo, somente leitura** | Localizar rotas, layout, permissões, documentação, controles existentes e fluxos de autenticação; criar matriz de evidências. | Relatório indicando confirmado/parcial/ausente/não verificado, com arquivos e testes. |
| **1 — Central de Segurança (PRIMEIRA ENTREGA)** | Página informativa integrada ao produto; catálogo versionado de controles; documentação interna; conteúdo revisado por evidência. | Página acessível, responsiva, revisada e testada; nenhuma alegação não comprovada. |
| **2 — Threat model e baseline** | Mapear fronteiras navegador/API/WebSocket/gateway/hosts, tenants, Cofre, logs; avaliar ASVS/WSTG; backlog por risco. | RFC aprovada, com responsáveis, prioridades e plano de rollback. |
| **3 — Segurança adaptativa** | Eventos, políticas parametrizáveis, modo observação, notificações, step-up e aplicação gradual; Fail2ban opcional. | Testes de falsos positivos, lockout, proxy, HA, Redis e auditoria. |
| **4 — Hardening e DevSecOps** | ACL/tenant, sessão, cofre, SSRF/egress, containers, CI com scanners e regressões. | Testes automatizados e aprovação de mudanças de risco. |
| **5 — Chaves públicas no SSH Gateway** | Autenticação operador→gateway e gateway→host, verificação de host keys, Cofre, rotação e políticas. | Testes de interoperabilidade, revogação e ausência de exposição de chave privada. |
| **6 — SSH CA e certificados curtos** | PoC de CA isolada, certificados por sessão, TTL, principals, revogação e compatibilidade. | PoC validada em homologação, sem quebra dos hosts legados. |
| **7 — Autenticador móvel** | Desenho de desafio assinado, vínculo de dispositivo, antifraude; apps Android/iOS como projeto separado. | Threat model e aprovação de produto; não bloquear fase 1. |
| **8 — Pentest contínuo** | ZAP, Greenbone, Nuclei, Semgrep, Trivy, Gitleaks, revisão manual e retestes em ambiente autorizado. | Achados rastreados com evidência, owner, SLA e teste de regressão. |

### Etapa 1: especificação de produto — Central de Segurança

**Objetivo:** oferecer uma página clara, útil e confiável para usuários e administradores, sem marketing de segurança não comprovado. Criar primeiro o catálogo de controles e só então renderizar o conteúdo público.

**Inventário e fonte de verdade:** registrar cada controle com `id`, nome, categoria, descrição interna, descrição pública, estado (`verified`, `partial`, `planned`, `unverified`), evidência (arquivo/teste/commit), versão, responsável, data da última revisão, superfície afetada e restrições. Estados são internos; mostrar ao público apenas controles realmente disponíveis, podendo publicar um roadmap explicitamente separado e rotulado. Nunca divulgar caminhos internos, regras de detecção, thresholds, detalhes de infraestrutura, secrets ou topologia sensível.

**Seções da página:** Visão geral; Login e MFA; Acesso a hosts e permissões; Cofre e proteção de credenciais; Sessões SSH/RDP/SFTP; Auditoria; Monitoramento e notificações; Boas práticas do usuário; Privacidade e retenção (somente com políticas verificadas); Reportar vulnerabilidade/contato (somente canal oficial existente); Atualizações de segurança. Distinguir o que o usuário deve fazer (habilitar MFA, proteger dispositivo, reportar atividade suspeita) do que a plataforma faz. Evitar alegar certificação ISO 27001/27002, conformidade ou criptografia ponta a ponta sem evidências formais.

**UX e arquitetura:** reutilizar layout, navegação, componentes, i18n, acessibilidade, responsividade e design system existentes. Evitar nova dependência ou CMS sem justificativa. O conteúdo pode vir de um catálogo versionado revisado em PR, com separação entre metadados internos e conteúdo público. Definir acesso à página (pública ou autenticada) conforme arquitetura e risco; não exigir dados sensíveis para leitura. Documentar atualização, revisão e aprovação de conteúdo.

**Documentação interna:** `docs/security/README.md` (índice), `controls-catalog.md` ou estrutura equivalente, `architecture-and-trust-boundaries.md`, `authentication-and-sessions.md`, `ssh-gateway-identity.md`, `adaptive-security.md`, `security-testing.md`, `security-decisions.md`. Adaptar nomes ao padrão real do repositório. Separar controles comprovados de recomendações e planos.

**Critérios de aceite da etapa 1:** (a) cada afirmação pública tem evidência; (b) navegação e responsividade funcionam; (c) não há exposição de configuração sensível; (d) testes unitários/de interface conforme stack existente; (e) catálogo possui revisão e versionamento; (f) conteúdo está em português brasileiro claro; (g) auditoria de permissões para conteúdo administrativo; (h) nenhuma alteração de autenticação ou fluxo SSH nesta etapa.

**Entrega inicial do Codex:** antes de editar, apresentar proposta de rotas/componentes, inventário de controles e texto público candidato com marcação de evidência. Após aprovação, implementar somente a etapa 1 em PR pequeno; não executar etapas posteriores automaticamente.

---

## Missão
Auditar a implementação atual do NodeAccess, propor e executar hardening seguro, implantar verificações DevSecOps, criar documentação técnica interna e uma página informativa de segurança para usuários. Preservar arquitetura, UX, desempenho e funcionalidades. **Não presumir que controles existem sem evidência no código.** Login, MFA e HTTPS foram informados; a conexão SSH/RDP exclusivamente pelo backend é uma hipótese a confirmar.

## Regras obrigatórias
1. **Começar por inspeção somente leitura.** Antes de alterar código, apresentar inventário, riscos, plano incremental, arquivos afetados e testes. Solicitar aprovação antes de mudanças de arquitetura, migrações, alterações de autenticação ou varreduras ativas.
2. Nunca executar pentest invasivo em produção ou em infraestrutura de terceiros sem autorização explícita. Usar homologação, dados sintéticos e escopo autorizado.
3. Nunca exibir, armazenar em relatórios ou enviar ao frontend senhas, PEMs privadas, tokens, secrets, gravações ou dados pessoais. Não incluir segredos em logs e exemplos.
4. Cada achado deve conter severidade, impacto, evidência (arquivo/linha ou teste), proposta de correção e teste de regressão. Distinguir **confirmado, parcial, ausente, não verificado**.
5. Evitar bibliotecas novas sem necessidade, duplicações, mudanças amplas e mecanismos criptográficos próprios. Seguir padrões e testes do repositório.
6. Não afirmar certificação ou conformidade ISO 27001, segurança absoluta, criptografia ponta a ponta ou logs imutáveis sem comprovação.

## Fase 1 — Descoberta e threat modeling
Mapear frontend, backend, APIs, WebSockets, autenticação, MFA, JWT/cookies, RBAC/ACL, tenants, hosts, SSH/RDP/SFTP, cofre/PEM/secrets, gravações, Docker, MySQL, Redis, proxy e CI/CD (apenas componentes existentes). Desenhar fluxo navegador → API/WebSocket → backend/gateway → host; identificar limites de confiança e por onde transitam credenciais. Confirmar se credenciais ou chaves privadas chegam ao navegador direta ou indiretamente.

Criar `docs/security/ASSESSMENT.md` com tabela: Controle | Estado | Evidência | Risco | Correção | Prioridade. Criar `docs/security/THREAT_MODEL.md` com STRIDE, ativos, atores, superfícies, fluxos e riscos residuais.

## Fase 2 — Revisão e hardening por risco
### P0: autorização e isolamento
- Autorizar **no backend** cada ação sobre tenant, pasta, host, secret, gravação, SFTP, API e WebSocket; negar por padrão.
- Testar IDOR/BOLA, escalada de privilégio, IDs adulterados e isolamento cruzado entre duas empresas.
- Revalidar permissões e revogar sessões ativas após bloqueio ou alteração de ACL conforme política documentada.

### P0: identidade, sessões e WebSocket
- Verificar expiração absoluta e por inatividade, revogação, logout, refresh, mudança de senha e reset MFA.
- Revisar cookies `Secure`, `HttpOnly`, `SameSite`, proteção CSRF, CORS, CSP e validação de Origin conforme arquitetura real.
- Autorizar handshake e **cada operação** WebSocket; impor limites de tamanho, concorrência, duração e desconexão.
- Rate limit distribuído para login, MFA, recuperação, sessão e operações críticas; impedir enumeração e abuso.
- Avaliar step-up MFA para exportar secrets, alterar permissões ou executar ações privilegiadas.

### P0: cofre e credenciais
- Verificar cifragem em repouso, uso de criptografia autenticada (ex.: AES-256-GCM), nonces, gestão de chaves, segregação, rotação, backups e autorização de uso/exportação.
- Preferir KMS/Vault e envelope encryption se fizer sentido. Não introduzir criptografia customizada.
- Verificar que segredos não aparecem em respostas, browser, erros, telemetria, logs, traces ou gravações. Proteger material sensível em memória na medida possível.

### P0: gateway SSH/RDP/SFTP e rede
- Confirmar mediação de conexão e uso de credenciais exclusivamente pelo backend; documentar exceções.
- Impor política de destinos/egress por tenant; proteger contra SSRF, DNS rebinding e acesso a metadata/serviços não autorizados. **Redes privadas legítimas devem ser permitidas apenas por política explícita.**
- SSH: validação segura de host keys e mudanças de fingerprint; nunca aceitar todas indiscriminadamente.
- RDP: validar identidade/certificados quando aplicável; limitar recursos e sessões.
- SFTP: autorização por operação, proteção contra traversal/symlink, controle de download/upload e auditoria.
- Timeouts, limite de conexões e limpeza de sessões órfãs.

### P0: auditoria
- Registrar ator, tenant, ação, recurso, resultado, horário e correlação, sem dados sensíveis.
- Revisar acesso a gravações e exportações, retenção, integridade e segregação; avaliar storage append-only/WORM quando justificável. Não afirmar imutabilidade se não existir.
- Auditar alterações de ACL, acesso a secrets, login/MFA e início/fim de sessões.

### P1: aplicação e infraestrutura
- Schemas de validação, SQL parametrizado, limites de payload, segurança de uploads, headers, TLS, CORS e tratamento de erros.
- Docker: menor privilégio, non-root quando possível, capabilities mínimas, isolamento de rede, limites de recursos, filesystem read-only quando compatível.
- MySQL/Redis: autenticação, permissões mínimas, isolamento, backup e portas expostas.
- Dependências, SBOM, supply chain e atualizações controladas.

### P2: evolução
WebAuthn/passkeys, acesso just-in-time, aprovação temporária, SIEM, detecção comportamental e pentest independente.

## Fase 3 — Ferramentas e pipeline
Avaliar integração de **Semgrep** (SAST), **Gitleaks** (segredos), **Trivy** (imagens/dependências/IaC), **SonarQube** (qualidade e segurança), **OWASP ZAP** (DAST), **Greenbone/OpenVAS** (infraestrutura), **Nuclei** (templates revisados) e **Burp Suite** (testes manuais). Não instalar tudo automaticamente.

Propor pipeline: PR → lint/testes → SAST/secrets/dependências → build → DAST autorizado em homologação → triagem → correção → reteste. Pin de versões, escopo definido, relatórios protegidos e política de bloqueio apenas para achados confirmados conforme severidade. Scans ativos exigem aprovação prévia.

## Fase 4 — Testes de segurança
Automatizar com framework existente e Playwright quando adequado:
1. Tenant A não acessa hosts, secrets, gravações ou downloads de B mesmo alterando IDs.
2. Usuário sem ACL não abre SSH/RDP/SFTP via API ou WebSocket.
3. Revogação de conta/ACL encerra ou bloqueia sessões conforme política.
4. Token expirado/revogado não permite nova conexão ou operação.
5. Reset de MFA não permite bypass nem enumeração de contas.
6. Host malicioso não alcança IPs/serviços proibidos via DNS/IP/rebinding.
7. Host key SSH alterada exige tratamento seguro.
8. Nenhum secret aparece em resposta, frontend, log ou gravação.
9. SFTP impede traversal e operações fora do escopo.
10. Auditoria registra concessões, negativas e alterações sem dados sensíveis.
11. Queda de Redis/backend e desconexões não deixam sessões órfãs ou permissões indevidas.

## Fase 5 — Documentação técnica interna
Criar em `docs/security/` (adaptar à estrutura existente):
- `README.md`: índice, classificação, responsável e revisão.
- `ARCHITECTURE.md`: componentes, diagramas e limites de confiança.
- `CONTROLS.md`: catálogo de controles, estado, evidência e última verificação.
- `THREAT_MODEL.md`: cenários e mitigação.
- `ASSESSMENT.md`: achados e backlog priorizado.
- `PENTEST_RUNBOOK.md`: autorização, escopo, homologação, execução, triagem e reteste.
- `INCIDENT_RESPONSE.md`: contenção, revogação, rotação, preservação de evidências e comunicação.
- `SECURITY_CHANGELOG.md`: mudanças relevantes sem detalhes exploráveis.
- `adr/`: decisões de arquitetura de segurança, quando necessário.

Separar documentação interna sensível da informação publicável. Não versionar dados reais de clientes, segredos, exploits ou topologia interna detalhada.

## Fase 6 — Página pública/in-app “Central de Segurança”
Implementar página informativa na navegação mais adequada (Ajuda/Sobre/Segurança), sem poluição visual, respeitando design system, responsividade, acessibilidade, i18n e padrões do projeto.

### Conteúdo da página
1. **Compromisso com segurança:** defesa em profundidade e princípio do menor privilégio.
2. **Identidade:** login, MFA e gerenciamento de sessão — somente o que for verificado.
3. **Conexões:** HTTPS/TLS e mediação pelo backend — somente se confirmada.
4. **Proteção de credenciais:** explicar controle de acesso e tratamento de segredos sem divulgar algoritmos, localização de chaves ou detalhes operacionais; afirmar que secrets não chegam ao navegador apenas se comprovado.
5. **Permissões e segregação:** papéis, ACL e isolamento de empresas, conforme implementação real.
6. **Auditoria:** o que é registrado e quem pode consultar, sem prometer imutabilidade não comprovada.
7. **Boas práticas:** proteger MFA, não compartilhar contas, encerrar sessões, reportar incidentes.
8. **Reporte de vulnerabilidades:** canal configurável e validado; não inventar e-mail, SLA ou bug bounty.
9. **Transparência:** última revisão efetiva e links para políticas disponíveis.

### Texto inicial sugerido (revisar contra evidências)
> **Segurança no NodeAccess**
>
> O NodeAccess centraliza o acesso a recursos de infraestrutura e adota uma abordagem de proteção em camadas. O acesso à plataforma utiliza autenticação e mecanismos adicionais de verificação de identidade, conforme a configuração da organização. As comunicações web são protegidas por HTTPS. Os recursos disponíveis para cada usuário dependem das permissões atribuídas e das políticas aplicáveis.
>
> A proteção também depende de boas práticas de uso: não compartilhar contas, proteger fatores de autenticação e comunicar imediatamente atividades suspeitas.

**Atenção:** até login/MFA/HTTPS e permissões precisam ser confirmados no código/configuração antes de publicar. Não divulgar achados abertos ou detalhes exploráveis. Não usar selos ISO 27001/27002 nem dizer “certificado”, “em conformidade” ou “100% seguro” sem validação formal.

A página pública deve ser derivada de `CONTROLS.md`: cada alegação publicada deve possuir referência interna a controle comprovado. Conteúdo pendente fica fora da página pública.

## Critérios de aceite
- Inventário e arquitetura real documentados, incluindo confirmação do fluxo backend↔hosts.
- Matriz de controles com evidências e lacunas.
- Riscos críticos priorizados e correções aprovadas implementadas com regressão.
- Ferramentas e pipeline configurados de forma compatível, com execução segura e documentação.
- Testes multi-tenant, sessões, cofre, WebSocket e conectores executáveis.
- Documentação interna versionada e vinculada ao processo de desenvolvimento.
- Central de Segurança integrada à UI, clara e responsiva, com alegações verificadas.
- Resumo final: arquivos alterados, comandos executados, resultados, riscos residuais, pendências e instruções de rollback.

## Primeira resposta esperada do Codex
**Não começar implementando imediatamente.** Primeiro devolver: (1) arquitetura encontrada, (2) controles confirmados vs. hipóteses, (3) 10 riscos mais relevantes, (4) plano em PRs pequenos, (5) arquivos/documentos a criar, (6) testes e comandos propostos, (7) pontos que exigem aprovação. Depois executar em etapas com validação.

## Referências de trabalho
- OWASP ASVS: https://owasp.org/www-project-application-security-verification-standard/
- OWASP WSTG: https://owasp.org/www-project-web-security-testing-guide/
- OWASP API Security Top 10: https://owasp.org/API-Security/
- OWASP Cheat Sheet Series: https://cheatsheetseries.owasp.org/
- NIST SP 800-63: https://pages.nist.gov/800-63-4/
- CIS Benchmarks: https://www.cisecurity.org/cis-benchmarks
- ISO/IEC 27001 e 27002: referências de governança e controles; não implicam certificação.

---

# Extensão — Segurança adaptativa e proteção comportamental (03/11/2026)

## Decisões a validar pelo Codex

| Proposta | Decisão | Observações |
|---|---|---|
| IPs diferentes | Adotar com parametrização | Mudanças de IP, ASN, país e sessões concorrentes são sinais, não provas de ataque. VPN, CGNAT e redes móveis geram falsos positivos. |
| Hosts raramente acessados | Adotar com parametrização | Comparar com histórico, grupo, criticidade, horário e permissões. Preferir step-up ou aprovação ao bloqueio automático. |
| Fail2ban | Opcional na instalação Linux | Útil para sshd e logs confiáveis; não substitui rate limiting distribuído. Validar proxies, Docker, HA e firewall antes de ativar. |
| Perguntas de segurança | Não implementar | Respostas são adivinháveis ou descobríveis. Preferir passkeys, códigos de recuperação de uso único e recuperação administrativa auditada. |
| Aplicativo de aprovação | Planejar em fases | Android requer APK/AAB; iOS exige distribuição própria. Push é aviso, não fator de autenticação isolado. |

## Diretrizes de implementação

1. **Começar em modo diagnóstico e observação**, sem bloqueios novos em produção. Inspecionar autenticação, MFA, eventos, Redis, proxy, gateway, sessões e notificações antes de propor novos serviços.
2. Criar um **motor de risco explicável**: evento → sinais → decisão versionada → ação. Separar bloqueios determinísticos (ACL, token revogado, tenant incorreto, destino proibido) de decisões comportamentais.
3. Aplicar as decisões **no backend** antes de abrir SSH/RDP/SFTP, usar cofre, emitir tokens, autorizar WebSockets ou realizar operações sensíveis. Frontend apresenta avisos e desafios, nunca determina autorização.
4. Regras com herança instalação → tenant → grupo → usuário, limites globais inegociáveis, RBAC para configuração, validação, trilha de alterações, rollback e prévia de impacto. Definir precedência explicitamente.
5. Para HA, usar contadores compartilhados, TTL, idempotência e políticas de falha seguras. Não depender de contadores locais de uma instância. Medir latência p95/p99, falso positivo e impacto operacional.
6. Não introduzir machine learning ou fingerprinting invasivo inicialmente. Usar sinais interpretáveis, retenção mínima, LGPD, consentimento/base legal quando aplicável e informações claras ao usuário.
7. Toda regra deve possuir testes, monitoramento, modo observação, opção de desativação controlada e processo de recuperação de bloqueio. Não permitir bypass silencioso de superadmin.

## Catálogo de sinais

| Sinal | Exemplo | Reação preferencial |
|---|---|---|
| Novo IP / ASN / país | Mudança de operadora ou rede | Registrar; notificar ou exigir MFA adicional conforme risco agregado |
| Acesso simultâneo atípico | Sessões de redes distintas | Notificar e oferecer revogação seletiva; considerar VPN e redes móveis |
| Viagem aparentemente impossível | Logins distantes em curto intervalo | Sinal fraco; geolocalização de IP é imprecisa |
| Falhas repetidas | Login, MFA, API, SSH gateway | Backoff, rate limiting, bloqueio temporário graduado e auditoria |
| Host raro ou sensível | Primeiro acesso a host crítico | Step-up ou aprovação contextual |
| Enumeração de recursos | Muitos IDs de hosts/secrets negados | Negar por ACL, registrar e elevar risco |
| Exportação atípica | Downloads SFTP em massa, secrets ou gravações | Limites, step-up, aprovação e alertas |
| Alteração crítica | ACL, MFA, API key, cofre | Reautenticação forte, confirmação e auditoria |
| Token reutilizado | Refresh replay ou token revogado | Invalidar família quando apropriado e alertar |
| Destino proibido | Tentativa de alcançar metadata ou IP sem autorização | Bloqueio determinístico de egress |
| Novo dispositivo | Nova credencial de confiança | Confirmação forte e aviso ao titular |

Ações suportadas: `allow`, `allow_and_log`, `notify`, `step_up`, `require_approval`, `temporary_hold`, `deny`. Começar com `observe` → `notify` → `enforce`, após calibrar. Nunca bloquear somente por IP novo ou host raro. Mensagens externas não devem revelar scores e limiares exploráveis.

## Catálogo de parâmetros (exemplos para homologação; NÃO são defaults aprovados)

```yaml
security:
  adaptive:
    enabled: false
    mode: observe                 # observe | notify | enforce
    baseline_learning_days: 30
    history_retention_days: 90   # adequar à política de privacidade
    risk_decay_minutes: 60
    thresholds:                  # calibrar empiricamente
      notify: 30
      step_up: 60
      require_approval: 80
    signals:
      new_ip: {enabled: true, weight: 10}
      new_asn: {enabled: true, weight: 15}
      country_change: {enabled: true, weight: 15}
      unusual_host: {enabled: true, weight: 25, min_history_events: 20}
      denied_burst: {enabled: true, weight: 35, count: 10, window_minutes: 10}
      sensitive_action: {enabled: true, weight: 30}
    response:
      temporary_hold_minutes: 15
      notify_user: true
      notify_admin: true
  rate_limit:
    enabled: true
    login: {attempts: 5, window_minutes: 15}
    mfa: {attempts: 5, window_minutes: 10}
    host_access_denied: {attempts: 10, window_minutes: 10}
    dimensions: [account, tenant, trusted_client_ip]
  fail2ban:
    enabled: false
    profile: disabled            # disabled | host_linux | external
    ban_seconds: 900
    find_seconds: 600
    max_retries: 8
  mobile_approval:
    enabled: false
    challenge_ttl_seconds: 90
    number_matching: true
    require_device_unlock: true
    max_pending_per_user: 2
    bind_to_operation: true
```

**Validação de configuração:** tipos, faixas, dependências, precedência, escopo de tenant, versão da política, migrações e rollback. Não expor segredos, score interno ou configurações sensíveis na página pública. Definir retenção e minimização de IPs e metadados. Aceitar IP real apenas de proxies explicitamente confiáveis; jamais confiar indiscriminadamente em `X-Forwarded-For`.

## Fail2ban: desenho correto

- Distinguir **sshd do sistema operacional**, **SSH gateway da aplicação** e **conexões SSH de saída**. Jail `sshd` não protege automaticamente login web nem o gateway.
- Usar logs estruturados e saneados para falhas de API/web/gateway. Gerar filtros e testes com `fail2ban-regex`; nunca registrar senhas, tokens ou payloads sensíveis.
- Instalador opcional, idempotente, com detecção de distribuição, `systemd`, nftables/iptables/firewalld, Docker e proxy. Não alterar firewall automaticamente sem aprovação.
- Proteger contra bloqueio do proxy reverso, IP de NAT corporativo e outros IPs compartilhados. Em Docker, validar efetividade da cadeia de firewall, inclusive `DOCKER-USER` quando aplicável.
- Em HA, não assumir que jails locais sincronizam; usar defesa de borda e limites distribuídos. Documentar verificação (`fail2ban-client status`), logs, exclusões justificadas, desbloqueio e rollback.
- API/web devem ter rate limiting por conta, tenant, IP confiável e operação; Fail2ban é defesa adicional, não fonte principal de autorização.

## Recuperação de conta: não usar perguntas de segurança

- Preferir WebAuthn/passkeys, códigos de recuperação de uso único armazenados com hash adequado, e recuperação administrativa com verificação, aprovação separada quando necessário, cooldown e auditoria.
- Reset de MFA deve notificar usuário, revogar sessões/credenciais afetadas e prevenir enumeração e abuso por suporte.
- Se houver perguntas legadas, elaborar plano de descontinuação; não migrá-las como novo fator.

## Aplicativo Android/iOS: roadmap separado

**Fase A — Backend:** criar desafios de aprovação vinculados a `request_id`, usuário, tenant, operação, host, sessão, nonce, expiração e dispositivo autorizado. Estados idempotentes, anti-replay, revogação e auditoria. Nunca transmitir senhas ou PEM ao aplicativo.

**Fase B — Sem app:** priorizar passkeys/WebAuthn e step-up no navegador, quando adequados, antes de assumir custo e complexidade de apps nativos.

**Fase C — Apps:** Android APK/AAB e iOS TestFlight/App Store ou distribuição corporativa autorizada. Registrar dispositivo após autenticação forte; gerar chave privada não exportável quando suportado (Android Keystore, iOS Secure Enclave/Keychain). Push FCM/APNs serve para avisar; app consulta detalhes autenticados e assina confirmação vinculada à operação/nonce. Mostrar host, operação, contexto, expiração e número correspondente; exigir desbloqueio local e oferecer “não fui eu”. Limitar solicitações para evitar *MFA fatigue*. Prever revogação, perda e troca de celular.

**Fase D — App completo:** só após comprovar utilidade, suporte, custos e UX. Separar permissões de autenticação e futuras funções administrativas.

## Controles complementares para frontend e backend

- **Frontend:** CSP restritiva, proteção contra XSS, nenhum token em localStorage quando houver alternativa segura, cookies `HttpOnly/Secure/SameSite` conforme arquitetura, CSRF, validação de Origin em WebSocket, prevenção de clickjacking, sanitização de terminal e logs, UX de sessão expirada, reautenticação contextual e indicação clara de sessões ativas. Nunca considerar esconder botão como autorização.
- **Backend:** BOLA/IDOR e isolamento de tenants, ABAC/RBAC, autorização por operação, tokens de curta duração com rotação/revogação, API keys com escopo/expiração, schemas estritos, limites de payload, filas e concorrência, SQL parametrizado, SSRF/egress, validação SSH host key e RDP, criptografia de secrets, logs com integridade verificável, notificações de ações críticas e trilha de auditoria.
- **Operação:** TLS seguro, gestão de certificados, Docker sem privilégios excessivos, SBOM, scan de dependências, backups e restauração testada, gestão de vulnerabilidades, política de retenção, alertas e resposta a incidentes.
- **Privacidade:** coletar somente sinais necessários; restringir acesso ao histórico, permitir revisão de falsos positivos, definir retenção/exclusão e não publicar topologia, regras internas, scores ou thresholds.

## Documentação e página de segurança

Atualizar `docs/security/CONTROLS.md` com: controle, objetivo, implementação real, configuração, estado (`confirmado/parcial/ausente/planejado`), evidência, testes, proprietário e revisão. Criar `docs/security/ADAPTIVE_SECURITY.md` (motor, eventos, sinais, políticas, métricas, privacidade e resposta), `docs/security/FAIL2BAN.md` (matriz de compatibilidade, instalação opcional e rollback), `docs/security/ACCOUNT_RECOVERY.md` e `docs/security/MOBILE_APPROVAL_RFC.md`.

Na **Central de Segurança** pública/in-app, incluir seção “Proteção contra acessos suspeitos” com explicação em linguagem simples: a plataforma **pode** detectar atividades atípicas e solicitar confirmação adicional **apenas quando implementado e habilitado**. Distinguir recursos disponíveis, opcionais e futuros. Não revelar limiares, lógica antifraude, topologia, detalhes exploráveis ou prometer certificação ISO. Cada afirmação publicada deve referenciar controle comprovado no catálogo interno.

## Testes adicionais obrigatórios

1. IP muda legitimamente: sem bloqueio automático; desafio/aviso conforme política.
2. Acesso a host raro autorizado: não negar apenas por novidade; step-up quando configurado.
3. Acesso a host de outro tenant: negar sempre, independentemente do score.
4. Burst de falhas distribuído entre instâncias: contadores e reação consistentes.
5. IP forjado em `X-Forwarded-For`: ignorar cabeçalho de origem não confiável.
6. Proxy/NAT compartilhado: não bloquear todos os usuários por comportamento de uma conta.
7. Redis indisponível: fallback seguro, definido por operação e sem bypass de ACL.
8. Política em `observe`: não aplica bloqueios e registra decisões simuladas.
9. Mudança de política: versão, auditoria, propagação e rollback.
10. Fail2ban: regex não captura secrets, não bane proxy e jail atua efetivamente no caminho de rede testado.
11. Push duplicado/expirado ou aprovação de operação diferente: negar; impedir replay.
12. Dispositivo revogado ou conta com MFA resetado: não aprovar desafio antigo.
13. Simulação de *MFA fatigue*: limites e caminho “não fui eu”.
14. Métricas: latência, taxa de falsos positivos, notificações e bloqueios; testes de carga e regressão.

## Sequência de trabalho exigida do Codex

1. Auditar implementação existente em modo somente leitura.
2. Entregar diagnóstico e RFC com alternativas, impacto em UX, desempenho, custo e risco de lockout.
3. Propor PRs pequenos: eventos → parâmetros → modo observação → notificações → step-up → enforcement → Fail2ban opcional → backend de aprovação → apps (projeto separado).
4. Implementar somente após aprovação explícita das alterações estruturais e dos defaults.
5. Atualizar documentação interna, testes e Central de Segurança **apenas com capacidades verificadas**.



---

# Extensão — Identidade criptográfica e autenticação por chave pública SSH (05/11/2026)

> **Escopo:** requisitos para etapas 5 e 6 do plano executivo. **Não implementar nesta primeira entrega**; apenas documentar na Central de Segurança como planejado, se houver seção de roadmap claramente identificada. Confirmar primeiro o fluxo real: a afirmação de que SSH/RDP são estabelecidos somente pelo backend ainda requer verificação no código.

## A. Dois fluxos distintos que não devem ser confundidos

1. **Operador → SSH Gateway NodeAccess:** se houver endpoint SSH direto para operadores, permitir autenticação por chave pública individual, mapeada a identidade/tenant, com revogação, rate limit, auditoria e MFA/step-up quando exigido. Se o acesso for exclusivamente web, não inventar endpoint SSH: documentar a aplicabilidade e avaliar WebAuthn/passkeys para login do operador.
2. **NodeAccess Gateway → host gerenciado:** autenticar com credencial SSH protegida pelo Cofre, chave privada gerenciada ou certificado SSH temporário; autorização RBAC/ACL e tenant antes de qualquer conexão. Não transmitir chaves privadas ao browser, plugins ou logs. Evitar compartilhamento de identidade privilegiada sem rastreabilidade por operador.

## B. Controles obrigatórios e compatibilidade

- Preferir **Ed25519** onde suportado; permitir RSA com assinaturas SHA-2 para legados compatíveis, sob política explícita. Não habilitar `ssh-rsa`/SHA-1 ou algoritmos obsoletos por conveniência.
- **Verificação estrita da host key**: cadastro/pinning de fingerprint e processo de aprovação para primeira confiança ou troca de chave; detectar mudanças inesperadas e bloquear por padrão. Nunca usar `StrictHostKeyChecking=no` em produção; não confiar cegamente na primeira conexão.
- Inventariar compatibilidade por tipo de destino (Linux/OpenSSH, appliances de rede, versões e algoritmos). Não pressupor que todos suportem OpenSSH certificates ou Ed25519.
- Isolar geração/uso de chaves privadas no backend ou serviço de assinatura, com menor privilégio, criptografia autenticada em repouso, gestão segura de chaves mestras, backups, rotação e recuperação. KMS/HSM/Vault são opções a avaliar, não requisitos presumidamente implementados.
- Proibir agent forwarding por padrão; limitar port forwarding, comandos e canais conforme políticas e capacidade do protocolo/destino. Não prometer bloqueio absoluto de comandos somente pela interface.
- Proteger contra SSRF e DNS rebinding na resolução de destinos, restringir egress e revalidar autorização no momento da conexão.
- Registrar emissões, uso, falhas, mudanças de host key, rotação e revogação, sem material secreto nos eventos.

## C. SSH CA — PoC de certificados temporários (etapa 6)

- CA de usuários SSH isolada do processo web, com assinatura mediante autorização forte e trilha auditável. Não expor chave privada da CA à aplicação nem criar criptografia própria.
- Certificado com `principals`, validade curta, identidade e escopo adequados, associado à operação/usuário/tenant e à chave pública do gateway destinada à sessão.
- Destinos devem configurar explicitamente confiança na CA e mapeamento de principals/contas. Certificados de usuário e certificados de host são conceitos diferentes; avaliar ambos separadamente.
- Expiração impede novas autenticações com certificado vencido, **não encerra sessões SSH já abertas**. Implementar revogação operacional com término da sessão no gateway e, onde aplicável, KRL/atualização de confiança no host.
- Planejar indisponibilidade da CA, rotação da CA, rollback, migração gradual e exceções por host sem downgrade silencioso de segurança.

## D. Parametrização proposta (somente esquema conceitual; defaults dependem de avaliação)

| Parâmetro | Escopo | Regra |
|---|---|---|
| `ssh.auth.methods_allowed` | instalação/tenant/grupo/host | Métodos permitidos; nunca habilitar senha automaticamente como fallback após falha de chave. |
| `ssh.user_public_key_auth.enabled` | instalação/tenant | Somente se existir endpoint SSH de operador; registrar chave e owner. |
| `ssh.host_key.verification_mode` | instalação/tenant/host | `strict` como padrão seguro; exceções apenas com aprovação e auditoria, se tecnicamente indispensáveis. |
| `ssh.host_key.rotation_approval` | instalação/tenant/host | Workflow de aprovação para mudanças de fingerprint. |
| `ssh.keys.allowed_algorithms` | instalação/tenant/host | Lista compatível e revisada. |
| `ssh.keys.rotation_policy` | instalação/tenant/host | Prazo/alertas/rotação e procedimento de emergência. |
| `ssh.agent_forwarding.enabled` | instalação/tenant/host | `false` por padrão. |
| `ssh.ca.enabled` | instalação/tenant/host | Ativação gradual após PoC e configuração dos destinos. |
| `ssh.ca.cert_ttl` | instalação/tenant/grupo/host | TTL curto definido por risco, com limites mínimos/máximos. |
| `ssh.ca.allowed_principals` | host/grupo | Principals permitidos derivados de autorização backend, nunca de input arbitrário. |
| `ssh.session.revocation_mode` | instalação/tenant | Encerramento de sessões ativas após perda de permissão/revogação, com política clara. |
| `ssh.step_up.required_for_critical` | instalação/tenant/grupo | MFA adicional para operações sensíveis. |

**Políticas:** definir precedência e herança (instalação → tenant → grupo → host, com resolução de conflitos que não amplie privilégios inadvertidamente), versionamento, modo observação quando aplicável, trilha de alterações, rollback e validação server-side. Configurações não devem ser controláveis por frontend sem autorização administrativa.

## E. Testes e critérios de aceite para etapas 5–6

1. Autenticação válida por chave pública funciona sem exposição de chave privada em navegador, logs ou traces.
2. Chave revogada, usuário desabilitado, ACL retirada ou tenant incorreto não inicia nova sessão; revogação de sessão ativa segue política documentada.
3. Troca inesperada de host key falha de forma segura; aprovação legítima e auditada permite retomada.
4. Algoritmo legado não permitido é rejeitado; compatibilidade suportada é testada por família de destino.
5. Certificado expirado, principal incorreto, assinatura inválida ou CA não confiável é rejeitado pelo host.
6. TTL curto e encerramento de sessão ativa são validados como mecanismos distintos.
7. CA indisponível não provoca fallback silencioso para senha ou credencial menos segura.
8. Eventos têm correlação operador → tenant → gateway → host → sessão, sem vazar credenciais.
9. Carga e latência de emissão, conexão, rotação e revogação são medidas; nenhuma regressão relevante de UX.
10. Documentação técnica, catálogo de controles e Central de Segurança são atualizados **somente após verificação**.

## Instrução final ao Codex

**Comece pela etapa 0 (inventário mínimo) e etapa 1 (Central de Segurança).** Leia todas as seções deste documento como requisitos de longo prazo, mas não confunda o plano com autorização para implementar todas as fases. Apresente primeiro o diagnóstico e proposta da Central; aguarde aprovação para mudanças estruturais. Os controles SSH por chave pública e CA devem constar no backlog técnico e na documentação interna até serem implementados e testados.
