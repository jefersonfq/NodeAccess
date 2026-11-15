---
change_id: NA-0172
title: Central de Segurança informativa com catálogo verificado
type: feature
status: closed
created_at: 2026-11-06T09:09:20-03:00
base_branch: master
base_sha: 745253d1edb522db79aaa44fd96608ce434a2774
branch: feature/NA-0172-20261112-security-center-isolated
owner: Codex
planner: Codex
risk: medium
issue: null
---

# NA-0172 — Central de Segurança

## Entrega confirmada — 2026-11-15T13:24:26-03:00

Outcome: Delivered. PR63 merged; master sincronizada no checkout limpo NodeAccess-master.
Head testado `8d668889a77708166154113a239034c97e268da6`; merge `28685c5b2c3fbf9739a05629260c95e42e0d62d0`, trees idênticas.
Todos os checks aplicáveis e revisão independente aprovados; Windowsrelease skipped pelo
workflow. Nenhuma implantação. Evidência: evidence/gate-final-20261115.json. Histórico abaixo
preserva estados anteriores; controles NA-0174 e manutenção do exportador são próximos trabalhos.

## Retomada de 2026-11-11

Build, testes, cobertura e Quality Gate aprovados no checkout canônico; `validate:sonar`
integral permanece FAIL por `REVIEW_CHECKOUT_CHANGED`, sem commit. A evidência cobre
as alterações locais preservadas, não um commit exclusivo da frente. Ver resumo em
`implementation.md` e `evidence/resume-20261111.json`. Nenhum código de aplicação alterado
nesta retomada; preparar escopo exclusivo antes de solicitar autorização de commit/publicação.

## Candidato exclusivo — 2026-11-12

Worktree `/home/jeferson/NodeAccess-NA-0172`, branch
`feature/NA-0172-20261112-security-center-isolated`, mesma base aprovada.
Separação preserva alterações canônicas; não altera escopo funcional. Evidências anteriores
são históricas; testes/build/scanners/gate da rodada própria aprovados, reconciliação integral
bloqueada por REVIEW_CHECKOUT_CHANGED. Ver evidence/isolation-20261112.json. Sem novo commit/publicação autorizado.

## Contexto e situação anterior
Usuário aprovou sugestões da avaliação do plano de segurança v2 e solicitou seguir. Primeira entrega: inventário focal e Central informativa autenticada. O master remoto foi consultado nesta interação e permanece `745253d1e`; PRs #61/#62 são frentes separadas. Pasta principal contém alterações preexistentes, preservadas em favor de worktree isolado.

## Problema e objetivo
Explicar controles e boas práticas com evidência e linguagem clara, sem confundir existência de código, validação ou ativação no tenant. Evitar exposição de metadados internos no bundle.

## Escopo
IN_PLAN: inventário/catalogação focal; projeção pública por lista permitida no build; rota autenticada/security; entrada discreta junto ao manual; conteúdo pt-BR e estrutura i18n existente; testes/capturas desktop/mobile/temas/teclado; revalidação manual quando layout afetado; Sonar; docs canônicas e META-051.
Fora: mudanças de autenticação/ACL/SSH/Redis; configurações administrativas; indicadores de segurança ativa sem dados reais; motor adaptativo; CA; apps móveis; scans ativos e produção.

## Critérios de aceitação
- [x] Cada alegação tem controle e evidência de arquivo/teste no catálogo interno; estados separados de ativação.
- [x] Apenas campos públicos revisados chegam ao browser; planned/unverified excluídos e sem metadados internos nos assets.
- [x] Rota herda guard autenticado sem modificar sua lógica; menu disponível a usuário comum e admin, independente do piloto manual.
- [x] Conteúdo explica condições e responsabilidades sem prometer certificação, proteção absoluta, auditoria sempre ativa ou E2EE.
- [x] Interface responsiva, temas claro/escuro, foco/teclado e sem poluição visual; links existentes e sem contato inventado.
- [x] Testes focados, build/typecheck/lint, browser/manual/terminal aplicáveis e validate:sonar registrados; revisão independente.

## Estratégia técnica
Catálogo interno versionado fora de assets públicos; plugin de build gera módulo virtual selecionando campos permitidos explicitamente. View lazy apresenta textos estáticos e boas práticas; ausência de fetch/polling elimina loading/retry artificiais. Sem importar dados privados no módulo cliente. Preferir componentes/layout atuais e navegação existente.

## Riscos e mitigações
Alegação excessiva: inspeção focal e revisão de texto. Exposição no bundle: campos allowlist e busca nos assets de produção. Alteração de menu: navegador real e manual. Base antiga principal: desenvolver no master verificado, manter docs canônicas e explicitar visibilidade. Sonar sem dados não será aprovado.

## Matriz de testes e evidências
Projeção: testes adversariais de campos extras/estados e integridade do catálogo. UI: browser real usuário/admin/unauth, mobile/desktop, claro/escuro, teclado, asserts de não exposição e capturas. Regressão: terminal-experience e manual, sem mudança transporte/resize não requer PTY real. Qualidade: typecheck/lint/build, validação Sonar e revisão independente. Evidências no diretório da frente e artefatos privados.

## Baseline
Base `745253d1edb522db79aaa44fd96608ce434a2774`. Rota `/security` ausente na inspeção inicial; menu manual existe e layout mapeado no manifesto. Baseline de comandos focados será registrada antes da alteração de aplicação. Inventário pode identificar riscos para backlog, sem corrigir automaticamente autenticação/SSH.

## Rollback ou recuperação
Reverter frente remove rota/menu/plugin e catálogo público; a funcionalidade não exige alteração de banco. A migração local adicional autorizada durante a atualização do workspace tem backup e recuperação próprios em workspace-transition.md. Preservar documentos e evidências.

## Mudanças de escopo e decisões
Usuário aprovou sugestões em 06/11/2026. Execução limitada a etapas 0/1; conteúdo informativo não exibe configuração de tenant como fato. Catálogo/UX propostos neste plano e apresentados em commentary. Nenhuma autorização inferida para etapas seguintes.

## Aprovação
Decisão: GO_WITH_RISKS. Usuário aprovou sugestões e continuidade; risco de alegações mitigado por revisão independente antes de finalizar. Homologação humana e publicação não serão inferidas de testes.

### Baseline executada
Ran: npm ci pelo lockfile (0 vulnerabilidades relatadas), postinstall, Prisma generate, build shared, test:manual (2 Node + 18 Vitest) e typecheck frontend PASS. Revisor independente GO_WITH_RISKS: catálogo deve refletir a base, reconstruir objetos públicos por allowlist, rejeitar estados desconhecidos/IDs duplicados/evidência ausente e nunca importar metadados no cliente. Implementação liberada após baseline.

### Checkpoint técnico final
Implementação e testes locais concluídos; cobertura do diff 92,48%, dez fluxos browser aprovados, scanners estáticos aprovados e Quality Gate Sonar OK. Critério agregado de validação permanece aberto por REVIEW_CHECKOUT_CHANGED na reconciliação: candidato sem commit. Estado LOCAL_WIP; commit/PR dependem de autorização explícita conforme a skill de ciclo de mudanças. Homologação humana e merge não realizados. Resultados em [test-results.md](test-results.md).

### Revisão solicitada — visual e ambiente principal
Usuário solicitou refinamento visual/UX dentro da identidade NodeAccess e escolheu preparar a atualização da pasta principal preservando arquivos locais. IN_PLAN: cards discretos, hierarquia e índice mobile compacto, sem esconder condições; backup e reconciliação de arquivos locais antes de disponibilizar o candidato no projeto atual. Sem autorização inferida para commit, publicação ou merge. Revisão independente GO_WITH_RISKS: preservar guards, conteúdo, foco, deep links, temas e zero polling. Reexecutar testes da interface, capturas e Sonar após alterações; registrar divergências da migração local.

### Correção necessária da evidência de terminal
NECESSARY_CORRECTION: a repetição revelou que a asserção de recuperação do autocomplete media frames WebSocket de controle junto com stdin, apesar de o mock já separar inputSent. Corrigidos somente baseline/captura do harness para inputSent; comparação exata preservada e heartbeat intercalado deterministicamente. Três contratos executam as callbacks reais e demonstram que corrupção de bytes continua detectada. Sem alteração de produto, transporte SSH, resize ou política de tempo. A falha de clique duplo na rodada anterior permanece registrada como intermitência, sem causa definitivamente comprovada nem tolerância ampliada.

### Coleta de subprocesso do laboratório
NECESSARY_CORRECTION: probe do laboratório interpretava stdout no evento exit, sem garantia de drenagem, e tratava code=null como sucesso. Extraída coleta pequena que aguarda close, valida código/sinal e emite diagnóstico sanitizado. Deadline de 10 segundos preservado e passa a rejeitar explicitamente, liberando streams próprios mesmo quando descendente mantém stdio aberto. Cinco contratos incluem handshake determinístico para exit antes de stdout, saída por sinal, JSON inválido/nonzero, sucesso e timeout sem close. Revisão independente aprovou o patch; core TLS e soak permanecem sem alterações.

### Resultado do refinamento
UX e ambiente canônico disponíveis e testados, banco local alinhado mediante autorização. Testes/cobertura/scanners e Quality Gate Sonar aprovados no candidato final; aprovação integral ainda bloqueada por reconciliação em checkout sem commit. Evidência atual em [ux-validation.md](ux-validation.md). Não marcar frente publicada ou homologada.

### Ajuste após homologação — âncoras da Central
Usuário declarou homologação da Central e solicitou como único ajuste remover o efeito de transição ao selecionar uma seção. IN_PLAN: preservar a instância da Central quando apenas o fragmento muda; rolar para o conteúdo, incluindo teclado, histórico e links diretos. Identidade de outras rotas/query e cache do terminal preservados. Mudança localizada no layout e observação de hash na view; validar ausência de recriação, transição e indicador de carregamento. Revalidar manual por AppLayout mapeado e gates aplicáveis. Homologação informada vale para o estado apresentado; ajuste novo terá evidência própria. Sem autorização de commit/publicação inferida.

### Correções necessárias de CI — 14/11/2026

NECESSARY_CORRECTION: diário reorganizado nas seis seções obrigatórias sem remover histórico.
Gate de dependências detectou GHSA-474x-hrwr-fgx4 no lock herdado. Atualização mínima revisada:
fast-xml-parser5.12.0 e transitivas exigidas is-unsafe2.0.3/strnum2.5.1; range original preservado.
Não muda políticas nem adiciona dependência. Contratos de importação, npm ci, auditoria e
validação no novo SHA obrigatórios; sem exposição ao stopNodes demonstrada no consumidor.

NECESSARY_CORRECTION adicional: CI upgrade-restore falhou porque .dockerignore excluía o
plugin da Central. Reintroduzir somente catálogo, plugin e arquivo de evidência de teste
Sonar necessário à validação do catálogo no builder. Validar imagem frontend prod e conferir
que catálogo/metadados internos não são copiados para o diretório público da imagem final.

## Bloqueio de integração — 2026-11-14T22:23:12-03:00

PR63 draft, head0b68abaf301e72b2fd4820b47876457a5b8915d3. Local e Sonar remoto PASS;
security:images FAIL. Não entregue. Oito achados em quatro imagens, detalhados na
NA-0174/evidence/image-gate.json; correções/triagens e novo ciclo de gates pendentes.

## Continuação autorizada — 2026-11-14T22:27:57-03:00

Usuário: “vamos em frente com o gate e os cenarios fim a fim”. GO_WITH_RISKS para
Correções mínimas de imagens e revalidação de triagens, necessárias para o gate da PR63. Não alterar regras/thresholds nem aceitar vulnerabilidade por conveniência.

Aceite: evidência por achado/pacote, imagens identificadas por digest/ID, revisão independente,
regressões pertinentes e validate:sonar para código alterado; nenhum merge com gate aberto.
Risco: atualizações de bibliotecas podem afetar TLS/guacd/CLI. Mitigar por build, inventário,
scanner atual e cenários reais antes de commit/integração. Rollback: reverter apenas a correção
da frente, sem alterar ambiente em uso. Plano anterior descreve etapas históricas.

## Estado do gate — 2026-11-14T23:23:51-03:00

LOCAL_WIP. Evidências finais desta rodada na NA-0172/evidence/gate-progress-20261114.json.
Sonar Quality Gate OK, validação integral bloqueada por reconciliação do checkout.
Imagens5/7 PASS; triagens pendentes de autorização e atualização MySQL sem build concluído.
Reproduções NA-0174 com limitações concluídas; correções dos controles ainda pendentes.

## Autorização de 2026-11-15

Usuário autorizou as cinco triagens exatas propostas até2026-11-29T00:00:00Z e correção
da imagem MySQL. Esclareceu manter a versão guacd, permitindo corrigir bibliotecas.
Guacd permanece1.6.0; SQLite não alterado. Escopo necessário: atualizar libbrotli oficial
com checksum e assinatura, preservar fullupdate, validar imagem por digest e repetir stack.
Qualquer build aproveitando cache será identificado; não equivale a fullupdate fresco.

## Gate pré-commit consolidado — 2026-11-15T12:21:57-03:00

Imagens7/7, stack, upgrade/restore, contratos, lint e testes/cobertura Sonar PASS.
Primeira rodada falhou HA; falha preservada, dois ensaios focados e repetição integral
aprovados sem alterações de assertions/timeouts. Quality Gate OK; único bloqueio final
REVIEW_CHECKOUT_CHANGED. Commit já autorizado necessário à reconciliação; exigir validate:sonar
integral no SHA limpo e checks remotos antes de merge. RDP, arm64 e produção não validados.
