# Triagem das imagens — 08/10/2026

O relatório bruto mantém todos os achados. O gate bloqueia High/Critical/Unknown sem revisão específica. Não há exclusão genérica de CVE, de pacote ou da imagem MySQL.

## Dois falsos positivos de canal FIPS no MySQL

Imagem local validada: nodeaccess-mysql:8.4.12-1, Oracle Linux 9.8, ID sha256:02dcd8f4b51651acd719c24aef6c7359cc4b8fa6ea1877137cbd5708cc2fb651.

| Alerta | Instalado | Versão comparada pelo scanner |
| --- | --- | --- |
| ELSA-2026-50075, openssl-libs | 1:3.5.8-1.0.1.el9_8 | 10:3.5.1-7.0.1.el9_7_fips |
| ELSA-2026-50346, gnutls | 3.8.10-9.el9_8 | 10:3.8.10-4.el9_8_fips |

Os próprios advisories da Oracle explicam o uso do epoch 10 e do sufixo FIPS para um canal específico. O scanner compara esse epoch com os pacotes comuns instalados e os considera anteriores, mesmo contendo as correções.

- OpenSSL: o advisory upstream de 27/01/2026 indica 3.5.5 como correção dos CVEs agrupados no ELSA; o pacote instalado foi rebaseado em 3.5.8, conforme seu changelog RPM. Fontes: https://openssl-library.org/news/secadv/20260127.txt e https://linux.oracle.com/errata/ELSA-2026-50075.html.
- GnuTLS: o ELSA descreve os patches em 3.8.10-4 antes da alteração FIPS. O changelog do RPM instalado 3.8.10-9 contém os 13 CVEs relacionados no advisory, incluindo os quatro classificados como High. Fonte: https://linux.oracle.com/errata/ELSA-2026-50346.html.

Essa é uma classificação técnica de falso positivo, não aceitação de uma vulnerabilidade comprovada. A exceção exige imagem/tag, distribuição 9.8, namespace Oracle 9, pacote, versão, severidade, advisory, URL e versão de correção exatamente iguais. Expira em 08/11/2026; mudanças nesses campos ou novos alertas voltam a bloquear. Testes negativos cobrem esses limites. Não se instalou um pacote FIPS inadequado apenas para mudar a comparação.

## Riscos residuais

Os alertas Medium/Low permanecem visíveis em image-scan.json. BusyBox CVE-2025-60876 não tinha correção indicada no scan; há também registros Medium em bibliotecas Oracle e no cliente de certificados e Low no Redis. Esse gate não transforma essas imagens em livres de vulnerabilidades. Guacd permanece fora da atualização por solicitação explícita do usuário, com riscos anteriores preservados.
