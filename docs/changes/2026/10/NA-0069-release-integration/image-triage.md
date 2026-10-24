# Revisão das imagens — NA-0069

Revisado em 2026-10-24; validade da política até 2026-11-08.

A imagem MySQL reconstruída pelo Dockerfile oficial tem ID
`sha256:cafe2c0faa2915ec9978f98fdf196e799541f1a1d2d5780798b311e0a4378949`.
O RPM instalado `openssl-libs 1:3.5.8-2.0.1.el9_8` registra a correção
CVE-2026-84782 no changelog (RHEL-264479), verificada independentemente.
O advisory regular [ELSA-2026-77396](https://linux.oracle.com/errata/ELSA-2026-77396.html)
e o [advisory FIPS ELSA-2026-500448](https://linux.oracle.com/errata/ELSA-2026-500448.html)
cobrem a mesma CVE. O scanner compara o epoch FIPS 10 com o epoch regular 1.
A exceção nova exige imagem, distribuição, namespace, pacote, versão, advisory,
severidade, fonte e versão corrigida exatos. Não cobre o RPM anterior -1.

As duas exceções anteriores permanecem restritas às versões já corrigidas;
fundamentação original em `../NA-0054-integrate-local-stack/image-triage.md`.
Achados brutos permanecem nos relatórios. Não há dispensa de vulnerabilidades
reais nem mudança do gate para High/Critical/Unknown.

Ran: scanner fresco da imagem reconstruída encontrou 9 Medium e 3 High,
dos quais dois já revisados e o terceiro é o advisory FIPS descrito acima.
Ran: scanner repetido com esta política PASS para MySQL (9 Medium, 3 High
revisados) e Redis reconstruído (3 Medium, 1 Low). Planned: demais imagens.

## Correções reais, sem exceção

- Docker CLI 29.9.2, com Go 1.26.10, corrige GO-2026-6809; ver
  https://docs.docker.com/engine/release-notes/29/ e
  https://pkg.go.dev/vuln/GO-2026-6809. Versões confirmadas no runtime reconstruído.
- Nginx 1.30.6 nos três targets, conforme
  https://nginx.org/en/security_advisories.html. Digests dos manifests oficiais
  conferidos independentemente e alinhados ao manifesto/harness de headers.
- curl/libcurl removidos dos targets estático/TLS; nenhum consumidor nos hooks,
  healthchecks, dependências dinâmicas Nginx ou scripts TLS examinados.
  curl 8.22 era afetado por https://curl.se/docs/CVE-2026-92392.html.
- certifi atualizado para 2026.10.19 no worker TLS, conforme
  https://github.com/certifi/python-certifi/releases/tag/2026.10.19.

Ran: scanner frontend e Kubernetes PASS (3 Medium cada); TLS PASS (5 Medium).
Ran: 24 verificações HTTP reais e integração TLS ACME/renovação/recuperação
aprovadas, incluindo preservação de SSH e WebSocket. Backend scanner PASS (3 Medium).
