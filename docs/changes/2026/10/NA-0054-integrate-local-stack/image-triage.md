# Revalidação independente MySQL — 11/10/2026

Parecer: atualizar somente a versão exata de `openssl-libs` na revisão de `ELSA-2026-50075`, para `1:3.5.8-2.0.1.el9_8`. Manter expiração em **08/11/2026**, demais campos de correspondência e bloqueio High/Critical/Unknown. A revisão de GnuTLS permanece intacta.

O relatório CI231 identifica Oracle Linux 9.8, pacote RPM epoch 1, arquitetura x86_64 e fonte `openssl-3.5.8-2.0.1.el9_8.src.rpm`. Imagem: `sha256:8dbf322ea0f6539fbed640616449dff7bf1bd11dd88841823a49dd1a2b5bb132`. O matcher RPM aplicou a condição `< 10:3.5.1-7.0.1.el9_7_fips` ao pacote regular.

A Oracle publica o pacote instalado no **BaseOS Latest / u8_baseos_patch**, pelo [ELSA-2026-77396, de 08/10/2026](https://linux.oracle.com/errata/ELSA-2026-77396.html). Seu changelog corrige CVE-2026-84782, preservando a base 3.5.8. SHA256 publicado para o RPM x86_64: `149ad68c947c556a08f165d9bb03fbdd9a4172f8769ac1eb5d19bb413facc877`.

Já o [ELSA-2026-50075](https://linux.oracle.com/errata/ELSA-2026-50075.html) declara epoch 10 e sufixo FIPS no canal `ol9_x86_64_u3_security_validation`. O [advisory upstream OpenSSL de 27/01/2026](https://openssl-library.org/news/secadv/20260127.txt) indica 3.5.5 para corrigir os CVEs desse conjunto. A inferência técnica, combinando versão upstream instalada, canal regular e metadados do match, confirma falso positivo de comparação entre canais. Não se recomenda downgrade nem instalação FIPS para satisfazer comparação numérica.

O candidato substitui a entrada antiga, sem wildcard, intervalo de versões ou novas exclusões. O CVE-2026-84782 é vulnerabilidade real corrigida pelo novo RPM, não entra na exceção. Os 11 achados brutos permanecem; nove Medium continuam visíveis e os dois High têm revisão exata.

Validação offline contra o JSON bruto: policy anterior deixa um High sem revisão; candidata reconhece somente os dois High conhecidos. Casos negativos de expiração, versão diferente, novo CVE e severidade alterada continuam bloqueados. Evidência: `candidate-verification.json`. O código `image-policy.mjs` não mudou.

Limite: identidade instalada obtida do relatório RPM do CI; canal e changelog conferidos no advisory oficial. Não foi executado `rpm -q --changelog` na imagem efêmera do runner nem verificado o digest de um download local do RPM nesta análise. Uma nova execução do scan continua obrigatória para o SHA candidato.


A revisão exata de GnuTLS não mudou. Evidência anterior e contexto do matcher:
[NA-0048](../NA-0048-container-stack/image-triage.md).

## Docker CLI do backend

O scan identificou a stdlib Go 1.26.8 em `/usr/bin/docker`, com correções
1.26.9 disponíveis. Substituído o pacote Alpine pelo binário oficial Docker CLI
29.9.0, cujo [release note](https://docs.docker.com/engine/release-notes/29/#2990)
registra Go 1.26.9. A imagem de origem está fixada por digest no Dockerfile e
somente o executável é copiado, preservando os comandos usados pelo collector.
Não há exceção para esses achados Go. Build, scan e compatibilidade do collector
são gates desta alteração; seus resultados ficam vinculados ao SHA no PR.
