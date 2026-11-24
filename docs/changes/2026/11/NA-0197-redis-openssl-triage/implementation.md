# NA-0197 — Registro da implementação

Base: `07c004f10` (master após a NA-0194). Branch: security/NA-0197-20261123-redis-openssl-triage.

## Pedido e objetivo

Na PR #85, `upgrade-restore` reprovou a imagem do Redis por CVEs do OpenSSL sem relação com a mudança; o responsável autorizou o merge e uma frente separada para tratar a imagem.

## Implementação

- Diagnóstico: `apk upgrade` no build trouxe `openssl 3.5.9-r1`; a triagem exata da NA-0185 fixava o Redis em `r0`.
- Secdb do Alpine (v3.22 e v3.24): quatro das nove CVEs corrigidas por backport em `3.5.9-r1`; as outras cinco sem correção.
- `security/openssl-image-triage.json`: Redis `r1`; as quatro CVEs aceitam `r1`; motivo e evidência atualizados; prazo mantido.
- Testes da política ajustados (Redis `r1`; `r0`/`r2` bloqueiam; as quatro CVEs com `r1` e motivo).

## Validação

- Ran: `node --test scripts/security/*.test.mjs` 265 PASS.
- Ran: revisão independente (subagente): PASS_WITH_WARNINGS — aceita só os 18 achados reportados; secdb v3.22/v3.24 conferido; ajustes aplicados (teste de CVE revisada só para outra revisão de pacote; texto do motivo).
- Planned: `upgrade-restore` na CI da PR.

## Pendências

- Merge desta PR antes da NA-0196 e da NA-0195 (o `upgrade-restore` delas depende deste ajuste).
- Revisar de novo até 2026-12-19 ou quando o Alpine publicar OpenSSL 3.5.10.

## Recuperação

Revert da PR (o gate volta a bloquear o Redis); sem efeito em dados ou imagens.

## Diário de interações

### 2026-11-23T23:59:00-03:00 — Diagnóstico e ajuste

Ver acima.

### 2026-11-24T00:40:00-03:00 — Merge e encerramento

CI da PR #87 toda verde (inclui `upgrade-restore`); mesclada com autorização do responsável (`012ea6b69`). Estado: MERGED, MASTER_SYNCED. Encerramento registrado na NA-0196.
