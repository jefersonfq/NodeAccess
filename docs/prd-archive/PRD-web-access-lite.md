# PRD Web Access Lite

## Objetivo
Permitir acesso HTTP/HTTPS a servicos internos alcancados por SSH sem expor port forwardings brutos diretamente na rede publica.

## Contexto Atual
- Port forwardings hoje abrem listeners no servidor NodeAccess.
- O bind seguro padrao e `127.0.0.1`.
- Isso e correto para seguranca, mas nao gera um link utilizavel no navegador do usuario final.
- Expor `0.0.0.0` diretamente como solucao principal aumentaria risco operacional e de seguranca.

## Direcionamento Recomendado
- Nao tratar `bindAddress=0.0.0.0` como feature de acesso web.
- Criar uma feature separada de proxy web autenticado dentro do NodeAccess.
- O NodeAccess passa a receber a requisicao web do usuario, validar permissao e encaminhar o trafego para o destino interno via tunnel ja autorizado.

## Problema de Produto
Hoje existe uma expectativa legitima de clicar em algo como `Abrir no navegador` para:
- dashboards internos
- apps web
- consoles administrativas
- servicos HTTP/HTTPS atras de SSH

Mas isso ainda nao e coerente com a topologia atual:
- `127.0.0.1:porta` aponta para o servidor NodeAccess
- nao para a maquina do usuario

## Escopo Inicial Recomendado
1. Suportar apenas HTTP/HTTPS
2. Reaproveitar hosts e politicas ja existentes:
- `direct`
- `agent`
3. Exigir autenticacao do usuario no NodeAccess
4. Exigir autorizacao pelo mesmo acesso real ao host
5. Registrar auditoria da abertura e uso do acesso web

## Modelo Recomendado
- O usuario cria ou reutiliza um forwarding HTTP/HTTPS
- O NodeAccess gera uma rota autenticada interna, por exemplo:
  - `/web-access/:token`
  - ou subrota por recurso
- Essa rota faz proxy para o destino interno usando o caminho autorizado:
  - direto
  - via agente

## Fase 1
- Definir modelo de acesso web por forwarding
- Decisao: web access nasce de um forwarding existente, nao de uma configuracao separada nesta fase
- Restringir para HTTP/HTTPS
- Mostrar link apenas quando o forwarding for marcado como web-enabled
- Reaplicar permissao do host e do forwarding
- Logar:
  - quem abriu
  - quando abriu
  - host
  - forwarding
  - metodo real usado
- Status: metadados `webEnabled` e `webProtocol` adicionados ao forwarding; proxy autenticado segue para proxima fase

## Fase 2
- Gerar link temporario autenticado por sessao web
- Permitir abrir no navegador dentro da UI
- Exibir estado:
  - ativo
  - expirado
  - sem permissao
  - destino indisponivel
- Implementacao inicial: proxy efemero por requisicao usando tunnel local temporario em `127.0.0.1`
- Limitacoes conhecidas desta fase:
  - sem websocket
  - com reescrita basica de redirects e cookies
  - sem reescrita avancada de HTML/assets absolutos
  - HTTPS tolera certificados internos sem exigir validade publica

## Fase 3
- Avaliar URL amigavel por subdominio
- Avaliar proxy HTTPS de ponta a ponta
- Avaliar expiracao curta e revogacao manual

## Regras de Produto
- Acesso web nao substitui o forwarding bruto; e uma feature diferente.
- Sem exposicao publica por padrao.
- Sem fallback silencioso entre `agent` e `direct`.
- A auditoria precisa registrar o caminho real utilizado.
- O usuario deve entender se abriu:
  - um tunnel tecnico
  - ou um acesso web via NodeAccess

## Riscos
- Confundir acesso web com port forwarding tradicional
- Expor servicos internos por link sem clareza de autenticacao
- Quebrar apps que dependem de websocket, cookies, host header ou redirects absolutos
- Misturar HTTP com protocolos nao-web no mesmo fluxo

## Classes de Compatibilidade
- Classe A: paginas HTTP simples com assets relativos e login basico
  - tendem a funcionar com pouca ou nenhuma adaptacao extra
- Classe B: apps legadas com redirects absolutos, cookies e forms classicos
  - tendem a exigir parser de formulario, reescrita de assets e ajustes de cookie/path
- Classe C: apps administrativas mais complexas
  - podem exigir tratamento de headers, redirects, assets absolutos e comportamento de sessao
- Classe D: apps modernas com websocket, SPA pesada ou dependencia forte de host original
  - tendem a precisar de trabalho especifico adicional

## Regra de Esforco
- Os tratamentos atuais nao sao exclusivos desta pagina testada; eles fortalecem a base reutilizavel do proxy.
- Mesmo assim, web access nao deve ser tratado como compatibilidade universal imediata.
- O caminho recomendado e evoluir por classes de app, nao por prometer suporte total generico desde o inicio.

## Fora de Escopo Inicial
- TCP generico com link publico
- UDP
- Exposicao publica aberta sem autenticacao
- Multi-node routing
- Service mesh

## Arquivos Provaveis
- backend:
  - `apps/backend/src/server.ts`
  - `apps/backend/src/modules/tunnels/tunnel.service.ts`
  - `apps/backend/src/modules/port-forwardings/port-forwarding.service.ts`
  - `apps/backend/src/modules/agents/agent.registry.ts`
  - novo modulo de proxy web
- frontend:
  - `apps/frontend/src/views/ForwardingsView.vue`
  - `apps/frontend/src/components/TunnelManager.vue`
  - possivel nova tela ou modal de web access

## Proximo Corte Recomendado
- definir se o web access nasce de um forwarding existente ou de uma configuracao dedicada
- mapear restricoes tecnicas minimas:
  - headers
  - cookies
  - websocket
  - redirects
