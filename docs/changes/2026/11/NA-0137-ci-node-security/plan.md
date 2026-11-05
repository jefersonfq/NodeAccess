---
change_id: NA-0137
title: Atualizar pins ativos Node para release de segurança
type: fix
status: in-development
created_at: 2026-11-03T23:06:48+00:00
base_branch: chore/NA-0093-20261103-sonar-delivery
base_sha: b76faaec6031f3ebed1372a65dcede08f930cde0
branch: fix/NA-0137-20261103-ci-node-security
owner: NodeAccess
planner: Codex
risk: low
---

# NA-0137 — Node corrigido no CI

## Contexto e situação anterior

Pins ativos usam Node24.21.0. Node24.22.1 é release oficial de segurança (21/10/2026), corrigindo CVEs de Brotli/DNS/TLS; auditoria da imagem motivou atualização coordenada com NA0136.

## Problema e objetivo

Executar CI e fixtures com runtime corrigido, preservando npm12.2.1 e compatibilidade funcional.

## Escopo

Pins setup-node de workflows ativos, imagem CSP com digest informado, três tags em provider.blackbox.test.mjs, .nvmrc e requisitos de desenvolvimento. Dockerfiles/stack-images.json pertencem à NA0136. Sem históricos, NOTE, engines ou guards funcionais.

## Critérios de aceitação

- [x] Nenhum pin24.21.0 permanece em workflows/.nvmrc/fixtures de escopo.
- [x] ImagemCSP usa24.22.1-alpine com digest verificado pela frenteDocker.
- [x] npm12.2.1 preservado; parsingYAML e delta semântico limitado.
- [x] Testes pertinentes, revisão independente e limitações registradas.

## Estratégia técnica

Substituições exatas de versão e digest; comparar YAML antes/depois normalizando apenas alterações autorizadas. Documentar release oficial e distinguir mínimo funcional dos requisitos de segurança da rotina.

## Riscos e mitigações

Novas versões TLS/DNS podem rejeitar entradas inválidas antes aceitas; release patch, sem alteração de fluxo. Validações integradas finais na raiz. Não afirmar launcherWSL externo atualizado; conferir versão efetiva. Três hashes de fixtures workflow revalidados pela raiz após merge.

## Matriz de testes e evidências

Planned: parsing de todos workflows alterados; comparação semântica estrita; política imagens; contratos provider sem ativar rede/iptables real; validação de sintaxe do blackbox; versãoNode corrigida quando disponibilizada pela raiz.

## Baseline

b76faaec6031f3ebed1372a65dcede08f930cde0. Fonte oficial https://nodejs.org/en/blog/release/v24.22.1/ consultada; severidade upstream BrotliHigh distinta de Critical atribuído pelo scanner.

## Rollback ou recuperação

Reverter pins isolados somente mediante decisão explícita, pois versão anterior tem CVEs; não desfazer configuração alheia. Nenhuma migração de produto.

## Aprovação

Decisão: GO_WITH_RISKS. Atualização de segurança autorizada pela raiz; NA0136 coordena imagens do produto.
