---
change_id: NA-0136
title: Atualizar runtime Node das imagens após achados reais CI
type: security
status: implemented_local
created_at: 2026-11-03T20:04:51-03:00
base_branch: fix/NA-0093-sonar-delivery
base_sha: b76faaec6031f3ebed1372a65dcede08f930cde0
branch: fix/NA-0136-20261103-node-image-security
owner: equipe NodeAccess
planner: Codex
risk: medium
---

# NA-0136 — Runtime Node corrigido

## Contexto e situação anterior
Job126258020435 bloqueou backend/TLS-agent por Node24.21.0: CVE-2026-111497Critical e105482/105483/106069High. Demais5imagens passaram, inclusiveguacd.

## Problema e objetivo
Atualizar runtime/build coerentemente para releaseNode24.22.1 oficial corrigido, semwaivers.

## Escopo
BasesDockerbackend/frontend(TLS-agent), assertionexataNode do ensaio container-stack, catálogo stack e fixturesativas que usam imagemnodebase. CItoolchainversion será coordenada comraiz; semproduto/VPS/npmdependencychange.

## Critérios de aceitação
- [x] Releaseoficial e digestconfirmados.
- [x] Buildreal backendruntime/TLS-agent e versão instalada corretos.
- [x] Scannerreal final semHigh/Critical não revisados.
- [x] Contratosaplicáveis e revisão independente concluídos.

## Estratégia técnica
NodeLTS24 mantémmajor/ABI. Pin24.22.1-alpine por digestOCIoficial; rebuildisolado e scanners porID. Nãoalterar política deimagem.

## Riscos e mitigações
PatchNode muda DNS/TLS/Brotli e atualização minor de runtime; repetir testesTLS e smoke/backend. Não confundir buildscanner comhomologaçãoWindows/produção. Tags locais próprias evitam sobrescrever imagens existentes.

## Matriz de testes e evidências
Planned: metadadosoficiais, Dockerbuild, versãoNode/runtime, contratosTLS/headers e scanners. CIupgrade-restorecompleto candidato final pela raiz.

## Baseline
b76faaec6031f3ebed1372a65dcede08f930cde0; artifact13277359334 privado contém relatórios das7imagens. Nãoé falhaGLib/guacd. Release https://nodejs.org/en/blog/release/v24.22.1/ confirma correções.

## Rollback ou recuperação
Reverter pins restaura versão vulnerável; não recomendar deployrollback semcontrole compensatório. Nenhumserviço real seráalterado.

## Aprovação
Decisão: GO_WITH_RISKS. Usuário autorizou correções necessárias fimafim; raiz atribuiu NA0136 com mínima correção e scannerreal. Commitlocal autorizado.
