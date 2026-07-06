# Terminal Telnet Adapter v1

## Decisao

Telnet deve usar o terminal textual existente, com xterm.js no frontend e WebSocket do gateway de terminal no backend.

Nao usar `guacd` para Telnet nesta etapa. O `guacd` fica reservado para sessoes graficas como RDP/VNC.

## Arquitetura

```text
Browser xterm.js
  -> WebSocket terminal
  -> SshGateway textual
  -> TelnetSessionOpener
  -> net.Socket ou socket de Agent
  -> host:porta Telnet
```

O nome `SshGateway` permanece por compatibilidade do modulo atual, mas o suporte Telnet deve ficar isolado no adapter `telnet.session.ts`.

## Regras

- Telnet e protocolo texto, portanto deve abrir no terminal web.
- Login e senha devem ser digitados na tela remota, sem automacao de prompt no MVP.
- O backend nao deve logar conteudo digitado por padrao.
- A negociacao Telnet basica deve remover comandos IAC da saida enviada ao xterm.
- Opcoes suportadas inicialmente: NAWS, terminal type, echo e suppress go-ahead.
- O adapter Telnet deve aceitar socket injetado para testes e para uso via Agent.
- Fechamento local da aba/WebSocket nao deve ser tratado como fechamento remoto do Telnet.
- Logs de lifecycle devem registrar somente metadados e contadores, como bytes, mensagens, resize e origem do fechamento.

## Validacao

- Testar `TelnetNegotiator` com comandos IAC parciais e completos.
- Testar `openTelnetSession` com socket injetado.
- Testar fechamento local e fechamento remoto separadamente.
- Garantir que SSH, RDP e VNC nao dependam do adapter Telnet.
