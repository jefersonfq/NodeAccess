# Guacd: revisão de identificação de componentes

Revisado em 2026-10-24. Expiração da política: **2026-11-08 às 00:00 UTC**.
Escopo: somente `nodeaccess-guacd:1.6.0-1`, Alpine `3.24.3`, três achados
High do namespace `nvd:cpe`. Não é aceite de vulnerabilidade conhecida.

## Evidência independente

O relatório inicial `nodeaccess-guacd_candidate-1.6.0.json` corresponde à imagem
`sha256:9432283184e357de17706cdcd0014a8d0be75ca39a24c6f0e67c80df51bd01d5`.
A política não aceita a referência candidate. O rebuild final e seu scanner
precisam ser validados antes de liberar a imagem.

- `libssh2 1.11.1-r4`: CVE-2026-59850 e CVE-2026-59851 foram associados pelo
  scanner ao CPE `libssh:libssh`, que identifica outro projeto. A documentação
  do próprio libssh confirma a independência das duas bibliotecas:
  https://api.libssh.org/stable/libssh_tutorial.html.
  Os avisos descrevem falhas de libssh:
  https://www.libssh.org/security/advisories/CVE-2026-59850.txt e
  https://access.redhat.com/security/cve/CVE-2026-59851.
  Inspeção do pacote instalado confirma origem `https://libssh2.org/` e
  arquivos `libssh2.so.1`/`libssh2.so.1.0.1`.
- `cups-libs 2.4.19-r1`: CVE-2018-6553 afeta o perfil AppArmor do backend
  dnssd de pacotes Ubuntu antigos, segundo a autoridade publicadora:
  https://ubuntu.com/security/CVE-2018-6553.
  Inspeção local da imagem confirmou apenas `libcups.so.2` e `libcupsimage.so.2`
  no pacote, sem `/etc/apparmor.d/usr.sbin.cupsd`,
  `/usr/lib/cups/backend/dnssd` ou `/usr/sbin/cupsd`.

A inspeção usou container descartável, sem rede, filesystem somente leitura,
sem capabilities e com no-new-privileges. Nenhuma execução em produção.

## Limites e controles

O matcher separado exige referência, distribuição, versão, pacote, advisory,
severidade, fonte e namespace exatos; `fix.versions=[]` e `fix.state=''`;
exatamente um detalhe `apk-matcher`/`cpe-match`, com CPEs pesquisado/encontrado,
pacote pesquisado, advisory encontrado e constraint iguais aos revisados.
Qualquer divergência volta a bloquear. A política Oracle existente não mudou.
O resumo mantém os achados brutos e atribui evidência/expiração da política
que efetivamente reconheceu o achado.

**CVE-2026-56109 em alsa-lib é real e não está coberta.** A correção do pacote,
rebuild e novo scan são obrigatórios. Esta revisão não aprova RDP nem a imagem
final; esses gates permanecem separados.
