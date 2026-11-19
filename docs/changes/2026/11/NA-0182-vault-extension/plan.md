---
change_id: NA-0182
title: Extensão VaultNAccess para navegador com acesso e cadastro de credenciais
type: feature
status: planned
created_at: 2026-11-19T10:40:00-03:00
base_branch: master
base_sha: d5b59bf6d67709e7942fe4a73f5ab09badf14f04
branch: feature/NA-0182-20261119-vault-extension
owner: Jeferson Quintana
planner: Claude Code
risk: high
issue: null
---

# NA-0182 — Extensão VaultNAccess (programa e arquitetura)

## Contexto e situação anterior

O cofre já tem avaliação e ADRs propostos (NA-0175 `assessment.md` §5, §6, §9, §11, §13; `vaultnaccess-addendum.md`), contrato de segurança (NA-0177 `security-contract.md` §4–§11, aceites SEC-01..18), sessão isolada e entrega cifrada por operação (NA-0178, em desenvolvimento) e revelação/cópia no portal (NA-0179, pronta para testes). A extensão é o item 3 da ordem de entrega do adendo. Stack: backend Fastify + Zod (`apps/backend`, módulos `secrets`, `pem-keys`, `vault-security`), frontend Vue + Vite, contratos em `packages/shared`.

## Problema e objetivo

Pedido do responsável em 2026-11-19: uma extensão no nível de um gerenciador de senhas como o 1Password. O usuário acessa as credenciais compartilhadas do NodeAccess que tem permissão de ver e as credenciais pessoais. Salva URLs, chaves e senhas pela extensão como faz hoje no portal. Exige mais esforço de segurança e arquitetura que facilite mudanças futuras.

Esta frente define o programa: arquitetura, modelo de ameaças incremental, fatias de entrega e gates. Cada fatia de código é uma frente própria (plano, testes, Sonar, revisão independente, homologação). Nenhum código nesta frente.

## Escopo

- Dentro: arquitetura da extensão e dos contratos; decisões ADR-04 (cliente) e ADR-05 (plataformas) para aprovação; fatias E1–E7 com dependências e critérios; testes de segurança adicionais (EXT-01..14); empacotamento e cadeia de suprimentos.
- Itens: logins web (URL + usuário + senha), URLs sem segredo, Secrets (senha/token) e chaves PEM. Escopos: pessoal e compartilhado do tenant (o que o portal chama de credenciais da organização), sempre pela ACL do servidor.
- Fora (gates próprios, depois): preenchimento automático/inline, captura de senha ao enviar formulário, bridge nativa, mobile, E2EE geral, publicação em loja, Firefox e Safari.

## Critérios de aceitação

- [x] Responsável aprova a arquitetura, as fatias e as decisões de ADR-04/05 abaixo (ou registra alterações).
- [ ] Login na extensão só para usuário com a permissão `extension` ativa; revogação corta acesso existente.
- [ ] Cada fatia tem dependências, gate de segurança e rollback definidos antes do código.
- [ ] Nenhuma decisão contradiz `security-contract.md`; divergências viram revisão do contrato, não exceção silenciosa.
- [ ] Planilha de metas registra a NA-0182 como ideia/planejamento, sem prazo inventado.

## Estratégia técnica

### Decisões propostas

| ADR | Proposta | Motivo |
|---|---|---|
| 05 — plataformas | Chrome e Edge (Chromium, Manifest V3) primeiro, Windows como SO de homologação; Firefox depois, via adaptador próprio | Uma base MV3 cobre os dois; Firefox difere em background/permissões |
| 04 — cliente | Cliente público OAuth 2.1 com Authorization Code + PKCE, consentimento na origem do portal (`chrome.identity.launchWebAuthFlow`), sem segredo de cliente. Instância registrada com chave de dispositivo não exportável (WebCrypto) e prova de posse por requisição. Sessão própria, nunca reaproveitando tokens do portal | Contrato NA-0177 §4/§9; evita roubo de token por outra extensão ou página |
| Elegibilidade | Uso da extensão é permissão por usuário (`extension`), negada por padrão e concedida pelo admin no mesmo fluxo de concessões do cofre (`VaultChange` `grant` em `apps/backend/src/modules/vault-security/vault-domain.ts`, com proposta/auditoria). Checada pelo servidor no consentimento (antes de emitir código), na troca/renovação de token e em cada requisição; revogar invalida clientes e sessões da extensão do usuário | Pedido do responsável em 2026-11-19; a regra fica no servidor, não na UI |
| Sessão | Três níveis separados: login (SSO), desbloqueio do cofre (sessão NA-0178, relógio absoluto do servidor) e concessão por operação (reveal/copy/write/fill) | Bloquear/revogar propaga; desbloquear um cliente não libera os outros |
| Escrita | Reaproveita os serviços do portal (`SecretService`, `PemKeyService`, futuro `WebCredentialService`); a extensão é só outro cliente da mesma API, ACL, validação e auditoria | Uma regra de negócio, um lugar |

### Arquitetura da extensão (portas e adaptadores)

```
apps/extension/
  src/core/        domínio puro (casos de uso: buscar, abrir, revelar, salvar, bloquear); sem API do navegador
  src/ports/       interfaces: VaultApi, AuthClient, SessionStore, Clipboard, Tabs, Crypto, Clock
  src/adapters/
    chromium/      chrome.* (MV3): service worker, storage.session, identity, tabs, clipboard
    http/          cliente HTTP gerado dos esquemas Zod de packages/shared (/api/v1/vault/...)
  src/ui/          popup e painel lateral em Vue, sem estado secreto em store global
  manifest/        manifest base + overlays por navegador/canal
packages/shared/src/vault/   contratos versionados (itens, operações, capacidades, erros)
```

Para facilitar mudanças:
- Domínio sem dependência do navegador; trocar Chrome→Firefox ou popup→painel lateral muda só o adaptador ou a UI.
- Contratos únicos em `packages/shared` validados nos dois lados; mudanças aditivas por versão de API.
- `GET /api/v1/vault/capabilities` devolve operações, flags (`vault-reveal`, `vault-copy`, `vault-write`, `vault-fill`), tipos de item suportados e versão mínima do cliente. A extensão se adapta ao servidor e o servidor pode desligar funções ou exigir atualização sem nova publicação.
- Tipos de item como união discriminada com registro de formulários (`kind` → esquema, formulário, ações permitidas); novo tipo = novo registro, não `if` espalhado.

### Controles de segurança (mínimos para qualquer fatia)

- MV3 com CSP restrita: sem código remoto, `eval`, `externally_connectable`, `web_accessible_resources` ou content scripts até o gate de fill.
- Permissões: `storage`, `identity`, `activeTab`, `clipboardWrite`; host permission apenas da origem do NodeAccess configurada; nada de `<all_urls>`.
- Tokens só em memória do worker ou `chrome.storage.session` (somente contextos confiáveis); refresh vinculado à chave do dispositivo; nada em `localStorage`, `sync` ou disco em claro.
- Segredos: buscados por operação (concessão de uso único e entrega cifrada da NA-0178), exibidos mascarados, auto-ocultar ≤15 s, nunca em logs, URL, storage, título ou atributos do DOM (contrato §9). Formulário de cadastro não persiste rascunho com segredo.
- Mensagens internas com esquema Zod e verificação de remetente; o popup não recebe tokens.
- Compartilhados: leitura conforme ACL/entitlement; criação/edição em escopo compartilhado exige permissão própria. O padrão ao salvar é o escopo pessoal.
- Servidor sempre reautoriza; as capacidades devolvidas são só orientação de UI.
- Cadeia de suprimentos: dependências mínimas fixadas no lockfile, build reproduzível em CI, SBOM, hash SHA-256 publicado, Grype e Sonar, manifesto revisado a cada release, ID estável por canal.

### Fatias de entrega (cada uma com Change ID próprio)

| Fatia | Conteúdo | Depende de | Gate para liberar |
|---|---|---|---|
| E1 | Esqueleto MV3 + portas/adaptadores; permissão `extension` por usuário (backend + tela de admin); login PKCE, registro do dispositivo, bloquear/sair; buscar e abrir item/host (só metadados, pessoais e compartilhados) | NA-0176, NA-0178 mergeadas; endpoint de capacidades | SEC-02/06/13/18 + EXT-01..06; revisão independente |
| E2 | Detalhe do item com Revelar/Copiar senha | E1; NA-0179 homologada | SEC-01..12, EXT-07..09 |
| E3 | Cadastrar/editar pessoais: Secret, chave PEM (importar, sem exportar), URL, gerador de senha | E1; para URL/login web, domínio 1B no backend (frente própria) | Mesma ACL/validação/auditoria do portal; EXT-10..12 |
| E4 | Cadastrar/editar em escopo compartilhado | E3; permissão de escrita compartilhada definida (ADR-02) | Testes de ACL cruzada/tenant; revisão de auditoria |
| E5 | Desbloqueio com Windows Hello (WebAuthn na origem do portal) | E1; PoC WebAuthn do contrato §11 | SEC-16, sem downgrade silencioso |
| E6 | Distribuição piloto pelo portal (ZIP, hash, instruções) | E2 | Adendo §distribuição; sem segredo no pacote |
| E7 | Preencher ao clicar (piloto) e “salvar este login” manual na página atual | E2, E3, ADR-03 | SEC-11/17, EXT-13..14, pentest externo, kill switch |

Antes de usar senhas reais: revisão independente de segurança de E1–E3 e teste adversarial (página maliciosa, outra extensão, perfil roubado).

## Riscos e mitigações

- Extensão comprometida ou atualização maliciosa: canal de build controlado, hash, permissões mínimas, revogação de cliente pelo servidor (versão mínima via capacidades).
- Roubo de perfil ou dispositivo: sessão de cofre curta no servidor, chave de dispositivo não exportável, revogação por dispositivo, sem segredos em disco.
- Páginas e outras extensões: sem content script até E7; nenhuma superfície exposta (`externally_connectable` ausente).
- Escrita indevida em compartilhados: escopo pessoal por padrão, permissão própria e auditoria.
- Escopo grande: fatias independentes com feature flags; cada uma pode ser desligada sem afetar SSH/RDP (contrato §10).
- Dependências do backend (NA-0176/0178/0179 e domínio 1B) ainda abertas: E1 só começa com elas mergeadas.

## Matriz de testes e evidências

Por fatia: unitários do domínio (sem navegador), contratos Zod compartilhados, integração da API com dados descartáveis, E2E com a extensão carregada (Playwright + Chromium), `npm run validate:sonar`, Grype do pacote, revisão independente. Testes de segurança SEC-01..18 do contrato mais:

| ID | Cenário | Resultado esperado |
|---|---|---|
| EXT-01 | Página ou outra extensão envia mensagem ao worker | Rejeitada; sem resposta com dados |
| EXT-02 | Inspeção de `storage.local/sync`, IndexedDB e logs após uso | Nenhum token reutilizável ou segredo |
| EXT-03 | Callback PKCE com state/verifier/redirect errado ou repetido | Sem token |
| EXT-04 | Chave de dispositivo copiada para outro perfil | Requisições negadas |
| EXT-05 | Troca de tenant e logout central | Cache de metadados descartado; operações negadas |
| EXT-06 | Servidor exige versão mínima maior | Extensão bloqueia e orienta atualizar |
| EXT-07 | Popup fechado durante revelar/copiar | Concessão não reaberta; nada persistido |
| EXT-08 | Item compartilhado sem entitlement de extração | Revelar/copiar negados |
| EXT-09 | Revogação concorrente ao revelar | Linearizado; sem entrega após revogação |
| EXT-10 | Salvar em escopo compartilhado sem permissão | Negado e auditado |
| EXT-11 | Fechar popup com formulário de senha preenchido | Rascunho com segredo não persistido |
| EXT-12 | PEM importado | Nunca exportado pela extensão |
| EXT-13 | Fill em iframe, HTTP, origem parecida | Negado |
| EXT-14 | Kill switch `vault-fill` | Concessões invalidadas |
| EXT-15 | Usuário sem permissão `extension` tenta login (local, SSO, MFA) | Consentimento negado, nenhum código/token emitido, evento auditado |
| EXT-16 | Permissão `extension` revogada com extensão aberta e token válido | Próxima requisição/renovação negada; cliente revogado; dados locais descartados |

## Baseline

Sem extensão. Portal com catálogo unificado (NA-0175 1A) e revelação em teste (NA-0179). Sem domínio de login web/URL com segredo (1B).

## Rollback ou recuperação

Documental nesta frente. Nas fatias: feature flags no servidor, revogação de clientes, versão mínima e remoção do pacote piloto. Dados criados pela extensão ficam nos mesmos serviços do portal e continuam acessíveis por ele.

## Mudanças de escopo e decisões

2026-11-19: o responsável ampliou o objetivo de “descoberta sem segredos” (fase 2 da avaliação) para acesso e cadastro completos no nível de um gerenciador de senhas, com prioridade em segurança e evolutividade. A fase 2 vira E1, e as fases 3A/3B/4 da avaliação viram E2–E7. Plano aprovado no mesmo dia; adicionada a permissão por usuário `extension` para login na extensão.

## Aprovação

Decisão: `GO`

Aprovado pelo responsável em 2026-11-19 (arquitetura, fatias, Chrome/Edge primeiro, OAuth com PKCE). Credenciais compartilhadas = itens da organização que a ACL permite ao usuário. Exigência adicional: login na extensão só com permissão por usuário. Cada fatia ainda precisa de plano e gates próprios; a E1 aguarda NA-0176/NA-0178 mergeadas.
