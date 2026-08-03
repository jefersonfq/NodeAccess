---
change_id: NA-0001
title: Governança rastreável do ciclo de mudanças do NodeAccess
type: feature
status: ready-for-development
created_at: 2026-08-03T08:58:57-03:00
base_branch: feature/host-inventory-acl
base_sha: b27f9926c87ab4d83156428114b8bc40be61e924
branch: feature/NA-0001-20260803-change-lifecycle-governance
owner: codex
planner: codex
risk: medium
issue: null
---

# NA-0001 — Governança rastreável do ciclo de mudanças

## Contexto e situação anterior

O repositório possui testes e harnesses especializados, mas não impõe um ciclo uniforme que conecte solicitação, plano, branch, escopo, commit, SHA testado, evidências, PR e homologação. A frente anterior acumulou muitas alterações antes de um único commit consolidado, tornando revisão e rollback mais difíceis.

As skills frontend e MySQL/Prisma também estavam extensas ou duplicadas e foram modularizadas localmente antes da criação desta frente; essas alterações ainda não foram commitadas e serão incorporadas de forma explícita como parte da padronização dos agentes.

## Problema e objetivo

Passar a exigir, para novas frentes do NodeAccess, um Change ID, plano versionado, branch dedicada, critérios verificáveis, controle de escopo, validação proporcional e independente, evidência vinculada ao SHA atual, PR padronizado e homologação humana antes do merge.

O processo deve ser utilizável localmente e verificável no GitHub Actions, sem afirmar que rulesets remotos foram configurados quando não foram.

## Escopo

### Incluído

- Versionar a skill orquestradora `nodeaccess-change-lifecycle` e suas referências/templates.
- Versionar as melhorias já realizadas nas skills frontend e MySQL/Prisma e remover a cópia MySQL indevida da pasta frontend.
- Criar template de plano/issue e template padrão de Pull Request no repositório.
- Criar documentação curta de workflow, estados, Definition of Done e estratégia de testes/evidências.
- Criar validadores determinísticos para branch, plano, commits e descrição do PR.
- Criar testes unitários dos validadores, incluindo casos inválidos.
- Criar um harness de governança que gere resumo JSON associado ao SHA atual.
- Criar workflows de GitHub Actions para governança e quality gate, com artifact do harness.
- Adicionar scripts npm para validação local padronizada.
- Corrigir dois bloqueios mínimos descobertos pelo novo quality gate: escopo inválido do lint e literal de status alargado no importador Guacamole.
- Documentar a configuração manual recomendada de ruleset/branch protection.

### Fora do escopo

- Alterar rulesets, branch protection, secrets ou configurações remotas do GitHub sem uma etapa autorizada e verificada separadamente.
- Fazer merge desta branch ou homologar funcionalmente de forma automática.
- Refatorar os harnesses de produto já existentes.
- Introduzir um tracker externo obrigatório ou criar issues automaticamente.
- Reescrever o histórico do commit consolidado anterior.

## Critérios de aceitação

- [ ] A skill `nodeaccess-change-lifecycle` passa no validador oficial de skills e possui forward-test independente registrado na execução desta frente.
- [ ] Novas branches de mudança são aceitas apenas no padrão `<tipo>/<NA-ID>-<YYYYMMDD>-<keywords>`; branch/default inválida é rejeitada pelo validador.
- [ ] Toda frente validada possui exatamente um `plan.md` compatível com o Change ID da branch e metadados obrigatórios.
- [ ] Commits da frente exigem Conventional Commit, Change ID e trailers `Plan`, `Change-Date` e `Tests`/`Evidence` conforme aplicabilidade.
- [ ] O PR exige identificação, antes, implementado, motivo, depois/comparação, escopo, testes, SHA, evidências, riscos, rollback e homologação.
- [ ] O harness gera JSON com Change ID, branch, base/head SHA, timestamps, status e resultados sem incluir segredos.
- [ ] Qualquer evidência identifica o SHA testado; a documentação explica que novo commit invalida o resultado anterior.
- [ ] Os validadores possuem testes positivos e negativos executáveis sem rede, banco ou serviços externos.
- [ ] O GitHub Actions executa governança e quality gate em PRs e publica artifact de governança mesmo em falha, quando tecnicamente possível.
- [ ] A documentação diferencia validação técnica automatizada de homologação funcional humana.
- [ ] Nenhuma alteração de configuração remota do GitHub é declarada como aplicada sem verificação real.

## Estratégia técnica

- Implementar uma skill orquestradora e quatro papéis como referências, evitando quatro skills concorrentes.
- Usar scripts Node.js sem dependências novas para ler Git/arquivos, validar convenções e emitir JSON.
- Reutilizar scripts npm existentes (`lint`, `typecheck`, `test`, `build`) no quality gate.
- Separar o check de governança dos testes de aplicação para diagnóstico claro.
- Usar `actions/upload-artifact` para preservar o resumo do harness com retenção definida.
- Manter templates e documentação no repositório como fonte durável.

## Riscos e mitigações

| Risco | Impacto | Mitigação | Critério de parada |
|---|---|---|---|
| CI excessivamente lento | Médio | Jobs separados e validação proporcional local | Quality gate inviabiliza PRs por duração/custo |
| Regra bloqueia commits válidos | Alto | Testes positivos/negativos e mensagem acionável | Falso positivo não corrigido |
| Evidência não corresponde ao SHA | Alto | SHA obrigatório no JSON e workflow por `pull_request` | SHA ausente ou divergente |
| Dados sensíveis em artifacts | Crítico | Resumo allowlist; sem dump de ambiente/log bruto | Detector encontra segredo/credencial |
| Dependência da branch-base não mesclada | Médio | Registrar base/parent PR e não mirar `main` silenciosamente | Parent branch muda de forma incompatível |
| Burocracia para mudanças pequenas | Médio | Permitir combinar gates aplicáveis com justificativa | Processo exige suites irrelevantes sem escape documentado |

## Matriz de testes e evidências

| Critério/risco | Teste/harness | Ambiente | Evidência | Obrigatório |
|---|---|---|---|---|
| Skill válida | `quick_validate.py` nas três skills alteradas | Local | Saída do comando | sim |
| Branch/plano/commit/PR | Testes unitários do validador | Local/CI | Reporter de testes | sim |
| Casos inválidos | Fixtures temporárias em testes | Local/CI | Assertions de erro | sim |
| Harness/JSON/SHA | Execução na branch atual | Local/CI | `artifacts/change-governance/summary.json` | sim |
| Qualidade do código existente | lint, typecheck, testes e build | Local/CI | Logs/checks do job | sim |
| Regras GitHub | Revisão YAML + execução no PR | GitHub Actions | Checks e artifact | sim no PR |
| Ruleset remoto | Inspeção/configuração manual autorizada | GitHub | Captura/export/configuração | manual |
| Homologação do processo | Revisão humana do primeiro PR | GitHub | Aprovação/comentário | manual |

## Baseline

- Base SHA: `b27f9926c87ab4d83156428114b8bc40be61e924`.
- Estado inicial: não existe `.github/`, `docs/changes/` ou validador de lifecycle no commit-base.
- Skills frontend/MySQL/lifecycle estavam alteradas ou novas e ainda não commitadas; validador estrutural e forward-tests passaram antes do plano e serão repetidos no estado final.
- Worktree não estava limpo devido exclusivamente às alterações de skills desta sequência; elas são classificadas abaixo.
- Baseline executado em 2026-08-03: `quick_validate.py` aprovou as três skills; typecheck de backend e frontend aprovou.
- `npm test` no ambiente sem variáveis de serviço: 350 testes aprovados e 3 falharam; 2 suites não coletaram porque `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET` e `PEM_ENCRYPTION_KEY` eram obrigatórias. O teste de observabilidade excedeu o timeout de 5 s durante a suíte completa. O quality gate deve fornecer valores isolados de teste e manter essas falhas visíveis até a reexecução final.

## Rollback ou recuperação

- Reverter o(s) commit(s) `NA-0001` remove templates, validadores, workflows, docs e skills sem alterar dados de aplicação.
- Se um check bloquear PRs incorretamente, ajustar/reverter o workflow via PR de emergência; não usar bypass silencioso.
- Configurações remotas de ruleset, quando futuramente aplicadas, devem ter export/registro anterior e procedimento próprio de reversão.

## Alterações de escopo e decisões

| Alteração preexistente | Classificação | Decisão |
|---|---|---|
| Modularização da skill frontend | `IN_PLAN` | Incorporar como padrão de agentes do NodeAccess |
| Modularização da skill MySQL/Prisma | `IN_PLAN` | Incorporar com validador independente proporcional ao risco |
| Remoção de `frontend-full-cycle-agent/mysql-agent.md` duplicado | `NECESSARY_CORRECTION` | Remover para evitar duas fontes divergentes |
| Criação da skill de lifecycle e templates | `IN_PLAN` | Usar como orquestrador do novo processo |
| Lint incluía `apps/agent/src`, que não possui TypeScript/Vue | `NECESSARY_CORRECTION` | Restringir o lint aos apps backend/frontend suportados |
| TypeScript alargava `rolled_back` para `string` no rollback do importador | `NECESSARY_CORRECTION` | Preservar o literal com `as const`, sem mudar comportamento em runtime |
| Callback XML aceitava matcher não textual no tipo atual do parser | `NECESSARY_CORRECTION` | Restringir a expressão regular a `jPath` textual |

## Aprovação

- Decisão: `GO_WITH_RISKS`
- Risco aceito: branch baseada em `feature/host-inventory-acl` ainda não mesclada na `main`.
- Aprovado por: usuário, ao solicitar que o novo processo passe a valer a partir de agora.
- Aprovado em: 2026-08-03T08:58:57-03:00
