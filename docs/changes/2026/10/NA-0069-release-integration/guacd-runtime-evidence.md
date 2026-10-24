# guacd: build e compatibilidade NA-0069

Base da frente: `4e1b47f344f0e829b445254e4be2047da88eeeae`.
Revisão de integração: 2026-10-24, America/Sao_Paulo.

## Alteração

Imagem própria `nodeaccess-guacd:1.6.0-1`, fonte Apache 1.6.0 com backport oficial
GUACAMOLE-2328 e bibliotecas atuais. Proveniência, pins e limitações de manutenção
em `docker/guacd/README.md`. O adapter e o protocolo de transporte foram mantidos. A revisão visual exigiu
correção localizada do decoder e das operações de composição do renderer
existente; nenhum procedimento mapeado no manual mudou. Revalidação documental
sem alteração de capítulos/capturas. A nota antiga do PRD sobre baseline 1.5.5 foi
substituída pela baseline revisada e pelos limites das provas presentes.

Build integrado PASS pelo Dockerfile versionado, incluindo ADD com checksum,
patch sem fuzz e APK assinado. Imagem:
`sha256:5fa9fb09d7a65914af5c8c5fe477cc83bb4c8c6331b88a47da4d97f8e614573b`.
Runtime confirma UID/GID 1000, home gravável, guacd 1.6.0 e LICENSE/NOTICE presentes.

## Segurança e empacotamento

`npm run security:images -- nodeaccess-guacd:1.6.0-1`: PASS.
Relatório bruto conserva 3 High / 18 Medium / 3 Low e nenhum Critical. Os três High são
correspondências CPE incorretas, exatas e com expiração, revisadas separadamente em
`guacd-image-triage.md`; nenhuma vulnerabilidade High real foi dispensada.
Raw: `artifacts/security/images/nodeaccess-guacd_1.6.0-1.json`.

`node --test scripts/security/image-policy.test.mjs scripts/security/guacd-image-policy.test.mjs tools/deploy/release-package.test.mjs`: 8 PASS.
Valida políticas estritas e overrides no pacote normal/HA, imagens no manifesto,
checksums e preservação dos agentes assinados. `bash -n` e ESLint do teste: PASS.
Compose validado estruturalmente com `--no-env-resolution --no-interpolate`;
resolução completa de ambiente não exercitada, pois checkout não contém `.env`.
CI constrói/scaneia a imagem e executa ambas as políticas. Build oficial de release
constrói guacd e a inclui no pacote offline. Compose desenvolvimento constrói
localmente e publica apenas loopback por padrão, configurável por
`GUACD_BIND_ADDRESS`; produção/HA continuam sem publicar 4822.

## Compatibilidade gráfica

Imagem Apache 1.6.0 oficial passou como controle na fixture Linux x11vnc/xrdp TLS.
Primeiro candidato sem backport falhou em RDP com asserção nativa de cache FreeRDP;
o mesmo cenário passou após backport, sem mudar o adapter NodeAccess.

Candidato corrigido `ff8dd9ed...` passou pintura, teclado com arquivo novo,
clipboard verificado em arquivo e continuidade após resize em RDP/VNC. Senha VNC
incorreta foi recusada (código 519), sem imagem. Adapter backend e encoders/decoder
frontend reais. RDP observou 800x600, mas Xvfb fixo retorna 1024x768; não se presume
resize persistente. A imagem final integrada repetiu esses testes com sucesso.

Não equivale a homologação Windows/NLA, áudio, impressão ou todas as variantes de
servidor gráfico. Nenhum recurso de produção ou banco foi usado pelas fixtures.

## Regressão visual identificada e corrigida

Primeira inspeção das capturas Vue rejeitou a imagem parcial apesar de métricas
de render/input positivas. Captura direta do Xvfb confirmou que os buracos não
existiam na máquina remota. O wire recebido usa `img(stream,mask,layer,mime,x,y)`
e `rect(layer,x,y,w,h)`; o decoder anterior trocava buffers negativos por layer0
e ignorava rects válidos. Paths intercalados por layer também eram perdidos.

Correção preserva a fila assíncrona e o snapshot de self-copy. Paths por layer
aceitam múltiplos retângulos, e fill/copy/image aplicam as máscaras Porter-Duff
Apache com save/restore em try/finally; contadores e primeira imagem só avançam
após desenho bem-sucedido. Cópia suficiente para a tela principal
marca primeira imagem remota; pixels ainda não pintados iniciam pretos, sem
herdar a cor de loading. Sem mudança de dimensões, layout, autenticação ou SSH.

22 testes unitários passaram, incluindo wire real, buffers negativos, paths
intercalados/múltiplos, descarte/reset, coordenadas não finitas e novo caminho
após clip (preservando fill imediato). Prova Chromium de pixels passou para
clear/source-over/copy e restauração do contexto. Tipos frontend e gate do manual
passaram. RDP após parser apresentou diferença absoluta ZERO entre canvas1024x768
e framebuffer Xvfb; a rodada fria final após ajuste do fundo preto confirmou ambos os
protocolos. Comparação1.5.5 não concluiu a entrada na fixture
e não é contabilizada como baseline visual aprovada.

## Resultado final no navegador

Componente `GraphicalSessionView.vue` real em Chromium headless, CSS/idioma reais,
auth/hostService sintéticos e WebSocket/adapter/guacd reais. Rodada sequencial fria
com a imagem final identificada acima: teclado e clipboard confirmados por novos
arquivos remotos; zero erros JavaScript e nenhum overlay de espera. Capturas
desktop1280x900, resize1000x760 e mobile390x844 inspecionadas: sem buracos de
renderização. Canvas e framebuffer pareados no mesmo instante: VNC desktop/resize
AE0; RDP desktop AE0, resize28 pixels no cursor I-beam, confirmado pelo recorte.
A prova não atribui diferenças de cursor à perda de conteúdo.

Rerun adicional `npm run test:terminal-experience:web`:PASS, frontend5297 com
Chromium local; nenhum transporte SSH foi alterado nesta correção. Lint estrito
dos quatro arquivos alterados/harness:PASS; frontend typecheck:PASS.
`manual:check-reviewed`:PASS, sem capítulo mapeado alterado por este renderer.

Evidência local detalhada: `/tmp/na0069-guacd-candidate/proof/` contém
`browser-final-report.json`, pares `canvas-*.png`/`fixture-*.png`, seis capturas
`browser-final-*.png`, raw do protocolo, snapshots antes da correção e o recorte
`rdp-resize-difference.png`. Logs adicionais:
`/tmp/na0069-guacd-{parser-tests,parser-types,parser-lint,compositing-pixels,terminal-experience}.log`.

Escopo visual aprovado: Linux x11vnc/xrdp TLS, tema escuro e view gráfica isolada
real. Não se presume matriz light, Windows/NLA, áudio/impressão, nem autenticação
real nesta fixture. A jornada real normal/trial/MFA está registrada separadamente.

## Recuperação após exceção de desenho

Revisão independente solicitou try/finally nos três blocos de contexto e casos
negativos de coordenadas/paths. Código revalidado independentemente:22 testes
PASS; tipos, lint, pixels e manual repetidos com sucesso.

Prova Vue fria com uma única exceção `drawImage`, injetada exclusivamente pelo
harness: máscara `copy` e profundidade de save1 no momento da falha; depois,
`source-over` e profundidade0. Exatamente um `render-error`, zero pageerrors.
Cópia seguinte produziu pixel vermelho255,0,0, outros24 desenhos reais ocorreram,
e teclado remoto criou um novo arquivo com conteúdo `recovered`. Captura da
recuperação inspecionada, sem falhas visuais. Nenhum hook de teste foi incluído
no produto. Relatório: `proof/browser-exception-report.json`; harness e captura
adjacentes em `/tmp/na0069-guacd-candidate/`.
