---
change_id: NA-0175
title: Planejar VaultNAccess e extensão de navegador
type: feature
status: planned
created_at: 2026-11-15T16:28:40-03:00
base_sha: 745253d1edb522db79aaa44fd96608ce434a2774
branch: feature/NA-0175-20261115-vaultnaccess
risk: high para implementação futura; baixo para documentação
owner: a definir
---

# NA-0175 — Plano de análise

Pedido autorizado: avaliar `docs/NODEACCESS_COFRE_EXTENSAO_CODEX.md` e cruzar com projeto, etapas e riscos. Sem implementação autorizada.

Resultado: [avaliação completa](assessment.md), cobrindo os 18 tópicos do RFC. GO_WITH_RISKS para planejamento incremental; autofill/bridge/biometria condicionados a gates. Recorte recomendado: 1A Cofre visual sobre Secrets/PEM, 1B domínio web, 2 extensão de descoberta, 3 sessão/step-up e autofill piloto, 4 cadastro expandido. Mobile só ADR.

## Escopo e aceite

- [x] Evidências AS-IS, limites da análise e cruzamento NA-0174.
- [x] GAP, alternativas, modelo TO-BE, threat model e UX.
- [x] Etapas, dependências, testes planejados e rollback.
- [x] Matrizes portal/extensão, agente, plataformas e decisões abertas.
- [ ] Aprovação do recorte/ADRs e base de implementação.
- [ ] PoCs, reprodução de hipóteses e validação runtime — fases futuras.

Fora do escopo: alterar código/auth/infra/banco; testar produção; commit/push/merge. Checkout já possui trabalho alheio; não houve troca de branch nem commit. Os documentos canônicos desta frente são preparação, não implementação misturada na branch NA-0172. Antes de código, preparar branch isolada a partir da base integrada verificada e registrar baseline; não partir silenciosamente do checkout antigo.

## Validação e recuperação

Ran: leitura de fontes/documentos/Git e referências oficiais; validação documental e de preservação XLSX registrada no diário. Skipped: testes/Sonar por ausência de mudança de aplicação. Não herdar PASS de outra frente. Reverter apenas documentos NA-0175, sua entrada no índice e as células/revisão desta interação, preservando outras edições. Sem alteração de banco.

## Decisões pendentes

Aprovar recorte 1A/1B, semântica de acesso indireto a credenciais, navegadores-alvo, cliente/session lock, política de exposição e auditoria. Ver seção 11 da avaliação. Nenhum prazo/responsável/prioridade novo atribuído.

## Direcionamento atualizado — 2026-11-15T16:51:06-03:00

Usuário definiu VaultNAccess, revelação autorizada no portal/plugin e distribuição pelo frontend. Segurança evolutiva: E2EE/bridge/mobile posteriores; controles básicos e sessão server-side obrigatórios antes de revelar senhas. [Adendo vigente](vaultnaccess-addendum.md) detalha escopo, Windows Hello, prazos candidatos e instalação piloto/regular. Nome/objetivo confirmados; arquitetura/valores de política não aprovados nem implementados. Próximo: fechar contrato de implementação incremental e baseline na base integrada, começando UI/contratos e extensão piloto.

## Preservação operacional e entrega híbrida — 2026-11-15T16:59:43-03:00

Requisito explícito do usuário: extensão/camada criptográfica não pode comprometer autenticação central, gateway SSH/RDP, credenciais server-side ou auditoria. Incorporado [parecer de arquitetura híbrida](hybrid-delivery-review.md): serviço novo fora do caminho operacional, HPKE candidato a PoC, consumo antes da resposta, revogação mínima desde o cadastro de chaves, isolamento de falhas/carga e bridge opcional. Etapas A–G do parecer refinam a sequência anterior; E2EE não bloqueia MVP. Nenhum código autorizado por este pedido de avaliação.

Aceite adicional: gateway funciona sem extensão/dispositivo/delivery; lock de Cofre não é logout global; revogação central continua válida; sem mudança global de TLS/guards/armazenamento; falha da nova entrega nega apenas sua operação, sem downgrade. Testes de regressão e fault injection planejados, não executados.

## Implementação autorizada — 2026-11-15T17:04:36-03:00

Usuário autorizou avançar seguindo SOLID/desacoplamento/arquitetura limpa. As restrições de somente análise acima descrevem etapas anteriores. Incremento atual: fase 1A, lista única VaultNAccess sobre Secret/PEM existentes, busca/filtro, criação e ações específicas por tipo, compatibilidade de rotas antigas, licença/ACL preservadas. Não incluir reveal, auth da extensão, HPKE nem migração neste incremento; etapas seguintes continuam no objetivo, sob seus gates.

Base verificada por fetch: origin/master/master 28685c5b2c3fbf9739a05629260c95e42e0d62d0; NA-0174 ainda candidata, não incorporar/mesclar sem autorização. Worktree isolado .tmp/worktrees/NA-0175 preserva alterações canônicas; código não será copiado ao canônico. Documentos serão sincronizados. Sem commit/publicação autorizados.

Aceite: lista central com IDs compostos e ações por tipo; ausência de segredo no catálogo; filtro e navegação legada; erro parcial explícito; licença verificada antes de buscar Secrets; teste de estados/race; forms e APIs existentes preservados. SOLID aplicado por catálogo tipado, carregamento separado da tela e editores específicos; sem abstração universal de segredo.

Requisito adicional do usuário: terminal/snippets sem colaterais. Preservar aliases, referência a Secrets, resolução server-side, execução e sessões; lock da extensão/Cofre não condiciona snippets existentes. Validar navegação/layout, foco e área útil com terminal-experience; testes de contratos Secrets/snippets. PTY real se transporte/resize for alterado (não previsto).

Validação: baseline de Secrets/PEM/snippets, testes do catálogo/tela, typecheck/lint/build frontend, manual capture/test/check-reviewed, terminal-experience, validate:sonar e revisão independente. Falha/bloqueio não constitui prontidão. Rollback: rotas/menu/UI, sem alteração de dados/serviços operacionais.
