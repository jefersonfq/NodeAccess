# Diagnóstico de conexão do agente

## Comportamento

- O NodeAccess preserva o motivo do desligamento, em vez de substituí-lo pelo código WebSocket genérico. Cada conexão autenticada recebe uma referência própria no histórico.
- Encerramentos e erros tardios de uma conexão substituída não retiram a conexão nova do registro nem sobrescrevem seu estado. Tentativas TCP pendentes são rejeitadas imediatamente quando o agente sai.
- O agente usa 10 s para estabelecer WebSocket, 10 s para confirmar registro após abertura e 90 s sem heartbeat do servidor. O gateway envia heartbeat a cada 30 s e verifica o limite de 75 s nesse ciclo (a detecção pode ocorrer no ciclo seguinte).
- DNS/política local: 5 s; estabelecimento TCP: 15 s; espera externa no gateway: 25 s para receber o diagnóstico específico. Esses limites não são timeouts de inatividade do SSH.
- Reconexão com espera exponencial e variação aleatória, limitada a 60 s. O contador só reinicia depois de registro confirmado e estabilidade. Não há repetição de comandos nem restauração automática de sessões SSH.

## Experiência do usuário

Na tela **Agentes → Ver detalhes**, o diagnóstico informa o fato observado, a ação recomendada e o código. Após recuperação, a falha anterior permanece no histórico, sem aparecer como problema atual. A tela notifica mudanças confirmadas de estado e distingue falha de consulta à API de queda do agente.

No aplicativo Windows, o status informa orientação, próxima tentativa e referência. Alertas de queda são limitados a um a cada 30 s; a recuperação informa que sessões SSH interrompidas precisam ser abertas novamente. Falhas sem evidência suficiente não são atribuídas automaticamente à VPN ou internet.

No histórico, eventos observados pelo servidor são distintos dos relatados pelo agente. O horário declarado pelo agente aparece separado do horário de recebimento. O relógio da estação não é uma fonte de tempo confiável para auditoria.

## Diagnósticos durante indisponibilidade

A fila local guarda até 100 eventos, em lotes de 20. Usa `<status-file>.events.json` ou `<log-file>.events.json`; sem esses caminhos opera apenas em memória. Gravação local atômica, permissões restritas e falhas de disco não impedem acesso. A fila é isolada por servidor e credencial; trocar a configuração não envia eventos anteriores para outra identidade.

O servidor aceita somente códigos conhecidos, UUIDs e datas, após autenticação. Identidade e proprietário vêm da conexão autenticada, nunca do relato. Campos extras são descartados. Não são enviados tokens, comandos, saída de terminal ou mensagens livres na fila.

O ACK só é enviado depois da gravação. Reenvios idênticos são deduplicados no histórico persistido. O mecanismo é diagnóstico de melhor esforço, não uma garantia transacional de entrega única entre múltiplos processos concorrentes. A fila pode perder os eventos mais antigos ao atingir 100, e falhas de escrita impedem sobreviver a reinício local.

Agentes antigos continuam aceitos: os campos e mensagens novos são opcionais. Para obter watchdog, fila e feedback local novos, é necessário distribuir uma nova versão do agente/instalador. A implementação não publica artefatos nem altera produção automaticamente.

## Validação

- `npx vitest run apps/backend/src/modules/agents apps/frontend/src/services/agent-presentation.service.test.ts`
- `node --test apps/agent/src/connection-health.test.js apps/agent/src/agent-runtime.test.js apps/agent/src/agent-integration.test.js apps/agent/src/diagnostic-log.test.js tools/agent/registration-diagnostics.test.cjs tools/agent/faults.test.cjs`
- `RUN_AGENT_DIAGNOSTICS_REAL=1 npx vitest run apps/backend/src/modules/agents/agent-diagnostic.integration.test.ts`
- `npm run test:agents:web` e `UI_THEME=light npm run test:agents:web`
- `npm run test:terminal-experience:web`
- `HOST_ID=<host-descartavel> npm run test:terminal-pty:real`

Os testes web usam respostas simuladas para falha de API, queda, recuperação, onboarding, manutenção e conectividade do destino. O teste de integração executa o processo real do agente com WebSocket/TCP locais, interrupção, reconexão, ACK e fila persistida. O teste PTY exige um host SSH descartável e comandos `top` e `htop` disponíveis.

## Evidências desta revisão

- 84 testes Vitest aprovados, incluindo processo real do agente conectado ao gateway; persistência representada por adaptador de teste em memória nesse cenário.
- 24 testes Node aprovados: protocolo real WebSocket/TCP, falhas consecutivas, registro, políticas, fila, limites, rotação de logs e contratos do instalador.
- Playwright aprovado nos temas claro/escuro e viewport de 390 px; diagnóstico visual inspecionado após ajuste de espaçamento mobile. Relatórios: `/tmp/nodeaccess-agent-diagnostics-{dark,light}.json` e capturas com o mesmo prefixo.
- Regressão de experiência do terminal aprovada: `/tmp/nodeaccess-terminal-experience.json`.
- PTY SSH real aprovado com `top` e `htop`: `/tmp/nodeaccess-agent-diagnostic-pty/{top,htop}.json`, sem divergências de geometria. Host/container local descartável, sem comandos em hosts de produção.
- Typecheck de backend e frontend aprovados. A interface gráfica nativa Windows não foi executada neste ambiente Linux; requer a validação Windows antes de publicar o MSI.

- Binário Linux empacotado em `/tmp/nodeaccess-agent-diagnostics-linux`; quatro cenários de registro (401, 403, 502 e conexão recusada) aprovados contra o executável, confirmando inclusão do catálogo compartilhado. Artefato apenas de teste, sem publicação.
- O lint amplo dos arquivos legados não está limpo: há uso anterior de WebSocket como `any`, callbacks assíncronos e símbolos sem uso. A revisão preserva essa fronteira existente e corrige os problemas novos de parsing/tipagem, sem refatorar o transporte global para satisfazer o lint.
