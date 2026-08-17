# PRD Lite - Plataforma de IA do NodeAccess

## Objetivo

Unificar IA local, provedores externos, MCP, assistente do produto, analise de
auditoria e diagnosticos SSH em uma plataforma opcional, simples de configurar,
segura para operar e forte em rastreabilidade.

O diferencial esperado nao e apenas gerar texto. O NodeAccess deve transformar
uma intencao em contexto, plano, aprovacao, execucao isolada, evidencias,
validacao e relatorio vinculado a sessao, host, usuario e ticket.

## Principios

- nenhum fluxo de login, terminal ou SSH pode depender de IA;
- provider escolhe inferencia, nunca autorizacao ou regra de negocio;
- o modelo nao recebe DSN, credencial SQL nem acesso livre ao banco;
- dados e alteracoes sao expostos por tools tipadas que aplicam tenant, ACL,
  entitlement, policy, rate limit, idempotencia, redaction e auditoria;
- toda acao inicia como plano estruturado e passa por `ActionRun`;
- diagnostico e mudanca sao classes diferentes de risco;
- local e externo usam o mesmo contrato de tools e as mesmas policies;
- contexto enviado ao provider deve ser minimo, explicito e classificavel;
- cada resposta ou execucao deve informar provider, modelo, fontes e limites;
- feature flags e kill switches devem permitir rollback sem afetar o produto.

## Inventario atual em 2026-08-14

### Provedores e configuracao

| Superficie | Providers atuais | Roteamento | Uso |
|---|---|---|---|
| Assistente local | Ollama e OpenAI-compatible | local only, network only, prefer local, prefer network | chat global e contexto do terminal |
| Resumo de auditoria | integracao OpenAI ou integracao local AI | automatic, OpenAI ou local AI | resumo estruturado, risco, achados e proximos passos |
| Diagnosticos | reutiliza resumo de IA | conforme configuracao de auditoria | resumo do DiagnosticRun |
| MCP | independente de provider | cliente externo escolhe o modelo | recursos e tools governadas |
| AI SSH Actions | independente de provider | canal informa origem | plano persistido, policy, aprovacao e execucao isolada |

Implementado:

- `OllamaProvider` com chat e streaming;
- `OpenAiCompatibleProvider` com Chat Completions e streaming;
- integracao OpenAI dedicada usando Responses API para resumo estruturado;
- segredo externo cifrado em repouso;
- healthcheck de provider e modelo;
- entitlement separado para `localAi`, `mcp` e `aiSshActions`;
- assistente global com contexto de tenant, hosts, grupos, bastions, sessoes,
  tickets, auditorias e base de conhecimento;
- chamada contextual no terminal com selecao e cauda limitada do buffer;
- base de conhecimento por tenant;
- propostas de acao e `ActionRun` com policy de comandos;
- MCP com token, capabilities, allowlist de hosts, expiracao, rate limit,
  logs, resources, actions e SSH interativo;
- diagnosticos persistidos e resumos por IA;
- resumo de auditoria manual e automatico.

### Lacunas confirmadas

Atualizacao do corte de 2026-08-14: o hub administrativo `IA e automacao` ja
consolida licenca, provider efetivo, saude testada, failover, MCP, acoes,
consumo e o ledger sanitizado em uma jornada guiada. O ledger registra sucesso
e falha, correlation ID, provider/modelo, canal, contexto por categoria,
ferramentas, latencia, tokens e retencao configuravel de 1 a 365 dias, sem
persistir prompt, resposta ou buffer do terminal. O copiloto do terminal aceita
`Ctrl/Cmd+Shift+I`, classifica comando/script pela policy e somente insere um
comando apos confirmacao, sem enviar Enter. Metricas de uso, custo, tentativas e
roteamento ja sao persistidas sem prompt ou resposta. O mesmo correlation ID
liga a interacao ao artefato de script e ao ActionRun, incluindo custo estimado
por linha. Scripts gerados viram artefatos com checksum, destino controlado,
aprovacao obrigatoria e revalidacao antes da execucao. O autocomplete local
tambem classifica prefixos e aliases operacionais sem depender de IA.

1. O nome `Assistente local` deixou de representar o produto, pois ele tambem
   aceita provider externo.
2. `openai` e `local_ai` sao integracoes separadas, mas ambas podem apontar para
   um endpoint OpenAI-compatible. A finalidade e a precedencia nao ficam claras.
3. O failover por timeout, indisponibilidade e rate limit existe em runtime;
   falta expor no hub o historico detalhado do circuit breaker por finalidade.
4. O healthcheck testa apenas o provider efetivo da policy, sem apresentar uma
   matriz independente de saude e capacidade de cada provider.
5. OpenAI usa adapter nativo Responses API, Anthropic usa Messages API e o
   adapter OpenAI-compatible permanece isolado para gateways legados. Ainda
   falta unificar capability probing, structured output e tool calling.
6. Gemini e Azure/Foundry ainda nao possuem adapters nativos nem validacao de
   credenciais/modelos.
7. O assistente conversacional e somente leitura. `low_impact` e `full_control`
   sao intencoes de policy, mas nao orquestram `ActionRun` a partir do chat.
8. Existe trilha persistida sanitizada com custo por linha e correlacao com
   script/ActionRun e chamadas MCP JSON-RPC; permanecem a correlacao das sessoes
   MCP interativas e do relatorio final de auditoria.
9. O MCP possui exemplos e teste guiado para clientes reais; falta ampliar a
   certificacao continua para mais clientes e versoes.
10. O shell MCP e autonomo e de alto risco. Ele precisa ficar visualmente e
    comercialmente separado de consulta, diagnostico e acao aprovada.
11. O terminal oferece atalho conversacional, prefixo literal `@ai`, preview,
    insercao segura, autocomplete local sem IA e criacao governada de script;
    permanece um protocolo seguro para sugerir caminhos remotos.
12. O encerramento da sessao pode gerar resumo de auditoria, mas ainda falta um
    relatorio operacional que relacione intencao, comandos, saidas, validacoes,
    achados, risco, anexos e ticket.

## Matriz de providers desejada

| Provider | Tipo | Primeiro uso recomendado | Adapter |
|---|---|---|---|
| Ollama | local | privacidade, ambientes restritos, chat e resumo | nativo atual, evoluir tools/structured output |
| OpenAI | externo | agentic tools, resumo estruturado e raciocinio | adapter nativo Responses API |
| Anthropic | externo | analise longa e tool use/MCP | adapter nativo Messages API |
| Gemini | externo | function calling e contexto amplo | adapter nativo Gemini API |
| Azure OpenAI / Foundry | externo corporativo | governanca Azure e modelos por deployment | adapter OpenAI/v1 ou Foundry |
| OpenAI-compatible | local/rede | vLLM, LM Studio, gateways e outros | adapter generico com capability probing |

Provider generico deve continuar existindo, mas adapters nativos devem declarar
capacidades reais: streaming, JSON schema, tool calling, MCP remoto, embeddings,
limite de contexto, cancelamento e metricas de uso.

## Arquitetura alvo

### 1. AI Provider Registry

Um registro unico resolve configuracao e capacidades:

- provider e deployment/modelo;
- finalidade permitida: chat, resumo, tools, embedding;
- localidade dos dados: local, rede privada ou internet;
- timeout, concorrencia, limite de contexto e budget;
- health, ultima latencia, erro sanitizado e circuit breaker;
- politica de retencao declarada pelo tenant;
- prioridade e fallback por finalidade.

Nao deve haver disputa entre modelos. Cada requisicao recebe uma finalidade e o
router produz uma decisao auditavel, por exemplo:

`terminal_assist -> local/qwen -> fallback externo desabilitado`

`audit_summary -> external/gpt -> fallback local permitido`

### 2. AI Gateway

Contrato interno comum:

- `generateText`;
- `generateStructured`;
- `streamText`;
- `runToolLoop`;
- `embed` opcional;
- cancelamento, timeout e usage;
- redaction antes do envio;
- resposta com provider/modelo/latencia/tokens/fallback.

### 3. Tool Registry

As tools do assistente interno e as capabilities MCP devem nascer do mesmo
catalogo, ainda que tenham transports diferentes.

Classes:

- leitura: hosts, sessoes, auditorias, inventario, licenca e conhecimento;
- planejamento: gerar diagnostico, script ou importacao em preview;
- alteracao governada: criar proposta, import job ou bulk action;
- execucao: criar/cancelar `ActionRun`;
- aprovacao: sempre humana e separada do modelo solicitante;
- administracao: nunca exposta por padrao a um assistente de usuario.

O modelo nao executa SQL. Uma futura pergunta como "importe estes 200 hosts"
gera um artefato tipado, preview, validacao, diff, aprovacao e job idempotente.

### 4. AI Interaction Ledger

Persistir metadados, nao raciocinio interno do modelo:

- tenant, usuario, sessao, host e ticket;
- canal: assistant, terminal, audit, diagnostic, MCP ou API;
- provider, modelo, policy e motivo do roteamento;
- hash/versao do prompt e tools oferecidas/usadas;
- contexto enviado por categoria e tamanho;
- redaction aplicada;
- latencia, usage e custo estimado;
- resposta resumida e artefatos gerados;
- approvals, ActionRuns, comandos e resultados relacionados;
- status, erro sanitizado e correlation id.

Prompt e resposta completos devem obedecer politica de retencao do tenant e nao
ser obrigatorios para telemetria basica.

## Experiencia do usuario

### Administracao de IA

Substituir configuracoes dispersas por um hub `IA e automacao` com:

1. Visao geral: o que esta ativo, onde e com qual provider.
2. Providers: cards independentes, testar, modelos, saude e privacidade.
3. Roteamento: finalidade -> primario -> fallback -> regra de dados.
4. Capacidades: assistente, auditoria, diagnosticos, terminal, MCP e actions.
5. Governanca: usuarios/grupos/hosts, modos, approvals, budgets e retencao.
6. Auditoria: interacoes, tools, bloqueios, custos e ActionRuns.

Estados obrigatorios: carregando, nao licenciado, sem provider, provider
indisponivel, configuracao invalida, degradado, saudavel e budget esgotado.

### Assistente do NodeAccess

O nome recomendado e `Assistente NodeAccess`, com seletor administrativo de
provider, nao uma tela diferente por modelo.

Modos visiveis ao usuario:

- `Perguntar`: leitura e orientacao do produto;
- `Investigar`: coleta contexto e sugere diagnostico;
- `Planejar acao`: gera plano e preview, sem executar;
- `Executar com aprovacao`: cria ActionRun governado quando permitido.

Respostas devem mostrar fontes e oferecer proximos passos concretos: abrir host,
ver auditoria, criar diagnostico ou revisar plano.

### Terminal

O autocomplete do terminal e dividido em dois recursos independentes:

- `Autocomplete padrao`: entitlement `terminalAutocomplete`, deterministico e sem provider de IA. Completa comandos e caminhos remotos via SFTP a partir do contexto permitido da sessao, com navegacao por setas, `Enter`, `Escape`, `Tab` e selecao por clique. O cache dura poucos segundos e e isolado por tenant, host e sessao.
- `Autocomplete powered by IA`: opcional, condicionado ao modulo/licenca, configuracao do tenant e disponibilidade de provider local ou externo. Converte linguagem natural em sugestao de comando ou script, sempre como rascunho editavel e nunca como execucao silenciosa.

Desabilitar IA nao pode degradar o autocomplete padrao nem o fluxo SSH. O cache deterministico fica limitado ao contexto da sessao e deve ser invalidado quando diretorio, host, identidade ou conexao mudar. Respostas de IA nao podem ser reutilizadas entre tenants, usuarios ou sessoes, nem tratadas como decisao de autorizacao.

Primeiro corte entregue:

- atalho configuravel, por exemplo `Ctrl+Space`, abre palette sem enviar bytes ao
  servidor remoto;
- prefixo literal opcional, por exemplo `@ai`, e interceptado apenas quando a
  linha ainda nao foi enviada;
- pergunta usa selecao atual ou cauda limitada do buffer;
- resposta aparece em painel sobreposto, nunca misturada silenciosamente ao
  stdout auditado;
- usuario pode `Copiar`, `Inserir comando` ou `Criar plano`;
- inserir nao executa; Enter continua sendo decisao do usuario;
- scripts viram artefatos com preview, checksum, destino permitido e ActionRun.

Os entitlements `terminalAutocomplete` e `terminalAi` sao independentes. O
segundo tambem exige `localAi` e e revalidado no backend. Mesmo quando
contratados, ambos podem ser desligados pelo usuario em suas preferencias de
terminal, sem alterar a politica do tenant.

### Prontidao operacional de integracoes

- Estados canonicos: `disabled`, `not_configured`, `validation_required`,
  `ready`, `unhealthy` e `stale`.
- Somente `ready` significa operacional. Licenca, habilitacao e configuracao
  continuam sendo dimensoes independentes.
- Mudancas em provider, URL, modelo ou credencial invalidam o teste anterior.
- O administrador sempre ve o provider, o motivo e a acao para testar novamente.
- Recursos de usuario final nao aparecem sem provider operacional; o backend
  repete a validacao para impedir bypass da interface.
- TTL inicial: cinco minutos para IA e quinze minutos para JIRA e LDAP.

### Diagnosticos

Estado atual: o Assistente NodeAccess gera plano estruturado de ate oito steps,
exibe comandos e timeouts, classifica cada step pela policy do tenant e bloqueia
a criacao quando houver comando proibido. O ActionRun e criado apenas apos
revisao explicita e revalida entitlement, ACL e policy no backend.
Ao concluir um DiagnosticRun, a tela disponibiliza relatorio versionado com
identidade do host/run, resumo, evidencias sanitizadas, contadores de resultado
e checksum SHA-256. Como a execucao e SSH isolada, sessao e ticket permanecem
explicitamente sem vinculo ate existir uma origem persistida confiavel.
O operador pode vincular explicitamente sessao, ticket e ActionRun. Cada
referencia e validada no mesmo tenant, host e escopo do usuario, persistida no
DiagnosticRun, auditada e incorporada ao checksum do relatorio.
Quando existe ticket vinculado, o operador pode enfileirar comentario com link,
resultado e checksum e, opcionalmente, anexar o JSON verificavel. O anexo exige
confirmacao explicita e a outbox evita duplicacao pelo checksum do relatorio.

Pedido em linguagem natural deve gerar playbook estruturado e validado:

- objetivo e hipoteses;
- comandos somente leitura por padrao;
- timeout e limite de output por etapa;
- evidencias esperadas;
- redaction;
- validacao final;
- resumo e relatorio persistido.

Exemplos prioritarios:

- load, CPU, memoria e processos;
- disco, inodes, LVM e filesystem;
- descritores, arquivos deletados ainda abertos e limites;
- rede, sockets, DNS e rotas;
- estado de servicos e logs recentes;
- comparacao antes/depois no mesmo host, com baseline explicito, ACL nas duas
  execucoes e classificacao deterministica sem atribuir causalidade.
- historico por host com janela das 30 execucoes mais recentes, tendencia de
  falhas/risco e recorrencia textual; ausencia de resumo deve ser explicita.

## MCP alvo

A tela deve ter perfis claros:

- `Somente consulta`;
- `Diagnostico governado`;
- `Acoes com aprovacao`;
- `Shell autonomo` — avancado, alto risco e desabilitado por padrao.

Para cada cliente suportado, mostrar:

- URL do servidor;
- transport/protocolo realmente suportado;
- exemplo de configuracao copiavel;
- onde armazenar o token;
- teste de discovery;
- chamada segura de exemplo;
- resultado esperado;
- atalhos para logs, bloqueios e sessoes abertas.

Um wizard de teste deve executar: autenticar, listar capabilities, buscar host,
ler recurso e opcionalmente criar um diagnostico sem mutacao.

## Seguranca e governanca

- deny by default por capability, host, grupo, usuario e canal;
- approvals nao podem ser concedidos pelo mesmo principal tecnico que solicitou;
- shell autonomo exige entitlement, feature flag, token explicito, allowlist de
  hosts, TTL curto, rate limit e kill switch;
- comandos sao reavaliados imediatamente antes da execucao;
- scripts sao analisados como conteudo, nao liberados apenas pelo nome;
- output enviado ao modelo passa por redaction e limite de tamanho;
- prompt injection em terminal, arquivo, ticket ou documento e tratado como dado,
  nunca como instrucao de sistema;
- tools mutaveis usam idempotency key e preview/diff;
- todas as escritas preservam os services/repositories existentes;
- nenhuma tool retorna password, PEM, token, secret ou config cifrada;
- retencao e envio externo devem ser transparentes ao tenant e ao usuario.

## Performance

- streaming para UX, sem manter request HTTP bloqueado para jobs longos;
- filas para resumo, diagnostico, embeddings e relatorios;
- limite de concorrencia por tenant/provider/finalidade;
- circuit breaker e backoff para provider externo;
- cache apenas para contexto nao sensivel e estavel, com chave por tenant/ACL;
- prompt prefix caching somente quando compativel com politica de dados;
- truncamento semantico: comandos e eventos relevantes antes de buffer bruto;
- budgets de tokens, duracao e custo por finalidade;
- cancelamento propagado do browser ate provider e runner;
- metricas sem prompts: requests, latencia, tokens, falhas, fallback e fila.

## Roadmap recomendado

### Fase A - Fundacao e clareza

- inventario e PRD unificado;
- AI Provider Registry e capability probing;
- separar provider de finalidade;
- matriz de roteamento e health por provider;
- renomear UX para `Assistente NodeAccess`;
- ledger minimo de interacoes e metricas.

### Fase B - MCP adotavel

- perfis de token e shell avancado separado;
- exemplos de clientes reais;
- wizard de teste read-only;
- catalogo visual de resources/tools/prompts;
- testes Playwright/CDP e contrato MCP.

### Fase C - Assistente com tools de leitura

- Tool Registry compartilhado;
- tool loop para providers capazes;
- navegacao e deep links nas respostas;
- fontes, tool trace e feedback do usuario;
- knowledge com escopo e busca semantica.

### Fase D - Terminal copilot

- palette/atalho sem interferir no xterm;
- explicar, sugerir e inserir comando sem executar;
- gerar plano e script como artefato;
- historico e auditoria da interacao.

### Fase E - Diagnostico governado

- linguagem natural para playbook estruturado;
- biblioteca excelente de diagnosticos;
- execucao read-only, evidencias e validacao;
- relatorio ligado a sessao, host, usuario e ticket.

### Fase F - Acoes e operacao do sistema

- chat cria ActionRun e bulk/import preview;
- approvals, idempotencia e rollback;
- alteracoes em massa por tools tipadas;
- autonomia limitada por policy, nunca SQL livre.

## Criterios de aceite da fundacao

- admin entende em uma tela qual IA atende cada finalidade;
- local e externo podem coexistir sem ambiguidade;
- falha e fallback sao explicitos e auditados;
- provider novo nao altera services de negocio;
- assistente e MCP usam o mesmo catalogo logico de tools;
- toda interacao relevante possui correlation id e metadados auditaveis;
- terminal continua funcional com toda IA desligada;
- nenhuma capacidade mutavel contorna ACL, approvals ou repositories existentes.

## Referencias de providers

- OpenAI Responses API e tools: https://platform.openai.com/docs/quickstart
- OpenAI data controls: https://platform.openai.com/docs/models/default-usage-policies-by-endpoint
- Anthropic MCP: https://docs.anthropic.com/en/docs/mcp
- Gemini function calling: https://ai.google.dev/gemini-api/docs/function-calling
- Microsoft Foundry endpoints: https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/endpoints
