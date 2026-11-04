# NA-0162 — Registro da implementação

## Pedido e objetivo

Concluir a frente Sonar e corrigir os bloqueios de segurança encontrados pelo CI.

## Implementação

Base SHA 554790c3081b4f345a5b9f754c0199e685f2644d. O CI bloqueou quatro CVEs de SQLite nas imagens TLS e guacd. Atualizar somente sqlite-libs para3.54.1-r0 por APK oficial assinado e checksum fixado. Classificar exclusivamente o CVE do shell no pacote de bibliotecas compartilhadas, com prova de ausência do CLI, correspondência exata e expiração. Preservar todos os outros bloqueios e relatórios brutos. Arquivos:docker/frontend.Dockerfile,docker/guacd.Dockerfile,scripts/security/sqlite-image-policy.mjs e teste,scan-images.mjs,security/sqlite-image-triage.json. Fontes primárias e limitações em sqlite-review.md.

## Validação

Ran: 51 contratos de segurança PASS (36 SQLite), lint estrito PASS; builds TLS/guacd PASS; Grype real por ID imutável PASS com base válida; Python SQLite FTS5/secure-delete e Certbot PASS; TLS real UID1001 com ACME/SSH PTY/WebSocket e recuperação PASS; guacd UID1000, handshakes SSH/RDP/VNC PASS. Não é validação completa de renderização RDP/VNC.

## Recuperação

Branch recuperável; imagens locais com tags próprias, sem sobrescrever tags em uso.

## Pendências

CI integrado, nova análise Sonar e revisão independente complementar pendentes. Política do shell expira em2026-11-18.

## Diário de interações

### 2026-11-04T15:01:49-03:00 — Bloqueio do scanner de imagens

Análise do log mostrou que TLS corrigido passou, mas SQLite3.53.4 bloqueou o scanner. Registros CNA confirmaram três falhas anteriores a3.54.0 e um achado específico do shell. Implementada atualização mínima e classificação específica, com relatos reais. Ran: 51 contratos de segurança PASS (36 SQLite), lint estrito PASS; builds TLS/guacd PASS; Grype real por ID imutável PASS com base válida; Python SQLite FTS5/secure-delete e Certbot PASS; TLS real UID1001 com ACME/SSH PTY/WebSocket e recuperação PASS; guacd UID1000, handshakes SSH/RDP/VNC PASS. Não é validação completa de renderização RDP/VNC. Próximo passo: integrar e executar gates no novo SHA. Nenhuma exceção genérica, deploy ou aceite de risco operacional.
