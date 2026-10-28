---
change_id: NA-0079
title: Andamento do teste, comunicação de validade e acesso coerente aos hosts e à auditoria
type: feature
status: tests-passed
created_at: 2026-10-27T10:55:08-03:00
base_branch: master
base_sha: b4f70480c3e7bee3738f92b8ed0283adf460719e
branch: feature/NA-0079-20261027-trial-host-audit-experience
owner: root
planner: trial_review
risk: high
issue: null
---

# NA-0079 — Experiência de teste, hosts e auditoria

## Contexto e situação anterior

O usuário autorizou implementar os doze pontos investigados, do cadastro e provisionamento até a navegação de hosts e auditoria. O plano reúne fluxos relacionados sem alterar os limites do provider ou a infraestrutura por conveniência.

O cadastro consulta o status a cada cinco segundos, mas não apresenta andamento visual durante a preparação. Os e-mails operacionais são texto simples. A tela pronta informa validade sem ciência operacional explícita. O menu de auditoria do teste abre uma listagem simplificada, enquanto o relatório completo já existe. O painel de reconstrução precede o conteúdo principal da sessão.

A investigação local reproduziu Ctrl+R em um Bash descartável: o shell executou o comando completo recuperado, mas o reconstrutor registrou a letra pesquisada com baixa confiança. A captura original e o transporte SSH não são o problema demonstrado. Hosts também têm apresentação e disponibilidade de Agent que não estão inteiramente refletidas no botão de conexão e em seu cache de renderização. O dashboard do host tem ação de terminal que apenas navega, além de critérios de atenção e auditoria pouco evidentes.

## Problema e objetivo

Tornar verificáveis o andamento e o prazo do teste, preservar a escolha livre dos consentimentos, encaminhar o usuário às ações corretas e reconstruir buscas de histórico a partir de evidência observada. Manter os tenants normais, as permissões, a expiração no servidor e os dados originais de auditoria intactos.

## Escopo

Incluídos: os critérios C1–C12 abaixo; contratos mínimos para contexto dos e-mails e ciência de prazo; testes unitários/API/SQL/browser e documentação dos fluxos afetados; preparação, revisão e validação operacional da implantação autorizada.

Excluídos: elevar capacidade do provider, mudar quotas, enviar comandos de sondagem ao terminal, redefinir scores de atenção, ampliar permissões administrativas, marcar marketing automaticamente, exigir ciência retroativa de contas já ativas, desligar máquinas externas do cliente, apagar backups por esta alteração, refatoração geral ou nova dependência sem necessidade demonstrada.

## Critérios de aceitação

- [x] **C1 — Provisionamento:** estados reais de espera/preparação exibem progresso indeterminado e texto compreensível; ativo exibe próximo passo; atraso e falha de rede têm feedback e recuperação. Sem percentual ou ETA inventado. Polling, cancelamento e pausa por visibilidade continuam funcionais.
- [x] **C2 — E-mails:** confirmação, ambiente pronto e aviso de vencimento recebem identidade visual NodeAccess em HTML seguro, com versão texto equivalente. Links, datas/fuso e retenção correspondem ao destinatário e ao snapshot. Mensagem utilizável sem imagens; sem pixels externos, segredos em assunto/log ou envio paralelo ao mecanismo durável existente. Convites e recuperação continuam compatíveis.
- [x] **C3 — Validade e ciência:** antes da ativação dos novos snapshots aplicáveis, mostrar até quando o teste funciona e como ocorre o encerramento/retenção. Exigir e registrar no servidor ciência operacional explícita e versionada, separada de termos, marketing e pesquisa. Ausência do marcador no snapshot significa legado; não bloquear contas normais ou já ativas. A ciência não renova nem amplia prazo.
- [x] **C4 — Menu de auditoria:** para administrador autorizado do teste, o atalho lateral leva ao relatório de auditoria de sessões existente. Participante USER não recebe privilégios nem é enviado a rota administrativa que o redirecionaria indevidamente; manter acesso de leitura autorizado ou reutilizar o relatório em modo leitura com guardas explícitas. A seleção do menu acompanha lista/detalhe.
- [x] **C5 — Ordem do detalhe:** “Gravação e reconstrução” aparece após o conteúdo principal da sessão, preservando carregamento, estados de erro, consulta de versões, reprocessamento autorizado e evento de atualização.
- [x] **C6 — Ctrl+R:** reconstrução offline recupera o comando selecionado quando o redraw observado permite comprovação, inclusive eventos fragmentados e edição subsequente. Busca cancelada/falha ou redraw não suportado não vira um comando falsamente comprovado. Preservar baixa confiança/avisos quando necessário, dados brutos, autoria e proveniência; atualizar versão do processador. Nenhuma alteração no input enviado ao SSH.
- [x] **C7 — Protocolo:** cards e lista de hosts reutilizam HostProtocolIcon, como o acesso rápido, para SSH e demais protocolos suportados, com nome acessível e sem perda de informação.
- [x] **C8 — Agent:** representar a rota/estado por ícone acessível e tooltip útil, sem depender apenas de cor, com estados compreensíveis e navegação por teclado.
- [x] **C9 — Disponibilidade:** Conectar fica indisponível quando a rota obrigatória de Agent/connector do host não está disponível. Preservar DIRECT, fallback AUTO e ACL. A avaliação usa o host concreto, inclusive connector fixado, e atualiza cards/lista quando o estado muda, sem v-memo obsoleto. A autorização do servidor continua sendo a última barreira.
- [x] **C10 — Ação do host:** “Conectar” no dashboard efetivamente inicia o fluxo existente para aquele host, respeitando protocolo SSH/RDP/VNC, estado e permissões; reutilizar termStore/fluxo existente, sem simples navegação que deixe o terminal vazio e sem conectar a host diferente.
- [x] **C11 — Atenção:** apresentar os critérios reais de “Requer atenção”, suas contagens e período e os links/filtros existentes. Valores e drilldowns correspondem ao mesmo contexto; não alterar silenciosamente o cálculo do score ou inventar indicadores.
- [x] **C12 — Auditoria no dashboard:** disponibilizar auditoria junto às ações superiores do host, preservando guardas, host, período e filtros. Manter acesso ao conteúdo existente sem consulta a outro tenant.

## Estratégia técnica

### Cadastro, e-mails e ciência

Alterar `TrialView.vue`, composable/serviço de onboarding e contratos de trials somente onde necessário. O feedback usa estados já publicados, sem expor erros internos ou inferir progresso inexistente.

Criar renderer puro de e-mail com `subject`, `text` e `html`, dados tipados e escape de conteúdo/URLs. Marca deve funcionar sem recursos remotos; se houver imagem CID, incluir o asset no pacote e testar sua presença. Reutilizar `trial-runtime.ts`, `trial-notifications.ts` e seus claims, fencing e retries. Texto de retenção deve refletir o código: acesso encerrado no prazo, remoção dos labs próprios, expurgo após retentionDays contado do encerramento concluído, máquinas externas preservadas e backups sujeitos ao ciclo próprio. Não prometer anonimização irreversível ou exclusão instantânea universal.

Preferir evento de ciência versionado em TrialConsentEvent, na transação de ativação já protegida pelo lock do trial, com participante quando aplicável. Marcador opcional no snapshot evita imposição retroativa. Registrar versão/data/ator sem modificar marketing/research. Um evento versionado não deve ser descrito como prova de expiresAt/retentionDays imutáveis se esses valores não forem armazenados: caso seja necessária essa prova exata, registrar pequena extensão explícita de metadata/snapshot e revalidar migração/compatibilidade antes de implementar. O resumo público expõe apenas dados necessários, nunca PII ou tokens adicionais.

### Auditoria

Reutilizar relatório e suas permissões; não remover requiresAdmin da árvore administrativa para corrigir um link. Mover a instância existente de AuditReconstructionPanel. Corrigir apenas `session-audit-input.ts`, helper de redraw e integração no normalizer conforme necessário; ampliar testes de eventos reais sintéticos. `readHistoryReplacement` atual não entende sozinho o redraw de reverse search (CR, CSI insert/delete e backspaces). Não adivinhar conteúdo a partir de histórico local nem inserir sondagens. Alterar AUDIT_PROCESSOR_VERSION para separar derivações e caches antigos, preservando JSONL e versões anteriores.

### Hosts e dashboard

Reutilizar `HostProtocolIcon.vue` e semântica de QuickAccessHostCard. Em `HostsView.vue`, integrar canConnectHost/agentRouteStatusForConnectionMode ao modelo de cada item, avaliar connector por host e incluir os fatores relevantes no v-memo. Em `HostDashboardView.vue`, reutilizar a conexão efetiva de `DashboardView.vue`/termStore; não duplicar transporte. Critérios de atenção devem refletir `host-dashboard.service.ts`/buildHealth e contexto atual, sem mudança do score. Ação de auditoria reutiliza openAudits/openAuditsDrilldown e os filtros existentes.

Aplicar o skill de manual aos arquivos cobertos por `docs/manual/manifest.json`, incluindo Hosts/terminal quando afetados. Capturas devem ser sintéticas e a revisão editorial só marcada após validação.

## Riscos e mitigações

| Risco | Impacto | Mitigação | Critério de parada |
|---|---|---|---|
| Ciência misturada com consentimento ou aplicada retroativamente | Bloqueio indevido e evidência incorreta | Snapshot versionado, evento próprio, defaults de marketing false e compatibilidade legada | Conta ativa/normal bloqueada ou preferência alterada |
| HTML/link indevido ou mensagem duplicada | Exposição, envio errado ou confusão | Renderer puro, escape, URL confiável, fila atual e testes de concorrência | Segredo/PII indevida, link arbitrário ou duplo envio introduzido |
| Confundir busca com comando executado | Auditoria inexata | Somente redraw observado, proveniência e incerteza explícita | Query de busca tratada como comando comprovado |
| Atalho contorna ACL ou quebra Agent/AUTO | Conexão indevida ou indisponibilidade | Guardas existentes, host-specific route e servidor autoritativo | USER alcança mutação administrativa ou fallback incorreto |
| Mudança de renderização afeta terminal | Resize/foco/PTY degradado | Reutilização de fluxo e gates terminal/PTY aplicáveis | Perda de entrada/saída, sessão, foco ou geometria |
| Implantação de backend altera dados/serviços existentes | Regressão operacional | Backup novo consistente/off-server, pins e roteiro independente | Drift não explicado, preservação falha ou ausência de recuperação compatível |

## Matriz de testes e evidências

| Critério/risco | Teste/harness | Ambiente | Evidência esperada | Obrigatório |
|---|---|---|---|---|
| C1–C3 | Unidade/componentes, status/activate API, SQL de ativação/evento/legado/concorrência | Local descartável | Estados, falhas recuperáveis, ciência exigida só em snapshot novo, marketing intacto | Sim |
| C2 | Renderer HTML/text, escape/URL, asset/package; notificações SMTP falso e SQL | Local sem destinatário real | Três tipos equivalentes, retries/claim/fencing preservados, preview mobile/desktop | Sim |
| C3 | Retenção existente e compatibilidade de contratos | MySQL descartável | Texto fiel à implementação; nenhum prazo ampliado; legado/normal preservados | Sim |
| C4–C5 | Browser do relatório/detalhe e testes de rotas por papel | Local com fixtures | Atalho correto, ordem visual/DOM, guardas e refresh | Sim |
| C6 | Input/normalizer/reconstruction/export; fixture de Bash PTY e chunk fragmentation | Local sintético | Antes: busca vira letra; depois: seleção reconstruída ou incerteza honesta, JSONL intacto | Sim |
| C7–C10 | Hosts cards/lista, Agent/connector/DIRECT/AUTO, dashboard e protocolos | Browser local | Ícones acessíveis; offline/online reativo; host certo conecta; ACL intacta | Sim |
| C11–C12 | Health/contagens/período e navegação de filtros/auditoria | Unidade/browser local | Texto e drilldown batem com dados/filtros | Sim |
| Frontend/UX | 390 e 1440 px, light/dark, teclado, loading/vazio/erro/sucesso | Build frontend | Sem overflow, labels/foco/contraste e defaults corretos | Sim |
| Terminal | test:terminal-experience:web; test:terminal-pty:real se resize/WS/transporte mudar | Host descartável | Fluxo normal sem sondagens adicionais; evidência de protocolo real quando aplicável | Conforme alteração |
| Manual | Skill nodeaccess-manual, testes/capturas/check-reviewed | Fixtures locais | Capítulos e imagens condizentes, sem dados de usuário | Sim nos fluxos mapeados |
| Entrega | Lint com exit real, types, build, segurança, CI/governança, testes relevantes no SHA final | Local/CI | Logs e contagens vinculados ao SHA; revisão independente | Sim |
| Operação | Backup/off-server, pacote/pins, preservação antes/depois, health e smoke autorizado | Alvo após revisão | Sem regressão normal, sem sessão real criada indevidamente; recuperação documentada | Antes de declarar implantado |

## Baseline

- Base SHA: `b4f70480c3e7bee3738f92b8ed0283adf460719e`.
- Branch prevista e observada: `feature/NA-0079-20261027-trial-host-audit-experience`; HEAD corresponde à base; workspace limpo antes destes documentos.
- **Ran:** input/normalizer/reconstruction, 192 testes passaram, zero skips, antes de alterações de aplicação; `/tmp/na-audit-investigation-baseline.log`.
- **Ran:** Bash PTY local com histórico sintético e Ctrl+R; shell executou comando inteiro, reconstrutor retornou letra com uncertain=true. `/tmp/na-audit-history-events.json`, `/tmp/na-audit-history-reconstruction.json`.
- **Ran:** onboarding/trials, 187 testes em sete arquivos (`/tmp/na0079-items123-baseline.log`); Hosts/dashboard, 40 testes em sete arquivos (`/tmp/na0079-frontend/baseline-unit.log`).
- **Ran:** schema base aplicado ao banco local isolado `nodeaccess_test_na0079`, todas as migrations passaram (`/tmp/na0079-sql-setup.log`).
- Investigações locais: `/tmp/na0079-investigation-items-1-3.md` e `/tmp/na-audit-items-4-6-investigation.md`; itens 7–12 conferidos por revisão delegada de caminhos e fluxos. Arquivos temporários não substituem evidência durável do SHA final.
- Nenhuma falha de baseline conhecida nas três suítes executadas. Não presumir sucesso nas demais.

## Rollback ou recuperação

Reverter código por PR/checkpoint compatível, sem reset/force-push. Eventos brutos e registros anteriores de auditoria nunca são reescritos; mudança de versão gera nova derivação. Não restaurar banco antigo após novas gravações. Se houver alteração de schema, deve ser aditiva, ensaiada e manter leitura de legados; documentar forward-fix antes de publicar.

Esta frente inclui backend e frontend: não reutilizar automaticamente a operação frontend-only das NA-0076/77. Preparar roteiro próprio com inventário, backup consistente novo de dados/configuração/arquivos/imagens, cópia externa verificada, pacote e SHA exatos, drenagem proporcional e preservação de tenants normais/labs. Não enviar e-mails reais nem abrir sessões de clientes como teste; qualquer smoke de alvo usa fixtures próprias no escopo autorizado e registra limpeza/limites reais.

## Mudanças de escopo e decisões

- `IN_PLAN`: os doze pontos autorizados pelo usuário; root mantém Git/PR/implantação, Planner independente apenas cria estes documentos.
- `IN_PLAN`: ciência operacional do prazo separada de consentimentos; legado sem marcador não recebe bloqueio retroativo.
- `NECESSARY_CORRECTION`: versionar reconstrução/caches ao corrigir Ctrl+R, sem alterar transporte.
- `NECESSARY_CORRECTION`: atualizar v-memo/avaliação por host para que a disponibilidade não permaneça obsoleta.
- Estrutura de evidência exata da ciência, eventual migração e acesso completo de participantes USER devem ser registrados na implementação antes de qualquer ampliação de contrato/permissão; a solução mínima preserva o escopo atual.

- `IN_PLAN` — 2026-10-27T11:00:00-03:00: aprovada coluna JSON nullable de metadata em TrialConsentEvent para congelar vencimento, retenção e versão do aviso na transação de ciência. Migração aditiva; rollback da aplicação mantém coluna e evidência. Nenhum aceite retroativo é criado. Ensaio SQL obrigatório antes da implantação.

- `NECESSARY_CORRECTION`: o grid de cards tinha três colunas fixas em 390 px. Ajuste localizado para uma coluna em mobile, duas intermediárias e três desktop torna os ícones e nomes dos critérios C7/C8 legíveis; sem layout global ou terminal alterado. A formatação/return types/void no HostDashboard acompanha o lint estrito do arquivo tocado, sem refatoração geral.

## Aprovação

- Decisão: GO_WITH_RISKS para implementação dos doze itens dentro deste plano.
- Aprovado por: Planner independente `trial_review`; autorização funcional do usuário comunicada pelo orquestrador `root`.
- Aprovado em: `2026-10-27T10:55:08-03:00`.
- Condições de início: branch/base conferidas; baselines de cada módulo registrados antes das respectivas edições. Este parecer não é aprovação do código futuro nem autorização de ignorar gates de produção.
- Implementadores não aprovam seu próprio código. Root deve designar revisão independente por fluxo e manter homologação humana distinta de testes automatizados, sem inferi-la.
