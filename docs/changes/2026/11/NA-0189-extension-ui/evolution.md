# VaultNAccess (extensão) — plano de evolução

Revisão em 2026-11-23 do programa NA-0182 (fatias E1–E7), com o que já foi entregue e a ordem recomendada a partir de agora. Cada fatia é uma frente própria (Change ID, plano, revisão independente, e2e) e só começa com a anterior homologada.

## Estado atual

| Entrega | Situação |
|---|---|
| E1 — conectar pelo portal (PKCE + chave do dispositivo + DPoP), buscar e abrir itens (só metadados), recentes, desconectar | NA-0183, mergeada; homologada pelo responsável em 2026-11-23 |
| Confirmação de identidade por método (local/LDAP/OIDC/Google) | NA-0184, mergeada |
| Permissão **Usar extensão** pela guia Usuários e por dois gestores | NA-0186/NA-0188 |
| Visual do popup (tema do portal, claro/escuro, estados) | NA-0189 (esta frente) |

Garantias que valem para todas as fatias: nenhum valor secreto persistido na extensão; autorização só em `storage.session`; chave do dispositivo não exportável; permissões mínimas do manifesto (`identity`, `storage`, origem do portal); CSP sem script remoto; servidor decide tudo.

## Ordem recomendada

### 1. E1.2 — Uso diário (baixo risco, sem mudar segurança)
- Entregue na NA-0192 (busca ao digitar, teclado, `Alt+Shift+V`, idioma do portal). O host do item virou frente própria: o portal só lista hosts de um Secret para quem pode gerenciá-lo e sem filtrar pela ACL de hosts do usuário.
- Busca enquanto digita (com espera curta) e navegação por teclado (↑/↓/Enter, `/` para focar a busca).
- Atalho de teclado para abrir o popup (`commands` do manifesto, sem permissão nova).
- Mostrar o host associado ao item quando o portal já devolver (só metadado) e abrir o host no portal.
- Idioma pelo idioma do portal do usuário (hoje fixo em pt-BR).
- Testes: unitários do popup + `test:extension:web`.

### Entregue fora da ordem: dispositivo confiável (NA-0193)
- Reconexão automática enquanto o login do portal estiver ativo e só com o código do autenticador quando não estiver, por 7 dias após a autorização completa (pedido do responsável após usar o **Atualizar** da NA-0190).

### 2. E6 — Distribuição piloto pelo portal (antes de E2, porque já há uso real)
- Entregue na NA-0194: ícones, `npm run package:extension` (ZIP reprodutível, CRX3 assinado, `update.xml`, `release.json`), publicação validada pelo servidor (`VAULT_EXTENSION_PACKAGE_DIR`) e cartão **Instalar a extensão** com a política para administradores.
- Ícones PNG do manifesto (16/32/48/128) com a identidade do NodeAccess.
- Pacote ZIP gerado no build com ID fixo (chave do manifesto), hash SHA-256 publicado no portal e página de instalação com instruções (Chrome/Edge, modo desenvolvedor no piloto; política corporativa `ExtensionInstallForcelist` para produção).
- Verificação de versão mínima já existente (`upgrade`) ligada ao pacote publicado.
- Gate: nenhum segredo no pacote; reprodutibilidade do build; revisão de cadeia de suprimentos.

### 3. E2 — Revelar e copiar senha na extensão
- Detalhe do item com **Revelar**/**Copiar**, reutilizando a entrega do cofre (NA-0178/0179): JWE cifrado para a chave do dispositivo, confirmação de identidade pelo método do login, tempo de confirmação do tenant (NA-0186) e permissões separadas por ação.
- Copiar com limpeza da área de transferência após prazo curto e aviso; revelar some sozinho em segundos; nada em DOM depois de fechar.
- Gate: cenários SEC-01..12 e EXT-07..09 do contrato; teste adversarial (outra extensão, página maliciosa, perfil copiado); revisão independente de segurança.

### 4. E5 — Desbloqueio com Windows Hello / passkey
- WebAuthn na origem do portal como confirmação de identidade (alternativa a senha+TOTP), sem rebaixar silenciosamente para método mais fraco.
- Gate: PoC do contrato §11 e SEC-16.

### 5. E3 — Cadastrar e editar itens pessoais pela extensão
- Secret pessoal, importar chave PEM (sem exportar), gerador de senha; mesma validação, ACL e auditoria do portal.
- Para "login de site" (URL + usuário), depende do domínio de itens web no backend (frente própria).

### 6. E4 — Cadastrar e editar itens compartilhados
- Depende da regra de escrita compartilhada (ADR-02) e de testes de ACL cruzada e de tenant.

### 7. E7 — Preencher ao clicar e "salvar este login" (piloto)
- Exige `content_scripts`/`activeTab` (mudança de permissões), correspondência rígida de domínio, interface fora da página (sem injetar o valor antes do clique), interruptor geral pelo servidor.
- Gate: SEC-11/17, EXT-13..14, pentest externo antes de uso com senhas reais.

### Depois
- Firefox (WebExtensions) e Safari quando o Chrome/Edge estiver estável.
- Métricas de uso agregadas e sem conteúdo (número de buscas/aberturas) para orientar prioridades.

## Riscos do programa
- Cada fatia aumenta a superfície: E2 traz valores ao navegador da extensão e E7 traz a página do site para perto do valor. Por isso a ordem põe distribuição controlada e revisão antes de valores, e preenchimento por último.
- Planilha do roadmap 2027 (META-017/META-050) a atualizar quando houver ferramenta de edição.
