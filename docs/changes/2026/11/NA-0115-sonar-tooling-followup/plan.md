---
change_id: NA-0115
title: Resolver onze achados novos da rotina Sonar
type: fix
status: in-development
created_at: 2026-11-03T17:25:02-03:00
base_branch: chore/NA-0093-20261103-sonar-integration
base_sha: 47f06b51e693d91f5ed724b7b86e5362af75bc35
branch: fix/NA-0115-20261103-sonar-tooling-followup
owner: Codex
planner: Codex
risk: low
issue: null
---

# NA-0115 — Onze achados novos de ferramentas

## Escopo e critérios

Tratar individualmente os 11 findings exportados na análise de 47f06b51e: comparadores explícitos S2871 (4), execução Git S4036 (5), totals LCOV S3403 (1) e default owner S7737 (1). Manter gates, denominadores, fingerprint e proteção de arquivos privados. Não alterar baseline para esconder achados nem executar scanner concorrente.

Git usa caminho absoluto /usr/bin/git em Linux/WSL e CI Ubuntu, sem shell e sem resolução pelo PATH. Ausência desse requisito falha; não prometer suporte Windows. Contratos exercitam PATH adulterado, relatório LCOV válido/inválido, ordenação e propriedade de arquivos. Mudar totals para Map mantém distinção entre falta e zero sem supressões. Owner padrão continua resolvido no instante da chamada e apenas quando undefined.

## Aprovação, risco e recuperação

GO_WITH_RISKS conforme autorização root para corrigir todos os findings novos em branch isolada. Ordem explícita pode alterar fingerprint, que deve ser regenerado pela rotina; não reutilizar artefatos antigos. Retorno com reversão do commit. Revisão independente backend antes de integrar; merge/publicação fora desta frente.

## Ajuste necessário de integração autorizado

Root reproduziu falha de entrada direta ci-run quando Node/npm não são adjacentes no WSL. Adicionar somente script npm sonar:ci e orientar npm run para fornecer npm_execpath; não mudar o runner nem dependências/lockfile. Não executar CI real concorrente nesta frente.
