---
change_id: NA-0201
title: Criar e editar itens pessoais pela extensão (E3)
type: feature
status: blocked
created_at: 2026-11-24T16:10:06-03:00
base_branch: master
base_sha: 9d2fc71768a0e7aee34a6495e4ec11eceb338076
branch: feature/NA-0201-20261124-extension-personal-items
owner: unassigned
planner: Codex
risk: medium
issue: null
---

# NA-0201 — Itens pessoais pela extensão

## Contexto e situação anterior

Retomada a partir do handoff NA-0189 de 2026-11-24. Antes desta frente o cliente da extensão oferecia busca, conexão, prova e revelar/copiar; não oferecia criação ou edição. As rotas do portal em `modules/secrets/secret.routes.ts` usam `requireAuth`; não devem aceitar tokens da extensão indiscriminadamente. Base confirmada por fetch antes de criar a branch.

## Problema e objetivo

Permitir cadastrar e manter Secret pessoal, importar PEM pessoal e gerar senha no popup, preservando autorização, validações e auditoria do portal.

## Escopo

- Criar e editar Secret pessoal (metadados e substituição explícita do valor).
- Importar PEM pessoal, sem exportar material privado.
- Gerador criptograficamente seguro de senha no formulário.
- Contratos, endpoints restritos à extensão, cliente, popup, testes e manual dos fluxos afetados.
- Excluídos: escrita compartilhada/ADR-02, login de site/URL, autofill, content scripts, exclusão de itens e mudança das políticas de revelar/copiar.
- Pendências anteriores permanecem rastreadas separadamente: Windows Hello real, Sonar das frentes anteriores, metas 2027 e triagem OpenSSL.
- Continuidade autorizada em 2026-11-24: validar formulário/contrato antes de enviar, mantendo material somente na janela ativa em erros locais e focando o campo inválido. Sem alterar limpeza após falha remota ou expiração. Refinamento da E3 existente, sem misturar implementação E4 nesta branch.

## Critérios de aceitação

- [x] Criar Secret sempre no tenant e usuário autenticados; campos de ownership/escopo adulterados não permitem elevar acesso.
- [x] Editar somente Secret pessoal próprio; negar item alheio, compartilhado e de outro tenant, inclusive por ID direto.
- [x] Editar metadados não exige revelar o valor atual nem o substitui implicitamente; substituir valor é ação explícita.
- [x] Importar PEM aplica as validações existentes do portal e não retorna material privado.
- [x] Chamadas de escrita exigem autorização vigente da extensão e DPoP válido; expiração, revogação, replay e corpo inválido são testados.
- [x] Auditoria registra operações sem senha, PEM, passphrase ou token.
- [x] Formulário cobre carregamento, erro, sucesso, cancelamento e sessão expirada; evita envio duplicado e limpa material sensível ao encerrar o fluxo/desconectar.
- [x] Gerador usa Web Crypto; senha e PEM não entram em armazenamento persistente, recents ou logs.
- [x] Popup funciona por teclado e na largura real; lista reflete a alteração após sucesso.
- [ ] Gates aplicáveis passam, incluindo Sonar e revisão independente; homologação humana é registrada separadamente.

## Estratégia técnica

1. Verificar branch/base e executar baseline antes de editar aplicação.
2. Inspecionar serviços/controllers de Secret e PEM e contrato de segurança. Reusar regras de negócio abaixo da autenticação do portal, sem encaminhar token de extensão como sessão web. Autorizar ownership no servidor em cada operação.
3. Acrescentar contratos mínimos em `packages/shared` e handlers no domínio `apps/backend/src/modules/vault-security`, com métodos permitidos explicitamente e limites de payload apropriados ao PEM.
4. Estender `apps/extension/src/core/client.ts` e formulários do popup, preservando prova e entrega existentes. Um componente de formulário isolado será usado se evitar ampliar o App.vue com regras de edição.
5. Aplicar a skill do manual ao alterar fontes mapeadas; atualizar hashes apenas após revisão. Consolidar roadmap em uma escrita por interação que mudar seu estado.

## Riscos e mitigações

| Risco | Impacto | Mitigação | Critério de parada |
|---|---|---|---|
| Escrita fora do escopo pessoal | Alteração indevida de credencial | ACL no servidor, testes entre usuários e tenants | Qualquer bypass |
| Vazamento de senha/PEM | Exposição de credencial | Estado volátil, respostas mínimas, auditoria sem valores | Material em logs/storage |
| Divergência do portal | Validações inconsistentes | Reusar serviço e schemas; testar PEM inválido | Necessidade de duplicar regra sem equivalência |
| Edição apagar valor atual | Perda de credencial | Substituição explícita e teste de metadados | Atualização implícita do valor |
| Mudança ampla de autorização | Regressão de acesso | Adaptador restrito à extensão; reavaliar plano se ampliar risco | Alteração transversal de auth |

## Matriz de testes e evidências

| Critério/risco | Teste | Evidência | Obrigatório |
|---|---|---|---|
| Contratos e validação | Shared + serviços/routes de Secret/PEM e extensão | Resumo de execução | Sim |
| ACL, tenant, DPoP, revogação | Testes negativos e de integração existentes ampliados | Casos e resultados | Sim |
| Cliente, formulário e gerador | Vitest extensão + typecheck/build | Resumo e falhas | Sim |
| Fluxo real do popup | `npm run test:extension:web` com dados descartáveis | Harness navegador | Sim |
| Qualidade e segurança | lint aplicável, security scan, `npm run validate:sonar` | Gate, cobertura nova >= 80%, achados | Sim |
| Manual e governança | `manual:check-reviewed`, change-governance | Resultado | Sim |
| Revisão independente | Validador separado com plano/diff/evidências | PASS/FAIL/BLOCKED | Sim |
| Uso humano | Criar, editar metadados, trocar valor e importar PEM descartável | Homologação do responsável | Sim |

Não são previstos testes de terminal/PTY: esta fatia não altera terminal, resize, WebSocket ou transporte SSH.

## Baseline

- SHA: `9d2fc71768a0e7aee34a6495e4ec11eceb338076`.
- Executado: inspeção do handoff, status, referências locais e pontos de integração.
- Antes deste planejamento, único arquivo não rastreado: handoff do usuário, preservado.
- Baseline: 147 testes passaram; 5 testes opt-in (MySQL/SSH) ignorados em 18 arquivos. Execução em 2026-11-24, Node do wrapper dev, antes de editar código.
- Ambiente: alguns comandos de leitura falharam intermitentemente na inicialização do sandbox (`bwrap`, diretório `.aws`); leituras simples funcionaram em novas chamadas.

## Rollback ou recuperação

Remover a superfície de escrita da extensão e reverter os arquivos da frente. Não há migração planejada; itens já criados permanecem administráveis pelo portal. Não apagar credenciais criadas durante uso. Preservar o handoff e alterações do usuário.

## Mudanças de escopo e decisões

- E3 aprovada explicitamente pelo usuário: “Aprovo, pode seguir”.
- Fetch executado; HEAD e origin/master confirmados no SHA base. Branch proposta criada; handoff preservado. Commit/publicação não solicitados.
- Roadmap: atualizado em uma escrita nos IDs META-005/017/050, com decisão na linha 38 de Revisões; NA-0194..0200 reconciliadas conforme handoff e E3 registrada em validação local.
- Revisão independente exigiu escrita e auditoria na mesma transação da autorização, leitura de PEM sem corrida e erro específico de item revogado. Correções implementadas e revisadas, parecer estático final PASS. Evidências em `test-results.md`.
- Correções necessárias: `ensureCanManage` passou a síncrono para atender lint sem alterar regra; reporter textual no harness MySQL expõe falhas de inicialização omitidas no JSON. Sem dependências, migração ou mudança na política de entrega.
- Gate final bloqueado: Sonar não iniciou por ausência dos tokens separados; homologação humana E3/Windows Hello pendente. Não declarar ready-for-tests/entregue apesar dos testes locais aprovados.

## Aprovação

- Decisão: `GO_WITH_RISKS` (nova superfície de escrita de credenciais).
- Aprovado por: usuário, nesta conversa.
- Aprovado em: 2026-11-24 (registrado antes da implementação).
- Gate: skill lifecycle exige aprovação explícita do plano para mudança material antes de editar aplicação.
