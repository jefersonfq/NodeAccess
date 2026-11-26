# NA-0206 — Revisão das referências de imagens da release

## Escopo e evidência

O scan das seis imagens de `8b3726ec3961d317bf74caf74706fb52539be1a0` falhou em cinco imagens. Os IDs permaneceram estáveis. Relatórios privados: `.tmp/NA-0206/consolidation/image-gate/{handoff,review-minimal,blockers}.json`. A falha original permanece preservada.

O revisor independente executou os matchers existentes sobre cada ocorrência bruta: backend 15 OpenSSL, frontend 10 OpenSSL, TLS agent 15 OpenSSL e 1 SQLite. As 41 correspondências passam integralmente quando apenas a referência é substituída pela referência já revisada. Distro, pacote, versão, CVE, CPE, fonte e condições de correção permanecem iguais. Isso não aprova imagens futuras nem transforma riscos reais em falsos positivos.

| Referência nova e exata | Critério existente copiado | Ocorrências analisadas |
|---|---|---:|
| nodeaccess-backend:2.2.0-na0206.1 | nodeaccess-backend:security-local / OpenSSL | 15 |
| nodeaccess-frontend:2.2.0-na0206.1 | nodeaccess-frontend:security-local / OpenSSL | 10 |
| nodeaccess-tls-agent:2.2.0-na0206.1 | nodeaccess-tls-agent:security-local / OpenSSL e SQLite | 16 |

IDs analisados: backend `sha256:220d1616e916400a92ea252dbc3df7d157bf5e99978528556a46ac9a1b1d933d`; frontend `sha256:998d6a9331f91828c9e17afea11759368765ff338d65b459495ff4b9206b7de8`; TLS `sha256:2d4a3f6a2bea0cf431787dd03c8ca4a0e78400ee2ffbb66ed947d2d71b8c0ca4`.

## Decisão independente e limites

Anscombe: PASS_WITH_WARNINGS para adicionar somente as três referências OpenSSL e uma SQLite acima. Preservar justificativas, CVEs, versões, matchers e expiração em **2026-12-19**. Não acrescentar curingas, não retaggear imagens antigas para simular aprovação e não alterar thresholds. Os riscos OpenSSL continuam sujeitos ao aceite temporário existente; a identificação SQLite mantém sua justificativa de biblioteca sem CLI.

A versão fixa de release evita dependência circular entre SHA do commit e referência na política; o manifesto de proveniência vinculará explicitamente o commit efetivamente construído. Exigir novo build no novo SHA e scan oficial das seis imagens reais. Nenhuma aprovação de cutover decorre desta revisão.

Redis apresenta 18 ocorrências sobre versão instalada r0 diferente da r1 revisada; MySQL apresenta três achados adicionais em curl/libcurl/libxml2. Esses casos NÃO recebem exceção. As etapas de atualização de pacotes existentes foram reutilizadas do cache Docker; reconstrução sem esse cache e análise dos novos IDs são necessárias. Os serviços stateful da VPS continuam fora da substituição planejada.

## Complemento: reconstrução das imagens de estado

As etapas existentes de atualização foram reconstruídas sem cache de camada, sem alterar fontes, versão dos serviços ou digest das bases. MySQL passou no scan: curl/libcurl7.76.1-44.el9_9.1 e libxml2 2.9.13-18.el9_9.1, sem downgrade do RPM fixado. Novo ID `sha256:560c7caee5cf72fdcb49dbf2c857340c4970657f6e376bc04d86ecc9c7968bd6`.

Redis8.2.10 passou de OpenSSL3.5.9-r0 para r2, ID `sha256:4b5253e4738a55f209c04fe016301b04f1a60820c80ccae7f7e0548db305be50`. Secdb Alpine3.22 e patches oficiais comprovam os backports adicionais CVE-2026-107493/124709. Restam CVE-2026-107494, CVE-2026-121482 e CVE-2026-84786 em libcrypto3/libssl3: seis matches NVD com fix unknown, riscos já aceitos em r1. Revisão independente conferiu cada match bruto e autorizou somente r2 nessas três CVEs e na referência Redis, mesma distro3.22.8/critério/expiração19dez. Não autoriza r2 nas demais imagens ou CVEs. A justificativa deve distinguir Redis3.22r2 de aplicações3.24r1.

Índices oficiais Alpine3.24 de CDN/dl-4 apresentaram o mesmo SHA256 e ainda fornecem r1; não foi presumida disponibilidade de r2 nessa branch. Evidência: `.tmp/NA-0206/consolidation/state-rebuild-ZOitKB/{redis-r2-proposal,pinned-policy-review,installed-packages}.json`. Fontes: https://secdb.alpinelinux.org/v3.22/main.json e https://gitlab.alpinelinux.org/alpine/aports/-/commit/3cefad79d0837f496b0ff75f3ac041c1033f867c. A revisão não equivale ao scan oficial final após alteração da política.
