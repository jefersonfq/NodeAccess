# NA-0206 — Triagem dos achados do helper de firewall do ensaio de restauração

Estado: **proposta de aceite com prazo, sujeita a revisão independente** (registrada abaixo). Não altera baseline de imagens do release, não vale para nenhuma imagem de produção e não substitui atualização quando houver pacote corrigido.

## Objeto

Helper temporário `na-firewall-helper` (fonte em `.tmp/NA-0206/clone-firewall-helper/`, fora do Git), usado somente no ensaio isolado de restauração do NA-0206 para isolar a rede do clone. Imagem Alpine 3.24.4 (`sha256:c237489ea628…`), scan offline em `.tmp/NA-0206/helper-scan-resume/` com 37 ocorrências.

## Fatos verificados em 2026-11-27

- Todos os pacotes afetados já estão na **última versão publicada do Alpine 3.24**: python3 3.14.10-r2, sqlite-libs 3.53.4-r0, libssl3/libcrypto3 3.5.9-r1, busybox 1.37.0-r31. Evidência: `apk list` no índice oficial em 2026-11-27T17:58:25-03:00, `.tmp/NA-0206/helper-scan-resume/apk-list-2026-11-27.txt` (SHA256 `230ddf31…300e30b`). Base de vulnerabilidades do scan: 2026-11-26T06:22Z, scan offline. O scanner não indica versão corrigida (`fix.state` vazio ou `unknown`). Não há atualização possível sem misturar repositório `edge`.
- `helper.py` (106 linhas) importa apenas `argparse, ipaddress, json, os, re, shlex, subprocess, sys`; não usa `socket`, HTTP, `ssl` ou `sqlite3`.
- Executa só binários fixos (`/sbin/ip`, `/sbin/iptables`, `/sbin/ip6tables`, de iproute2/iptables) sem shell, com `stdin` nulo, ambiente mínimo e timeout de 12 s; saídas acima de 1 MiB são rejeitadas depois de lidas (o limite não restringe a leitura).
- Entradas: identificadores gerados pelo próprio operador e validados por regex/`ipaddress` (run id, network id, ifindex, sub-rede, gateway); o helper interpreta o JSON de `ip -j` e a saída de `iptables -S`/`ip6tables -S` do host (`shlex.split`), que inclui regras e comentários do Docker e de qualquer processo com `NET_ADMIN` no host. Rede, sub-rede e gateway vêm do `docker inspect` da rede do clone (exigida `Internal`, sem IPv6, com label). Nada vem do banco restaurado nem dos containers do clone: influenciar a entrada exige já ser root/`NET_ADMIN` no host ou ter acesso ao daemon.
- Container: `--rm --read-only --tmpfs /run` (noexec, 1 MiB) `--cap-drop ALL --cap-add NET_ADMIN --security-opt no-new-privileges --user 0 --network host`, com `--entrypoint /usr/local/bin/na-firewall-helper`; o script roda pelo shebang `python3 -I` (sem `-B`, sem efeito com sistema de arquivos somente leitura). `/sbin/ip` é o iproute2 7.0.0 (`build-approved-1j1s7yxx/readonly-tools.json`); `iptables` é `xtables-nft-multi`. Não expõe porta nem abre conexão; vida útil de uma invocação.

## Classes e decisão

| Classe | Pacotes | Exposição no helper | Decisão |
|---|---|---|---|
| S | sqlite-libs | dependência do python3; módulo `sqlite3` não é importado | aceitar com prazo |
| P | python3 | interpretador executa só `helper.py` com `-I`, sem rede e com entradas validadas | aceitar com prazo |
| O | libssl3, libcrypto3 | base da imagem (apk/ssl_client) e dependência do python3; helper não importa `ssl`/`hashlib` nem faz TLS | aceitar com prazo |
| B | busybox, busybox-binsh, ssl_client | utilitários da base; helper não invoca diretamente shell nem applets; `modprobe` eventual do iptables é bloqueado por `cap-drop ALL` | aceitar com prazo |

Risco residual: o container tem `NET_ADMIN` com `--user 0` na rede do host e, portanto, poderia reescrever o firewall inteiro do host, não só as cadeias do ensaio. A barreira contra uso no daemon de produção é a verificação de `productionDaemonId` no launcher. Um bug explorável no interpretador exigiria entrada controlada por atacante, que este fluxo só recebe de quem já tem privilégio no host. A avaliação é por exposição e **não** analisa o mérito técnico de cada CVE.

## Condições do aceite

1. Preso à imagem `sha256:c237489ea6283282844d9423a60e341698ad4c13c60b9da10a6afa6c61eba959` e ao `helper.py` SHA256 `40e4b1de2e101f0f14b117b49c48e4cfd04ba30ed160906458c44687851d0669`; qualquer mudança exige nova triagem.
2. Válido somente para o ensaio isolado do NA-0206 e até **2026-12-31**, ou até um novo scan indicar `fix.state=fixed` para qualquer pacote listado (o que vier primeiro).
3. Antes de cada uso, novo scan com base de vulnerabilidades atualizada, registrando a data da base; qualquer CVE novo, severidade Critical ou pacote fora desta lista invalida o aceite.
4. Executar somente contra daemon não produtivo, verificado pelo launcher (`productionDaemonId`); salvar `iptables -S`/`ip6tables -S` antes e depois e conferir a limpeza; não iniciar a aplicação do clone antes de instalar e verificar as regras (`invocation-contract.json`).
5. Imagem reconstruída somente pelo Dockerfile revisado, base por digest e APKs com `SHA256SUMS`; sem `--allow-untrusted`. Remover a imagem após o ensaio ou no vencimento.
6. Nenhuma outra imagem herda este aceite.

## Achados

| # | CVE | Severidade | Pacotes | Classe |
|---|---|---|---|---|
| 1 | CVE-2026-107493 | High | libcrypto3 3.5.9-r1, libssl3 3.5.9-r1 | O |
| 2 | CVE-2026-107494 | High | libcrypto3 3.5.9-r1, libssl3 3.5.9-r1 | O |
| 3 | CVE-2026-119170 | High | python3 3.14.10-r2 | P |
| 4 | CVE-2026-119373 | High | sqlite-libs 3.53.4-r0 | S |
| 5 | CVE-2026-119374 | High | sqlite-libs 3.53.4-r0 | S |
| 6 | CVE-2026-119379 | High | sqlite-libs 3.53.4-r0 | S |
| 7 | CVE-2026-119586 | High | sqlite-libs 3.53.4-r0 | S |
| 8 | CVE-2026-121482 | High | libcrypto3 3.5.9-r1, libssl3 3.5.9-r1 | O |
| 9 | CVE-2026-124709 | High | libcrypto3 3.5.9-r1, libssl3 3.5.9-r1 | O |
| 10 | CVE-2026-84786 | High | libcrypto3 3.5.9-r1, libssl3 3.5.9-r1 | O |
| 11 | CVE-2025-15367 | Medium | python3 3.14.10-r2 | P |
| 12 | CVE-2025-60876 | Medium | busybox 1.37.0-r31, busybox-binsh 1.37.0-r31, ssl_client 1.37.0-r31 | B |
| 13 | CVE-2026-115559 | Medium | python3 3.14.10-r2 | P |
| 14 | CVE-2026-115791 | Medium | python3 3.14.10-r2 | P |
| 15 | CVE-2026-116566 | Medium | python3 3.14.10-r2 | P |
| 16 | CVE-2026-119371 | Medium | sqlite-libs 3.53.4-r0 | S |
| 17 | CVE-2026-119372 | Medium | sqlite-libs 3.53.4-r0 | S |
| 18 | CVE-2026-119375 | Medium | sqlite-libs 3.53.4-r0 | S |
| 19 | CVE-2026-119376 | Medium | sqlite-libs 3.53.4-r0 | S |
| 20 | CVE-2026-119378 | Medium | sqlite-libs 3.53.4-r0 | S |
| 21 | CVE-2026-119591 | Medium | sqlite-libs 3.53.4-r0 | S |
| 22 | CVE-2026-124249 | Medium | python3 3.14.10-r2 | P |
| 23 | CVE-2026-35190 | Medium | libcrypto3 3.5.9-r1, libssl3 3.5.9-r1 | O |
| 24 | CVE-2026-95690 | Medium | libcrypto3 3.5.9-r1, libssl3 3.5.9-r1 | O |
| 25 | CVE-2026-103995 | Low | python3 3.14.10-r2 | P |
| 26 | CVE-2026-119377 | Low | sqlite-libs 3.53.4-r0 | S |
| 27 | CVE-2026-16052 | Low | python3 3.14.10-r2 | P |
| 28 | CVE-2026-19552 | Negligible | python3 3.14.10-r2 | P |

Ocorrências no scan: 37; linhas únicas (CVE×severidade): 28

## Revisão independente

2026-11-27, revisor independente (agente sem a conclusão do implementador, somente leitura): **PASS_WITH_WARNINGS**. Tabela recalculada de `raw.json` confere (37 ocorrências, 28 linhas: 10 High, 14 Medium, 3 Low, 1 Negligible); image ID e fontes idênticos ao contexto de build. Correções exigidas aplicadas nesta versão: entrypoint/shebang, leitura de `iptables -S`, limite de saída, evidência datada do `apk list`, aceite preso a image ID/hash, base de vulnerabilidades atualizada, condições de daemon/firewall/limpeza, dependência do python3 em OpenSSL e redação sobre busybox/`modprobe`. Opcional não aplicado: endurecer o Dockerfile com `ip -V` exigindo iproute2 (o helper é fonte fora do Git, revisada no NA-0206).

Decisão final de aceite: responsável pelo produto, já autorizada pelo usuário em 2026-11-27 para seguir com o item; este documento não executa o ensaio.
