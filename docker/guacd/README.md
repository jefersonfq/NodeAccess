# NodeAccess guacd 1.6.0-1

Imagem própria para o transporte RDP/VNC existente, construída por
`docker build -f docker/guacd.Dockerfile -t nodeaccess-guacd:1.6.0-1 .`.
Não é a imagem pré-compilada publicada pelo Apache. A porta 4822 continua restrita
à rede interna em produção/HA; ela não oferece autenticação própria. No Compose
de desenvolvimento, o bind padrão é loopback (`GUACD_BIND_ADDRESS=127.0.0.1`)
e pode ser configurado apenas para uma interface privada protegida. SSH do NodeAccess continua
usando seu transporte separado.

## Fontes e integridade

- Fonte oficial Apache Guacamole 1.6.0: `https://downloads.apache.org/guacamole/1.6.0/source/guacamole-server-1.6.0.tar.gz`.
  SHA256 `8bc45675da96d7b6f39728160181e3d4ff3c08f460f6d26de5805b642bf13f2b`.
  O checksum oficial e a assinatura destacada foram verificados na revisão.
  Signatário `F467E54ACC52F1D2778826865B2977AEE5E4518F`, chave obtida do KEYS
  oficial via HTTPS; não se presume uma cadeia independente de confiança PGP.
  O Dockerfile fixa os bytes revisados com `ADD --checksum` e preserva LICENSE/NOTICE
  da distribuição em `/opt/guacamole/licenses/`.
- Base Alpine 3.24.3 por digest no Dockerfile; bibliotecas FreeRDP 3.32.1-r0,
  libvncserver 0.9.15-r0 e OpenSSL 3.5.9-r0 provenientes do APK oficial.
  O mirror oficial `dl-4.alpinelinux.org` mantém verificação normal de assinaturas.
- ALSA 1.2.16.1-r0: único pacote oficial do branch edge necessário para corrigir
  CVE-2026-56109. SHA256 `e9d92102c6537a036cc3f4e27f97fe860f944f3b26565d9991bfdbe21c2a4caa`.
  Sua dependência é apenas o SONAME musl já presente; o build comprovou atualização
  de exatamente um pacote. Não adicionamos edge aos repositórios nem desativamos
  assinatura APK. Revisar disponibilidade, ABI e vulnerabilidades a cada rebuild.

## Backport Apache

Guacamole 1.6.0 falha ao iniciar RDP com FreeRDP >= 3.31 porque inicializa o GDI
antes da criação do cache. O teste real reproduziu a asserção nativa.
[GUACAMOLE-2328/PR 713](https://github.com/apache/guacamole-server/pull/713), aprovado
pelo mantenedor e integrado à preparação 1.6.1, move GDI e handlers para PostConnect.

Commit original `ab36756b596520ae2a94cd4d25e406e0b5aa820b`; patch original SHA256
`9dd225f2e3dfa74e72904aebe18c9cb60c8ae92f8842595c35db11ab253d70e5`.
`guacamole-2328.patch` adapta somente o contexto do release 1.6.0, preservando
RAIL/SVC em PreConnect. SHA256 `b47b3c026839a4e002e39515017e40d75631e1880abbe7688e0d4d3ffec48e46`,
verificado antes da aplicação sem fuzz. Não é uma atualização para uma versão
Apache ainda não lançada. Remover esse backport quando um release oficial
incorporar a correção, repetindo as provas de compatibilidade.

## Operação e validação

O build oficial de release constrói esta imagem e o pacote offline a inclui.
Compose, Helm e `docker/stack-images.json` usam a mesma tag. CI constrói e executa
o scanner oficial, incluindo a política estrita de correspondências revisadas.
Os relatórios brutos conservam todos os achados; não há aceitação de risco High
real. A triagem documentada cobre apenas correspondências CPE incorretas e exatas.

Mantidos o entrypoint Apache, fontes, Ghostscript e bibliotecas de áudio/impressão,
usuário 1000 sem privilégios com home gravável e healthcheck local. Correção localizada no renderer existente interpreta os argumentos oficiais de
`img`/`rect`, preserva paths por layer e aplica máscaras Porter-Duff com
restauração do contexto. A aparência e os procedimentos não mudaram; o manual
foi revalidado sem alteração de capítulos.

Provas locais usam x11vnc+xrdp TLS descartáveis com o adapter backend e o decoder
frontend reais: pintura, teclado, clipboard, continuidade após pedido de resize,
e rejeição de senha VNC incorreta. Xvfb tem resolução fixa e xrdp retorna à sua
geometria; isso não demonstra redimensionamento persistente. A validação inclui o componente Vue real com autenticação/host sintéticos e
transporte gráfico real. Não equivale a homologação Windows/NLA, impressão, áudio
ou aceleração gráfica.

Arquitetura deste pacote: Linux amd64, alinhada ao bundle offline e ao VPS
homologados. O APK ALSA fixado é x86_64; não declarar build arm64 validado.

A comparação visual com o framebuffer Xvfb detectou um erro preexistente de
parsing: imagens de buffers auxiliares eram desenhadas na tela principal e os
retângulos reais eram ignorados. O parser mantém os formatos tolerados antes
por compatibilidade, mas os testes de regressão usam o wire oficial capturado.
Mapeamento de composição conferido contra o [Layer.js Apache1.6.0](https://guacamole.apache.org/doc/1.6.0/guacamole-common-js/main_webapp_modules_Layer.js.html).
Prova opt-in adicional de pixels: `FRONTEND_URL=http://127.0.0.1:5173 node tools/frontend/graphical-compositing-playwright.cjs`
(com Vite ativo; `CHROMIUM_PATH` pode selecionar o navegador local).
