# Revisão SQLite das imagens TLS e guacd

Os scanners hospedados de 554790c30 detectaram CVE-2026-119374, CVE-2026-119379 e CVE-2026-119373 no sqlite-libs 3.53.4-r0. Os registros CNA delimitam as falhas de FTS5/session às versões anteriores a3.54.0. As imagens passam a instalar somente o APK sqlite-libs3.54.1-r0, com checksumSHA256 e assinatura Alpine validados; o repositório global continua estável. ABI libsqlite3.so.0 preservada, sem atualização geral para edge.

Fontes primárias consultadas em2026-11-04:

- [CVE-2026-119374](https://raw.githubusercontent.com/CVEProject/cvelistV5/main/cves/2026/119xxx/CVE-2026-119374.json)
- [CVE-2026-119379](https://raw.githubusercontent.com/CVEProject/cvelistV5/main/cves/2026/119xxx/CVE-2026-119379.json)
- [CVE-2026-119373](https://raw.githubusercontent.com/CVEProject/cvelistV5/main/cves/2026/119xxx/CVE-2026-119373.json)
- [Pacote oficial Alpine](https://pkgs.alpinelinux.org/package/edge/main/x86_64/sqlite-libs)
- [Release SQLite3.54.1](https://www.sqlite.org/changes.html)

O [CVE-2026-119586](https://raw.githubusercontent.com/CVEProject/cvelistV5/main/cves/2026/119xxx/CVE-2026-119586.json) trata do shell SQLite: a exploração requer que a saída de .recover seja fornecida novamente ao executável sqlite3, interpretando dot-commands. Esse shell não faz parte do pacote sqlite-libs. A conclusão de não aplicabilidade é restrita ao componente compartilhado e às imagens verificadas; não é aceite da vulnerabilidade do CLI.

A política expira em2026-11-18 e exige imagens, distro, APK, versão, CVE, fonte, CPE, faixa e resultado de fix exatos. Mudanças nessas identidades bloqueiam. O pacote sqlite (CLI), os três CVEs de memória, outras imagens e versões não são dispensados. O relatório bruto conserva todos os achados. Ambos os builds exigem ausência de /usr/bin/sqlite3.

Validações executadas:51contratos das políticas de imagens/histórico PASS, incluindo36positivos/negativos SQLite; lint estrito PASS. Build das duas imagens PASS. Python SQLite3.54.1 executou FTS5, busca e secure-delete; Certbot5.6.0 carregou. Ensaio TLS real sob UID1001 PASS com ACME, recuperação, SSH PTY e WebSocket preservados. guacd UID1000 respondeu aos handshakes reais SSH/RDP/VNC; shell SQLite ausente. Não representa teste de renderização completa de desktops remotos.

Nova varredura Grype por ID imutável PASS nas duas imagens: os três CVEs de memória desapareceram; somente o CVE do CLI foi classificado pela nova política exata. Base Grype válida de2026-11-04; relatórios brutos preservados. Integração/CI e revisão independente complementar pendentes. Nenhuma exceção genérica ou mudança em produção.
