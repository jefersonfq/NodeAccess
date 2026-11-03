---
change_id: NA-0122
title: Contratos SSR do editor de licença do tenant
type: chore
status: ready-for-review
created_at: 2026-11-03T18:11:27-03:00
base_branch: chore/NA-0093-20261103-sonar-integration
base_sha: 6af97acad7b1c34de86ba4ed77b600607d96a8c7
branch: test/NA-0122-20261103-tenant-license-contracts
owner: Codex
planner: Codex
risk: low
issue: null
---

# NA-0122 — TenantLicenseEditor

## Escopo e viabilidade

Somente testes/docs do componente real via setup e SSR compilado. API e componentes Naive simulados na fronteira, preservando template, computed, catálogo e handlers originais. Aproximadamente123unidades novas não cobertas informadas pelo root; estimativa de recuperar parte relevante com15–20contratos, a confirmar com LCOV focal. Sem mudar produto, thresholds, configuração ou denominador.

## Critérios

Carregamento/erro, ausência de tenant, limites abaixo/em/acima do consumo, hosts ilimitados, dependências transitivas e desativação de provedores, escolha IA, confirmação/resumo e payload normalizado, sucesso/notificação/eventos, erros e saving pendente. Ajuda/drawer e fechamento via handlers originais. Contagem e LCOV reais; lint/typecheck; revisão independente.

## Riscos e recuperação

SSR não dispara onMounted nem comprova foco/DOM do Naive. Mocks renderizam slots para inspecionar props/handlers, não provam modal real. Não simular backend/licenciamento persistente como validado. Nenhuma alteração visual exige nova captura; evidências browser anteriores continuam separadas. Reverter apenas testes/docs.

## Aprovação

GO_WITH_RISKS: root autorizou testeSSR real no escopo Sonar/cobertura do usuário. Branch isolada por concorrência, commit local autorizado; publicação/merge pendentes.

## Resultado local

24 contratos passaram; ESLint sem erros/avisos e typecheck frontend passaram. Revisão independente reproduziu 24/24. LCOV focal: 134/174 linhas, 120/140 branches e 66/81 funções; não representa o gate global. Produto, configuração e denominador preservados.
