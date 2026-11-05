---
change_id: NA-0162
title: Corrigir SQLite nas imagens de apoio
type: fix
status: ready-for-tests
created_at: 2026-11-04T15:01:49-03:00
base_branch: chore/NA-0093-20261103-sonar-delivery
base_sha: 554790c3081b4f345a5b9f754c0199e685f2644d
branch: fix/NA-0162-20261104-sqlite-image-security
owner: NodeAccess
planner: Codex
risk: medium
---

# NA-0162 — SQLite nas imagens TLS e guacd

## Contexto e situação anterior

O CI bloqueou quatro CVEs de SQLite nas imagens TLS e guacd. Atualizar somente sqlite-libs para3.54.1-r0 por APK oficial assinado e checksum fixado. Classificar exclusivamente o CVE do shell no pacote de bibliotecas compartilhadas, com prova de ausência do CLI, correspondência exata e expiração. Preservar todos os outros bloqueios e relatórios brutos.

## Problema e objetivo

Eliminar as falhas de memória e separar o erro de identificação do componente CLI com evidência verificável.

## Escopo

O CI bloqueou quatro CVEs de SQLite nas imagens TLS e guacd. Atualizar somente sqlite-libs para3.54.1-r0 por APK oficial assinado e checksum fixado. Classificar exclusivamente o CVE do shell no pacote de bibliotecas compartilhadas, com prova de ausência do CLI, correspondência exata e expiração. Preservar todos os outros bloqueios e relatórios brutos.

## Critérios de aceitação

- [x] Fontes primárias e APK/checksum confirmados.
- [x] Scanner real sem High/Critical/Unknown não revisado.
- [x] Negativos de identidade, versão, CVE e expiração.
- [x] Consumidores reais preservados.
- [ ] Gates no candidato integrado.

## Estratégia técnica

O CI bloqueou quatro CVEs de SQLite nas imagens TLS e guacd. Atualizar somente sqlite-libs para3.54.1-r0 por APK oficial assinado e checksum fixado. Classificar exclusivamente o CVE do shell no pacote de bibliotecas compartilhadas, com prova de ausência do CLI, correspondência exata e expiração. Preservar todos os outros bloqueios e relatórios brutos.

## Riscos e mitigações

APK edge isolado, sem atualizar o repositório inteiro; ABI compartilhada preservada e consumidores ensaiados. Política expira em2026-11-18. Imagens x86_64 como os pins existentes. Não é aceite de risco de um CLI instalado.

## Matriz de testes e evidências

Ran: 51 contratos de segurança PASS (36 SQLite), lint estrito PASS; builds TLS/guacd PASS; Grype real por ID imutável PASS com base válida; Python SQLite FTS5/secure-delete e Certbot PASS; TLS real UID1001 com ACME/SSH PTY/WebSocket e recuperação PASS; guacd UID1000, handshakes SSH/RDP/VNC PASS. Não é validação completa de renderização RDP/VNC.

## Baseline

554790c3081b4f345a5b9f754c0199e685f2644d

## Rollback ou recuperação

Branch independente; reverter pin e política em conjunto. Não implantar imagens antigas vulneráveis por rollback automático. Nenhuma alteração em VPS.

## Aprovação

Decisão: GO_WITH_RISKS — integrar para validação; revisão independente complementar e homologação continuam pendentes.

Correção necessária dentro da autorização de conformidade e correção dos bloqueios de CI. Revisão independente complementar pendente; não presumir homologação humana.
