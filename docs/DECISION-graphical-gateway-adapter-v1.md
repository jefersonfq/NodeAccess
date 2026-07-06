# DECISION - Graphical gateway adapter v1

## Contexto

NodeAccess ja aceita hosts RDP e VNC no inventario e reserva sessoes graficas em `/ws/graphical/:hostId`.
O fluxo atual ainda nao faz streaming grafico real: ele valida permissao, cria sessao, registra auditoria minima e retorna `GRAPHICAL_GATEWAY_PENDING`.

## Decisao

Usar uma camada `GraphicalSessionAdapter` no backend para isolar o gateway web da implementacao do protocolo grafico.

Implementacao atual:

- `PendingGraphicalSessionAdapter`: mantem o comportamento atual de reserva pendente.

Implementacao alvo:

- `GuacdGraphicalSessionAdapter`: adapter para Apache Guacamole `guacd`, cobrindo RDP e VNC sem implementar protocolo grafico do zero em Node.js.
  - Estado atual: abre TCP com `guacd` e executa o handshake inicial `select -> args -> size -> audio -> video -> image -> connect -> ready`.
  - Mesmo sem audio/video habilitados por ENV, o adapter deve enviar `audio;` e `video;` vazios. Omissao dessas instrucoes ja causou RDP conectado sem frames iniciais em `guacd`.
  - Mantem uma ponte inicial WebSocket browser <-> backend <-> `guacd`, usando mensagens JSON de controle e mensagens `guacd` encapsuladas.
  - Frontend ja possui buffer/parser de instrucoes Guacamole e responde `sync` automaticamente.
  - O frontend nao deve iniciar `sync` apos `ready`; ele deve apenas responder ao `sync` enviado pelo servidor. `sync` prematuro ja causou `User connection aborted` no `guacd`.
  - Frontend ja envia `mouse`, `key` e `size` a partir de um canvas focavel.
  - Para RDP/xrdp validado no host de teste, `resize-method=reconnect` e necessario para tela cheia e mudancas de resolucao refletirem no framebuffer remoto. `display-update` manteve a conexao aberta, mas nao entregou novo `size/img` de forma confiavel.
  - O tamanho inicial enviado no WebSocket deve refletir a area util real do canvas. Regressao ja observada: a tela normal abriu com `1362x600`, depois o container cresceu para `1362x700`, deixando faixa/escala incorreta. A abertura normal validada usa aproximadamente `1362x700`; tela cheia validada usa `1646x900`.
  - A abertura grafica deve respeitar a preferencia do usuario `terminal.graphicalOpenMode`: `dedicated` abre `/graphical/:hostId`; `tab` anexa a sessao grafica em uma aba do console. O default permanece `dedicated` para preservar o comportamento atual.
  - Quando a sessao grafica estiver embutida em aba, o tamanho inicial deve vir do container da aba, sem a compensacao vertical usada pela pagina dedicada.
  - No dev local, o backend workspace pode carregar `apps/backend/.env`; manter `GUACD_RDP_RESIZE_METHOD=reconnect` tambem nesse arquivo ou o gateway pode voltar ao default/process env errado.
  - O fallback de credenciais/video no frontend deve depender de renderizacao real (`guacdRenderCount`/opcodes de display), nao apenas de qualquer frame recebido. `mouse`, `set` e `sync` podem chegar sem bitmap e deixar a tela conectada, mas vazia.
  - Frontend ja renderiza um subconjunto inicial de instrucoes graficas no canvas: `size`, `rect` + `cfill`, `png`, `jpeg` e imagens por stream `img` + `blob` + `end`.
  - Backend preserva instrucoes recebidas no mesmo pacote TCP apos o `ready` do handshake.
  - Frontend ja envia clipboard local para remoto usando stream `clipboard` + `blob` + `end`.
  - Frontend ja recebe clipboard remoto para local quando o navegador permite escrita via Clipboard API.
  - Ainda nao implementa a camada grafica completa do protocolo Guacamole.

Configuracao:

- `GRAPHICAL_GATEWAY_ADAPTER=pending|guacd`;
- `GUACD_HOST`;
- `GUACD_PORT`.
- `GUACD_CONNECT_TIMEOUT_MS`;
- `GUACD_IMAGE_MIMETYPES` (default: `image/png,image/jpeg`);
- `GUACD_ENABLE_AUDIO_STREAMS=false`;
- `GUACD_ENABLE_VIDEO_STREAMS=false`;
  - parametros RDP por ENV:
  - `GUACD_RDP_SECURITY`;
  - `GUACD_RDP_IGNORE_CERT`;
  - `GUACD_RDP_RESIZE_METHOD`;
  - `GUACD_RDP_COLOR_DEPTH`;
  - `GUACD_RDP_FORCE_LOSSLESS`;
  - `GUACD_RDP_SERVER_LAYOUT`;
  - flags de experiencia visual/performance como wallpaper, theming, font smoothing, GFX e caches.
  - parametros VNC por ENV:
    - `GUACD_VNC_COLOR_DEPTH`;
    - `GUACD_VNC_READ_ONLY`;
    - `GUACD_VNC_SWAP_RED_BLUE`;
    - `GUACD_VNC_CURSOR`.

O valor padrao deve permanecer `pending` ate o streaming grafico estar implementado.

Padroes de adapter:

- enviar as instrucoes `audio` e `video` no handshake, mas sem MIME types enquanto o frontend nao tiver decoder/renderizador desses streams;
- manter PNG/JPEG como baseline do MVP com `guacd` 1.5.5; WebP fica disponivel por ENV para laboratorio;
- manter `reconnect` como padrao de resize RDP enquanto `display-update` nao for validado de forma confiavel nos alvos xrdp/Windows usados pelo NodeAccess;
- manter `disable-gfx=true`, `disable-bitmap-caching=true` e `disable-offscreen-caching=true` por padrao enquanto o cliente Guacamole no frontend ainda for parcial;
- tratar `guacd` 1.6.x como laboratorio ate validar renderizacao com opcodes/layers/compositing adicionais;
- manter `force-lossless=true` no default atual por qualidade visual, mas com ENV para alternar quando baixa latencia/banda for prioridade;
- `ignore-cert=true` e `security=any` permanecem defaults de compatibilidade/teste, mas devem virar politica por perfil antes de uso estrito em producao.
- Para VNC, reaproveitar `passwordEncrypted` do host como senha VNC e nao enviar parametros especificos de RDP no `connect`.

## Motivos

- RDP e VNC exigem negociacao grafica, compressao, mouse, teclado, resize e detalhes de protocolo.
- `guacd` ja resolve RDP/VNC e reduz risco tecnico.
- NodeAccess permanece responsavel por autenticacao, autorizacao, sessao, auditoria, politicas e UX.
- A troca de adapter evita acoplar streaming grafico na regra de permissao/auditoria do gateway.

## Fluxo alvo

1. Browser abre `/graphical/:hostId`.
2. Frontend abre WebSocket `/ws/graphical/:hostId`.
3. Backend valida JWT, tenant, escopo e grupo.
4. Backend cria `sessions` e `session_audits`.
5. `GraphicalGateway` chama `GraphicalSessionAdapter.open`.
6. Adapter conecta no `guacd` e executa handshake inicial.
7. Backend faz ponte WebSocket browser <-> guacd.
8. Frontend recebe mensagens `guacd`, processa instrucoes e renderiza o display grafico.
9. Encerramento fecha guacd, sessao e auditoria.

## Auditoria v1

Enquanto nao houver streaming:

- registrar `session_started`;
- registrar `session_ended`;
- usar `connection_method`:
  - `rdp_gateway_pending`;
  - `vnc_gateway_pending`;
- usar `ended_reason = graphical_gateway_pending`.

Com streaming:

- manter metadados de sessao;
- registrar resize e eventos operacionais relevantes;
- avaliar gravacao de video/snapshots como recurso separado por licenca/politica.

## Checklist de validacao atual

1. Criar ou editar host com protocolo RDP.
2. Clicar em conectar.
3. Confirmar abertura da tela `/graphical/:hostId`.
4. Confirmar status `Gateway grafico reservado`.
5. Confirmar `sessionId` na tela.
6. Como admin, abrir auditoria pelo botao `Abrir auditoria`.
7. Confirmar renderizacao do display no modo normal, sem distorcao do canvas.
8. Entrar em tela cheia e confirmar que o canvas/framebuffer passa a usar a resolucao da viewport, sem listras pretas quando o remoto aceitar o resize.
9. Confirmar nos logs do gateway:
   - `initialHeight` compatível com o container normal, nao o valor transitorio de loading;
   - `resizeMethod: "reconnect"`;
   - chegada de opcodes de imagem (`img`/`png`/`jpeg`) antes de considerar a tela renderizada;
   - `graphical.gateway.session.end.persisted` ao desconectar, fechar a aba ou fechar a tela dedicada.
10. Confirmar `/admin/sessions` com rota `RDP via gateway grafico`.
11. Confirmar `/admin/session-audit/:sessionId` com metodo legivel.

## Proxima implementacao

1. Ampliar renderizacao para instrucoes graficas adicionais do protocolo Guacamole.
2. Ampliar UX/politicas de clipboard, incluindo opcao administrativa para habilitar/desabilitar sincronizacao.
3. Adicionar limites de sessao grafica simultanea.
4. Adicionar teste integrado opcional com `guacd` real via profile `graphical`.
