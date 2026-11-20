# NA-0183 — Registro da implementação

Base: 8ef8188a6af1ee0b8180a9707ad54b54b8fd4002. Branch: feature/NA-0183-20261119-vault-extension-e1.

## Pedido e objetivo

Primeira fatia (E1) da extensão VaultNAccess aprovada na NA-0182: permissão `extension` por usuário, conexão segura (PKCE + DPoP, sem refresh no piloto), busca de metadados de itens pessoais e compartilhados e abertura no portal.

## Implementação

Plano em rascunho; nenhuma alteração de aplicação. Também encerrados os registros desatualizados da NA-0176, NA-0178 e NA-0179 (status `closed` com o merge de cada PR).

## Validação

Ran: leitura do módulo `vault-security` (rotas, portas, identidade de origem, concessões e migração), do catálogo do portal e do contrato NA-0177 §4; consulta das PRs 65/68/69 na API do GitHub (MERGED). Planned: baseline e testes descritos no plano.

## Recuperação

Reverter o commit desta frente; nenhuma alteração de código ou banco até a aprovação do plano.

## Pendências

NA-0184 integrada (pré-requisito). Depois: baseline, implementação, Sonar e revisão independente.

## Diário de interações

### 2026-11-19T16:15:00-03:00 — Encerramentos e plano da E1

Responsável pediu para atualizar os registros das dependências e iniciar a E1. PR65/68/69 confirmadas como mergeadas; os registros passaram a `closed`. A pendência da NA-0176 (PR61/62) é de frentes antigas fora do escopo, ainda acompanhadas na META-050. Plano da E1 escrito; corrigida a divergência com o contrato (sem refresh no piloto). Limitação encontrada: o cofre só aceita sessão central local, então SSO fica fora da E1. Próximo: aprovação do plano.

### 2026-11-19T16:45:00-03:00 — Método de login não restringe o uso

Responsável definiu que o uso da extensão depende só da permissão, não do método de login; escolheu tratar a confirmação por método em frente própria antes da E1 (NA-0184) e negar break-glass. Ran: leitura de `auth.service.ts` (refresh e logout iguais para todos os métodos), `oidc-flow.service.ts`, `oidc-auth.service.ts` e `ldap-identity.provider.ts`. Plano da E1 ajustado; SSO deixa de ficar fora. Roadmap numa escrita (META-005, META-017, revisão 37; hash 860933136265 → fe77a79275a6). Próximo: aprovação dos planos NA-0184 e NA-0183.

### 2026-11-19T17:00:00-03:00 — Plano aprovado

Responsável aprovou o plano; status `planned`. Começa após a NA-0184 integrada.
