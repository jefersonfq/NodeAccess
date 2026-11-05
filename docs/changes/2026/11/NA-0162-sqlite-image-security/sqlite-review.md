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


## Revalidação por imagem — 2026-11-05

O CI 42023591492 do candidato NA-0169 b0ac11ef encontrou Alpine 3.24.4 na imagem TLS, após atualização de pacotes no build; a revisão anterior exigia 3.24.3 para ambas as imagens e bloqueou o achado, como previsto. A correção proposta associa cada referência à distro exata: `nodeaccess-tls-agent:security-local` → Alpine 3.24.4; `nodeaccess-guacd:1.6.0-1` → Alpine 3.24.3. Não há faixa de versões. O prazo original de 2026-11-18 e as demais identidades de pacote, CVE, severidade, fonte, matcher, CPE, faixa afetada e fix permanecem inalterados.

A [CNA de CVE-2026-119586](https://raw.githubusercontent.com/CVEProject/cvelistV5/main/cves/2026/119xxx/CVE-2026-119586.json), reconsultada em 2026-11-05, continua descrevendo injeção de comandos no shell SQLite por reutilização da saída de `.recover`. No relatório bruto do CI, o APK `sqlite-libs` 3.54.1-r0 lista apenas diretórios e bibliotecas compartilhadas (`libsqlite3.so.0` e `libsqlite3.so.3.54.1`); a revisão não se estende ao pacote CLI. A ausência do executável continua sendo exigida pelo build. Este ajuste não altera imagens nem o controle de build.

Replay local do relatório `/tmp/NA0170-tls-image.json` (SHA-256 `a11d159c1d81976c34a70c8f06a9d780d088552b084f0172a5bf74da5049a6b2`), imagem `sha256:9fbdb6d9dafcc5d38179aee9bcdd5ee6ac75c607e01b07d41e36f19167af6a32`: a política anterior classificou zero dos sete achados; a proposta classifica exclusivamente o achado CVE-2026-119586 do `sqlite-libs`. Os seis demais achados não recebem dispensa por esta política. Aplicar o mesmo relatório TLS à referência guacd continua rejeitado. Trata-se de replay de evidência existente, não de nova varredura após o ajuste.

Validação focal: 50 testes PASS, zero skips, nas políticas SQLite, imagem e guacd (42 contratos SQLite, preservando os 36 anteriores). Inclui distros cruzadas, versão futura 3.24.5 para ambas as imagens, TLS antiga 3.24.3, distro ausente e referência não cadastrada; CLI, outros CVEs, fix alterado e expiração continuam bloqueados. ESLint estrito dos dois arquivos JavaScript PASS. Evidências locais: `/tmp/NA0169-sqlite-policy-tests.log`, `/tmp/NA0169-sqlite-policy-lint.log` e `/tmp/NA0169-sqlite-replay.log`. Revisão independente, nova execução completa do CI e validação SonarQube do candidato permanecem pendentes; esta nota não aprova automaticamente a exceção nem declara a entrega concluída. As varreduras descritas acima nesta revisão permanecem evidência histórica de 2026-11-04.
