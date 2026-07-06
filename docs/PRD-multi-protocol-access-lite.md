# PRD Lite - Acesso Multi-Protocolo

## Objetivo
Evoluir o NodeAccess de uma plataforma centrada em SSH para uma plataforma de acesso remoto multi-protocolo, começando por RDP e Telnet, e deixando a arquitetura preparada para VNC, serial console e outros protocolos futuros.

O produto deve preservar os pilares atuais:
- acesso via browser
- controle de permissao por usuario, grupo e tenant
- credenciais protegidas
- auditoria por sessao
- baixa friccao operacional
- extensibilidade sem reescrever a tela de hosts e sessoes a cada protocolo novo

## Contexto atual
Hoje o modelo principal assume host SSH:
- `Host` representa o destino e carrega campos de conectividade/autenticacao SSH
- terminal web usa xterm.js e WebSocket
- backend/gateway abre SSH, transmite stdin/stdout/resize e publica eventos de auditoria
- auditoria textual reconstrói comandos a partir de eventos de terminal

PRDs existentes citam RDP/WinRM como fora do escopo imediato em `docs/PRD-lite.md` e o importador atual deixa RDP/VNC/Telnet fora do primeiro corte em `docs/PRD-ssh-importers-lite.md`. Este PRD registra o desenho para tirar esses protocolos do backlog genérico e orientar a evolução.

## Principio de arquitetura
Separar o conceito de **asset gerenciado** do conceito de **perfil de acesso**.

Um host/asset pode ter um ou mais perfis:
- SSH na porta 22
- RDP na porta 3389
- VNC na porta 5900
- Telnet na porta 23
- serial via concentrador/console server

No primeiro corte de UI, pode haver um protocolo principal no cadastro do host. Mas o modelo deve nascer preparado para múltiplos perfis por asset, evitando migracao dolorosa quando um mesmo servidor tiver SSH e RDP, ou quando um appliance tiver SSH e serial.

## Decisao recomendada
Criar uma camada `ConnectionProfile` ou equivalente, mesmo que inicialmente a UI apresente como "Tipo de protocolo" dentro do host.

Modelo conceitual:
```text
Host / Asset
  - nome, IP/FQDN, tenant, escopo, tags, pasta, criticidade
  - metadados comuns

ConnectionProfile
  - hostId
  - protocol: ssh | rdp | telnet | vnc | serial | future
  - port
  - username / credentialRef / secretRef
  - networkRoute: direct | bastion | agent | tunnel
  - protocolConfig JSON validado por schema
  - auditPolicy override opcional
  - enabled
```

Para compatibilidade, o `Host` pode manter campos SSH atuais por uma fase de transicao. Novos protocolos devem nascer em `ConnectionProfile`.

## Protocolos alvo
### SSH
Permanece como protocolo principal e referencia de UX.

Auditoria:
- eventos textuais `stdin`, `stdout`, `resize`, `session_started`, `session_ended`
- reconstrucao de comandos quando possivel
- download bruto JSONL
- resumo por IA

### Telnet
Objetivo: suportar appliances legados, roteadores antigos, consoles e sistemas que ainda dependem de terminal sem SSH.

Requisitos:
- terminal web usando xterm.js, mesma experiencia visual do SSH
- conexao TCP Telnet pelo backend/gateway, nunca direto do browser
- negociacao Telnet basica: IAC, WILL/WONT, DO/DONT, terminal type, echo quando viavel
- suporte a login interativo quando usuario/senha nao puderem ser enviados de forma deterministica
- banner de risco: Telnet e texto claro, habilitado por tenant/admin e desabilitado por padrao
- bloqueio opcional por politica: permitir Telnet apenas via rede privada, agent ou bastion

Auditoria:
- pode reaproveitar a auditoria textual de SSH
- comandos podem ser reconstruidos com menor confianca porque prompts e eco variam muito
- eventos devem registrar `protocol = telnet`
- marcar sessoes Telnet com risco operacional por serem sem criptografia

### RDP
Objetivo: permitir acesso remoto a Windows e servidores RDP pelo browser.

Requisitos funcionais:
- viewer grafico no browser
- resolucao dinamica e resize
- teclado internacional e combinacoes especiais
- mouse, scroll e clipboard com politicas por tenant/host
- credenciais via vault/1Password/segredo cifrado
- suporte a NLA quando possivel
- opcoes administrativas para:
  - ignorar/validar certificado RDP
  - habilitar/desabilitar clipboard
  - habilitar/desabilitar redirecionamento de drive/arquivo
  - definir profundidade de cor/performance
  - timeout e reconexao

Auditoria:
- RDP nao deve prometer reconstrucao de comandos como SSH
- fonte de verdade inicial deve ser:
  - metadados da sessao
  - eventos de input: teclado/mouse/clipboard quando permitido
  - screenshots periodicos ou gravacao grafica
  - eventos de conexao, resize, erro e encerramento
- comandos do Windows só devem ser considerados em fase futura via:
  - agente Windows
  - Windows Event Log
  - PowerShell transcription
  - OCR assistido por IA com confianca baixa e aviso explicito

### VNC
Objetivo: suportar acesso grafico simples para Linux, appliances, hipervisores, KVM/IPMI e desktops que exponham VNC.

Requisitos:
- viewer grafico no browser
- mouse, teclado, resize quando suportado
- senha VNC via segredo cifrado
- clipboard configuravel quando suportado
- opcoes de encoding/performance

Auditoria:
- semelhante a RDP: grafica, por frames/snapshots/input events
- sem promessa de comandos reconstruidos
- OCR opcional no futuro

### Serial console
Objetivo futuro: acessar portas seriais via console server, BMC/IPMI, appliances ou agente local.

Requisitos:
- terminal xterm.js
- perfil com parametros de linha: baud rate, data bits, parity, stop bits, flow control
- conector via agent, console server ou gateway com device access controlado
- protecao forte contra acesso indevido a dispositivos locais

Auditoria:
- textual como SSH/Telnet
- comandos podem ser extraidos por heuristica, com confianca variavel

## Opcoes tecnicas avaliadas
### Opcao A - Integrar Apache Guacamole/guacd como sidecar
Guacamole usa uma arquitetura onde o browser fala com uma camada web, e o daemon `guacd` faz a traducao para protocolos remotos. A documentacao oficial descreve `guacd` como proxy que carrega plugins de protocolo e permite que cliente/webapp sejam agnosticos a RDP/VNC/SSH/Telnet.

Vantagens:
- suporte maduro a RDP, VNC, SSH e Telnet
- ja possui conceitos de gravacao grafica e textual
- reduz risco de implementar RDP/VNC do zero
- bom caminho para MVP grafico

Desvantagens:
- adiciona stack Java/C nativa e componente operacional novo
- precisa integrar autenticacao, autorizacao, sessao e auditoria ao modelo NodeAccess
- customizacao de UX exige adaptar cliente/protocolo Guacamole ou embutir viewer
- cuidado com isolamento multi-tenant e segredos

Recomendacao: usar como base preferencial para RDP/VNC no primeiro MVP, encapsulado por um `protocol-gateway` do NodeAccess, sem expor Guacamole como produto separado.

### Opcao B - Gateway proprio com FreeRDP/libfreerdp para RDP
FreeRDP e uma implementacao RDP amplamente usada. O NodeAccess poderia criar um worker/sidecar nativo que usa FreeRDP e transmite frames/eventos para o browser.

Vantagens:
- controle maior do pipeline de auditoria e UX
- menos acoplamento com webapp externa
- potencial melhor integracao com permissoes e sessoes atuais

Desvantagens:
- alto custo tecnico
- RDP e complexo: codecs, NLA, clipboard, drive redirection, audio, certificados, teclado
- maior risco de seguranca e manutencao

Recomendacao: nao iniciar por aqui, salvo se Guacamole nao atender requisitos de produto/licenca/operacao.

### Opcao C - noVNC/websockify para VNC
noVNC e uma aplicacao/client VNC em browser e websockify faz ponte WebSocket para TCP. E adequado para VNC, mas nao resolve RDP.

Vantagens:
- simples para VNC
- encaixa bem em browser
- pode ser usado em fase especifica de VNC

Desvantagens:
- nao cobre RDP/Telnet
- auditoria grafica e controle de politicas ainda precisam ser implementados

Recomendacao: avaliar para VNC se a estrategia Guacamole for descartada ou se quisermos VNC independente.

### Opcao D - Implementacao Telnet propria
Telnet e texto e pode ser implementado no gateway Node.js com parser/negociador Telnet controlado.

Vantagens:
- reaproveita terminal e auditoria textual
- baixo custo relativo
- bom protocolo para validar abstração `ProtocolAdapter`

Desvantagens:
- Telnet e inseguro
- muitos dispositivos legados têm comportamento irregular
- prompts/login variam bastante

Recomendacao: implementar Telnet proprio, atras de feature flag e politica administrativa.

## Arquitetura alvo
### Componentes
1. `Connection Profile Service`
- CRUD de perfis de acesso
- valida schema por protocolo
- resolve credenciais e rota de rede

2. `Protocol Gateway`
- camada abstrata para iniciar sessoes por protocolo
- interface comum:
  - `connect(profile, userContext)`
  - `sendInput(sessionId, input)`
  - `resize(sessionId, size)`
  - `clipboard(sessionId, event)`
  - `close(sessionId, reason)`
  - `onAuditEvent(event)`

3. `Protocol Adapter`
- `ssh-adapter`: existente, migrado progressivamente
- `telnet-adapter`: texto, Node.js
- `rdp-adapter`: sidecar Guacamole/guacd no MVP
- `vnc-adapter`: Guacamole ou noVNC/websockify
- `serial-adapter`: futuro, via agent/console server

4. `Viewer UI`
- `TextSessionView`: SSH/Telnet/Serial com xterm.js
- `GraphicalSessionView`: RDP/VNC com canvas/web component
- toolbar comum:
  - voltar
  - copiar/colar conforme politica
  - fullscreen
  - reconnect
  - download auditoria quando permitido
  - indicador de gravacao/auditoria

5. `Audit Pipeline`
- envelope de evento comum para todos os protocolos
- artefatos por modalidade:
  - textual: JSONL/chunks, comandos derivados
  - grafico: frames/snapshots/recording, eventos de input
  - binario: metadados e checksum quando aplicavel
- politicas de custo:
  - habilitar/desabilitar gravacao por tenant, protocolo, grupo ou host
  - retenção por tipo de artefato
  - limite de FPS/snapshot rate
  - limite de resolucao/bitrate
  - compressao e storage externo quando volume justificar

## Contrato de auditoria multi-protocolo
### Envelope comum
```json
{
  "version": 2,
  "eventId": "uuid",
  "sessionId": 123,
  "tenantId": 1,
  "userId": 10,
  "hostId": 6,
  "connectionProfileId": 15,
  "protocol": "rdp",
  "modality": "graphical",
  "seq": 42,
  "timestamp": "2026-06-17T19:00:00.000Z",
  "type": "input_keyboard",
  "source": "protocol_gateway",
  "payload": {}
}
```

### Tipos comuns
- `session_started`
- `session_authenticated`
- `session_error`
- `session_ended`
- `resize`
- `clipboard_in`
- `clipboard_out`
- `file_transfer_started`
- `file_transfer_completed`
- `policy_blocked`

### Tipos textuais
- `stdin`
- `stdout`
- `stderr`
- `terminal_title`
- `command_derived`

### Tipos graficos
- `frame_snapshot`
- `recording_started`
- `recording_segment`
- `recording_ended`
- `input_keyboard`
- `input_mouse`
- `screen_resolution_changed`

## Modelo de dados sugerido
### `connection_profiles`
- `id`
- `tenant_id`
- `host_id`
- `protocol`
- `name`
- `port`
- `username`
- `credential_ref`
- `secret_source`
- `network_route`
- `config_json`
- `audit_policy_json`
- `enabled`
- `created_at`
- `updated_at`

Indices:
- `(tenant_id, host_id, protocol)`
- `(tenant_id, protocol, enabled)`
- `(credential_ref)`

### `sessions`
Adicionar ou normalizar:
- `connection_profile_id`
- `protocol`
- `modality`
- `viewer_type`
- `source`

### `session_audits`
Adicionar:
- `connection_profile_id`
- `protocol`
- `modality`
- `recording_status`
- `recording_artifact_count`
- `command_count`
- `input_event_count`

### `session_audit_artifacts`
Generalizar para:
- `artifact_type`: `jsonl_chunk`, `text_transcript`, `graphical_recording`, `screenshot`, `input_log`, `metadata`
- `storage_key`
- `content_type`
- `checksum`
- `started_at`
- `ended_at`
- `size_bytes`

## UX de hosts
### Cadastro/edicao
Campo principal:
- `Tipo de acesso`: SSH, RDP, Telnet, VNC, Serial

Campos comuns:
- nome
- IP/FQDN
- porta
- escopo
- grupo/pasta/tags
- bastion/agent/rota
- credencial

Campos especificos:
- SSH: usuario, auth type, PEM, SFTP, host key
- RDP: dominio, NLA, certificado, resolucao, clipboard, drive redirection
- Telnet: usuario opcional, senha opcional, terminal type, encoding, aviso de texto claro
- VNC: senha, encoding, clipboard, view only
- Serial: baud, parity, data bits, stop bits, flow control

### Lista de hosts
- badge de protocolo
- filtro por protocolo
- acao primaria "Conectar"
- se houver multiplos perfis: menu de conexao por protocolo

### Tela de sessao
- sessoes textuais usam layout atual de terminal
- sessoes graficas usam canvas full area com toolbar compacta
- auditoria deve indicar claramente:
  - protocolo
  - tipo de gravacao
  - politicas ativas: clipboard, file transfer, recording

## Politicas e seguranca
### Telnet
- desabilitado por padrao
- habilitacao por tenant
- opcao de exigir rede privada/agent/bastion
- aviso obrigatorio na criacao do perfil
- registrar uso em auditoria/admin log

### RDP/VNC
- clipboard desabilitavel por tenant/perfil
- transferencia de arquivo desabilitavel por tenant/perfil
- gravacao grafica configuravel por tenant/perfil
- bloqueio de conexao se certificado invalido, salvo override explicito
- limite de resolucao/FPS/bitrate para evitar abuso
- timeout de inatividade

### Credenciais
- nenhuma credencial deve ser enviada ao browser
- segredos devem permanecer cifrados ou resolvidos via vault
- campos sensiveis no `config_json` devem ser separados ou criptografados
- downloads de auditoria devem respeitar RBAC e registrar admin log

## Auditoria e compliance
### Texto
SSH, Telnet e Serial devem usar trilha textual como fonte de verdade.

Entregas:
- preview textual
- download bruto
- reconstrução de comandos com confianca
- resumo por IA
- contagem de comandos por participante
- replay de terminal read-only a partir dos eventos capturados

Para SSH, "gravar a sessao" nao deve significar video no primeiro corte. A gravacao recomendada e event-driven, reaproveitando os eventos `stdin`, `stdout`, `resize` e timestamps para reproduzir o terminal. Isso reduz storage, preserva busca e mantém correlacao com comandos. O detalhe esta em `docs/PRD-session-playback-lite.md`.

### Grafico
RDP e VNC devem usar trilha grafica + input events como fonte de verdade.

Entregas:
- replay ou download de gravacao
- snapshots navegaveis por tempo
- timeline de eventos: login, input, clipboard, transferencias, resize, erro, fim
- resumo por IA com base em metadados, OCR opcional e eventos, sempre sinalizando limitacao

### Gravacao grafica
Para protocolos graficos, e tecnicamente viavel gravar a sessao. A gravacao pode ser feita por:
- segmentos de recording gerados pelo adaptador grafico, quando a tecnologia suportar
- snapshots periodicos com delta temporal
- stream de frames compactado em artefatos segmentados
- combinacao de frames/snapshots com eventos de input, clipboard e resize

A fonte de verdade deve ser o artefato gravado no servidor, nao uma captura feita no browser do usuario. Isso evita adulteracao pelo cliente e permite aplicar RBAC, retencao e trilha de download.

Modos recomendados:
- `metadata_only`: metadados e eventos, sem imagem
- `snapshots`: screenshots periodicos e eventos
- `continuous_recording`: gravacao continua segmentada
- `on_demand`: grava apenas sessoes/hosts marcados ou quando politica exigir

Politicas por tenant/perfil:
- gravacao obrigatoria, opcional ou desabilitada
- qualidade baixa/media/alta
- intervalo de snapshot
- FPS maximo
- resolucao maxima
- retencao em dias
- mascaramento/bloqueio de clipboard
- bloqueio de file transfer

Custos esperados:
- SSH/Telnet/Serial: baixo, pois texto compacta bem
- RDP/VNC com snapshots: medio, depende de intervalo e resolucao
- RDP/VNC continuo: alto, exige compressao, segmentacao, limpeza automatica e idealmente S3/MinIO

Recomendacao: no MVP grafico, iniciar com `snapshots` ou recording nativo do adaptador quando disponivel, com retencao curta e configuravel. Evitar gravacao continua em alta qualidade como padrao.

Nao prometer no MVP:
- lista perfeita de comandos executados no Windows
- leitura de conteudo de aplicativos graficos
- OCR com valor probatorio sem revisao humana

## Backlog de qualidade do viewer grafico
Esta secao organiza melhorias observadas durante a evolucao inicial do RDP/VNC com `guacd`. A lista deve orientar tuning incremental, sem bloquear o MVP grafico.

### Situacao atual consolidada
- RDP usa `guacd` como adapter grafico inicial.
- O frontend ja processa um subconjunto do protocolo Guacamole: `size`, `rect` + `cfill`, `png`, `jpeg`, `copy`, `cursor`, `img`, `blob` e `end`.
- O frontend ja responde `sync`, envia `ack` para `blob`, envia `size`, `mouse`, `key` e clipboard texto.
- O frontend ja envia `size` em resize do container, incluindo entrada/saida de fullscreen.
- O decoder aceita MIME `image/*` para streams `img`; o handshake baseline anuncia `image/png` e `image/jpeg`, com WebP configuravel por ENV para laboratorio.
- Clipboard texto local -> remoto e remoto -> local existe, mas ainda falta politica administrativa completa por tenant/host/perfil.
- A configuracao RDP inicial prioriza qualidade e compatibilidade: `color-depth=24`, `force-lossless=true`, `resize-method=display-update`, `security=any`, `ignore-cert=true`, `server-layout=pt-br-qwerty`.
- `guacd` no compose de desenvolvimento volta a usar `guacamole/guacd:1.5.5` como baseline do MVP apos teste com 1.6.0 indicar regressao visual no cliente parcial atual. A versao 1.6.x permanece como trilha experimental para quando o renderer suportar mais opcodes/layers/compositing.

### Qualidade de imagem e compressao
1. Perfis de qualidade por host/perfil:
   - `alta_qualidade`: lossless, 24 bits, DPI alto, ideal para LAN e uso visual detalhado.
   - `balanceado`: qualidade visual boa, compressao mais agressiva quando aceitavel.
   - `baixa_banda`: permitir lossy, reduzir color depth e limitar DPI/resolucao.
2. Tornar configuraveis:
   - `force-lossless`
   - `color-depth` com opcoes como 24, 16 e, se suportado pelo adapter, 8 bits
   - DPI inicial e limites de resolucao
   - image smoothing do canvas (`high` versus visual mais pixelado/preciso para telas tecnicas)
3. Avaliar anuncio de codecs adicionais no handshake:
   - `image/webp` deve ser testado primeiro, pois pode melhorar relacao qualidade/tamanho.
   - `image/avif` deve ficar como estudo futuro; suporte e custo de decode precisam ser medidos.
4. Evitar regressao de nitidez:
   - qualquer mudanca de HiDPI/devicePixelRatio deve ser validada com texto pequeno em RDP.
   - nao assumir que multiplicar backing store por DPR melhora sempre; isso ja causou risco de blur quando combinado com scaling CSS/canvas.

### Conexao, reconexao e disponibilidade
1. Reconexao automatica:
   - implementar backoff curto quando o WebSocket cair por erro transiente.
   - avaliar se a sessao remota RDP continua viva no `guacd` e se e possivel reanexar sem recriar sessao/auditoria.
2. Timeout configuravel:
   - expor `GUACD_CONNECT_TIMEOUT_MS` em ENV/documentacao operacional.
   - avaliar controle administrativo futuro, com limites seguros.
3. Retry de handshake:
   - adicionar 1 ou 2 tentativas com delay curto para falhas transientes no startup do `guacd`.
   - nao repetir automaticamente quando a falha indicar credencial, permissao ou politica.
4. Heartbeat/keepalive:
   - manter resposta a `sync` do protocolo Guacamole.
   - adicionar heartbeat de aplicacao para detectar conexoes zumbis e encerrar auditoria com motivo correto.
5. Upgrade de `guacd`:
   - manter `guacamole/guacd:1.5.5` como baseline do MVP enquanto o cliente Guacamole do NodeAccess for parcial.
   - validar 1.6.x em laboratorio com matriz de RDP, VNC, clipboard, mouse, teclado, resize, opcodes/layers e consumo de CPU/memoria antes de trocar o default.

### Tela, resize e fullscreen
1. Resize dinamico:
   - ja existe envio de `size` quando o container muda.
   - manter testes manuais com fullscreen, painel de detalhes aberto/fechado e mudanca de zoom do browser.
2. Metodo de resize:
   - manter `display-update` como padrao.
   - adicionar fallback configuravel para `reconnect` em servidores RDP que nao suportem resize dinamico corretamente.
3. Nitidez:
   - preferir reenvio de `size` para a resolucao real disponivel em vez de depender apenas de scaling CSS.
   - registrar nas estatisticas a resolucao remota, area disponivel, DPR e modo de qualidade para diagnostico.

### Renderizacao frontend
1. Expandir opcodes Guacamole suportados conforme necessidade real:
   - prioritarios: `move`, `shade`, `distort`, `transform`, `clip`, `push`, `pop`.
   - futuros/condicionais: `video`, `audio`, `arc`, `line`, `curve`.
2. Throttling de mouse:
   - limitar eventos de movimento a uma taxa configuravel, por exemplo ate 60 eventos/s.
   - preservar eventos de clique, wheel e key sem perda.
3. Canvas e layers:
   - confirmar composicao correta de multiplas layers em janelas flutuantes, cursor e menus.
   - evitar `getImageData` no caminho quente; quando contexto 2D for criado, preferir opcoes que nao forcem leitura frequente da CPU.
4. Cursor remoto:
   - manter cursor CSS derivado de `cursor` + `srcLayer` + hotspot.
   - fallback para `auto` quando a layer do cursor ainda nao estiver disponivel.

### Audio e clipboard
1. Audio:
   - o handshake atual declara `audio`, mas o frontend nao possui decoder/renderizador de audio.
   - ate implementar audio, avaliar remover a declaracao de capacidade ou manter explicitamente como item experimental desabilitado.
2. Clipboard:
   - completar politica allow/deny por tenant, grupo, host/perfil e direcao (`local_to_remote`, `remote_to_local`).
   - registrar eventos de clipboard em auditoria sem persistir conteudo sensivel por padrao.
   - avaliar `text/html` em fase posterior; `text/plain` deve continuar o padrao inicial.

### Seguranca e configuracao RDP/VNC
1. Certificado RDP:
   - `ignore-cert=true` deve virar configuracao por perfil/politica.
   - producao deve permitir validar certificado ou exigir override auditavel.
2. Modo de seguranca RDP:
   - `security=any` favorece compatibilidade, mas deve ser configuravel.
   - permitir forcar NLA/TLS quando o ambiente exigir.
3. Layout de teclado:
   - `pt-br-qwerty` nao deve ficar fixo no longo prazo.
   - configurar por usuario, tenant ou host/perfil.
4. Limites:
   - implementar limite de sessoes graficas simultaneas por tenant/usuario/host.
   - aplicar limites de resolucao, bitrate/FPS ou perfil de qualidade para proteger CPU, rede e storage.

### Priorizacao recomendada
- Alto impacto / baixo esforco:
  - politica de `ignore-cert` e `security`
  - timeout via ENV documentado
  - throttling de mouse
  - registrar DPR/resolucao/perfil nas estatisticas
- Alto impacto / medio esforco:
  - perfis de qualidade
  - retry de handshake
  - matriz de compatibilidade para novos upgrades de `guacd`
  - opcodes graficos prioritarios
- Medio impacto / baixo esforco:
  - layout de teclado configuravel
  - image smoothing configuravel
  - fallback de resize method
- Roadmap maior:
  - reconexao transparente
  - audio
  - clipboard com policy completa
  - limites formais de sessoes simultaneas e gravacao grafica por politica

## Roadmap recomendado
### Fase 0 - Base multi-protocolo
- criar `ConnectionProfile`
- adicionar `protocol` e `modality` em sessao/auditoria
- ajustar UI de host para tipo de protocolo
- criar interface `ProtocolAdapter`
- manter SSH funcionando sem regressao

### Fase 1 - Telnet MVP
- adapter Telnet proprio
- viewer textual com xterm.js
- auditoria textual
- feature flag e politica de seguranca
- testes com appliances reais/simulados

### Fase 2 - RDP MVP
- integrar `protocol-gateway` com Guacamole/guacd ou sidecar equivalente
- viewer grafico no NodeAccess
- sessao RDP autenticada e auditada
- snapshots ou recording inicial
- politicas de clipboard e resolucao
- sem promessa de comandos derivados

### Fase 3 - VNC MVP
- reaproveitar Guacamole ou noVNC/websockify
- viewer grafico
- auditoria grafica e input events
- politicas de clipboard/view-only

### Fase 4 - Serial
- definir conector: agent, console server ou device local
- adapter serial
- auditoria textual
- politicas de acesso por dispositivo

## Criterios de aceite
### Plataforma
- SSH atual continua funcionando sem alteracao visivel obrigatoria
- host pode ter protocolo principal selecionavel
- backend cria sessao com `protocol` e `connectionProfileId`
- auditoria mostra protocolo, modalidade e tipo de artefato

### Telnet
- admin consegue criar perfil Telnet somente se feature/politica permitir
- usuario autorizado abre terminal Telnet pelo browser
- inputs/outputs sao auditados
- tela mostra aviso de protocolo sem criptografia

### RDP
- admin consegue criar perfil RDP
- usuario autorizado abre desktop remoto pelo browser
- nenhum segredo RDP chega ao frontend
- sessao registra inicio/fim/erro/input/resize
- existe artefato grafico ou snapshots para auditoria

### UX
- lista de hosts filtra por protocolo
- acao de conexao e clara para SSH/RDP/Telnet/VNC
- telas de auditoria nao tentam mostrar "comandos" para RDP/VNC como se fossem SSH

## Fora do escopo do MVP
- WinRM
- RDP RemoteApp avancado
- audio bidirecional
- impressora remota
- drive redirection amplo
- OCR probatorio
- gravacao em video altamente comprimida com busca sem fase propria
- cliente desktop nativo

## Riscos
- RDP tem superficie de seguranca e compatibilidade alta
- gravacao grafica pode consumir muito storage
- Telnet pode contrariar politicas de seguranca se habilitado sem governanca
- importadores existentes precisam passar a entender protocolos sem importar segredos indevidamente
- multi-perfil por host pode exigir migracao cuidadosa na UI de hosts

## Metricas
- tempo para criar primeiro perfil RDP/Telnet
- taxa de sucesso de conexao por protocolo
- latencia percebida no viewer grafico
- tamanho medio de artefato por minuto de sessao RDP/VNC
- percentual de sessoes auditadas com artefato completo
- incidentes de politica: clipboard bloqueado, file transfer bloqueado, Telnet bloqueado

## Referencias tecnicas
- Apache Guacamole - Configuring connections: https://guacamole.apache.org/doc/gug/configuring-guacamole.html
  - documenta VNC, RDP, SSH, Telnet, clipboard, file transfer e gravacao textual/grafica.
- Apache Guacamole - Implementation and architecture: https://guacamole.apache.org/doc/gug/guacamole-architecture.html
  - descreve a separacao entre browser/webapp e `guacd`, com plugins de protocolo.
- Apache Guacamole - guacd configuration: https://guacamole.apache.org/doc/gug/configuring-guacamole.html#configuring-guacd
  - registra o daemon `guacd`, porta padrao 4822 e opcoes de TLS.
- noVNC embedding: https://novnc.com/noVNC/docs/EMBEDDING.html
  - referencia para embutir viewer VNC no browser.
- websockify: https://github.com/novnc/websockify
  - ponte WebSocket para TCP usada no ecossistema noVNC.
- FreeRDP reference: https://github.com/FreeRDP/FreeRDP/wiki/Reference-Documentation
  - referencia para avaliar sidecar RDP proprio em fase futura.
