# PRD Lite - Scripts de Diagnostico Assistidos por IA

## Objetivo
Criar uma base governada de scripts de diagnostico para hosts, permitindo que usuarios autorizados solicitem diagnosticos, coletem resultados, recebam analise por IA e gerem conclusoes operacionais com trilha de auditoria.

O foco e diagnostico controlado, nao automacao irrestrita.

Ao mesmo tempo, a arquitetura deve ficar pronta para um proximo passo: IAs integradas ao NodeAccess, locais ou externas, conseguirem usar essas capacidades como ferramentas e, quando liberado por politica, operar de forma mais autonoma no host.

## Estado atual
- catalogo inicial de playbooks low-risk implementado no dashboard do host
- execucao de `DiagnosticRun` implementada com runner SSH isolado para hosts `DIRECT`
- persistencia de comandos, status, saida sanitizada e truncada implementada
- detalhe da execucao implementado com leitura por comando
- resumo por IA assincrono implementado com integracoes ja existentes
- resumo automatico do diagnostico alinhado ao entitlement `sessionAuditAiAutoSummary`
- regeneracao do resumo por IA implementada sem reexecutar o playbook
- dashboard do host mostra status de execucao, status da IA e risco resumido
- ajuda contextual implementada no dashboard do host e no detalhe da execucao
- base pronta para evoluir de `comandos` para `steps` com suporte a `scripts` aprovados
- tela administrativa de playbooks ja foi preparada semanticamente para `steps`, mantendo compatibilidade atual com `commands`

## Como usar hoje
1. abrir o dashboard do host
2. entrar em `Diagnosticos disponiveis`
3. revisar o playbook e solicitar a execucao
4. acompanhar `Solicitacoes recentes`
5. abrir o detalhe da execucao
6. ler:
   - status da execucao
   - resumo por IA, quando automatico ou manualmente solicitado
   - risco e confianca
   - achados principais
   - proximos passos
   - saida de cada comando
7. se necessario, usar `Regerar resumo` para pedir nova leitura por IA sem rerodar o playbook

## Estados principais da execucao

### DiagnosticRun
- `pending`
- `running`
- `completed`
- `failed`
- `canceled`

### DiagnosticRunCommand
- `pending`
- `running`
- `completed`
- `failed`
- `skipped`

### Resumo por IA
- `PROCESSING`
- `READY`
- `FAILED`

## Problema
Em troubleshooting, o operador costuma executar comandos repetitivos:
- rede
- CPU e memoria
- disco
- processos
- interrupcoes
- MySQL
- portas e conexoes
- logs basicos
- DNS
- latencia

Hoje isso depende de conhecimento manual, comandos copiados de fontes externas e interpretacao individual. Uma base padronizada reduziria variacao, aceleraria diagnostico e melhoraria qualidade das conclusoes.

## Beneficios esperados
- diagnosticos mais rapidos e padronizados
- menos erro humano ao lembrar comandos
- historico e evidencia do que foi coletado
- conclusoes mais consistentes com apoio de IA
- base evolutiva de playbooks por tecnologia
- melhor onboarding de usuarios menos experientes
- apoio a auditoria e pos-incidente

## Conceito recomendado
Usar o conceito de `Diagnostic Playbooks`.

Um playbook e uma definicao versionada contendo:
- nome
- categoria
- sistemas suportados
- steps permitidos
- timeout
- nivel de risco
- parser opcional
- regras de mascaramento
- prompt de analise
- permissoes exigidas
- politica de aprovacao

## Evolucao do modelo
O modelo atual usa lista de comandos. A evolucao recomendada e suportar `steps`.

Cada step pode ser:
- `command`
- `script`

### Quando usar `command`
- diagnostico simples
- 1 a 3 comandos diretos
- baixo custo de manutencao
- alta auditabilidade sem composicao extra

### Quando usar `script`
- varias verificacoes precisam ser consolidadas
- ha fallback, branching ou parsing local
- a saida ideal e estruturada
- o diagnostico ficaria fragil ou repetitivo demais como lista de comandos

### Regra de produto
- `command` continua sendo o default
- `script` e permitido apenas em playbooks aprovados
- `script` arbitrario ou gerado livremente por IA continua proibido

## Categorias iniciais

### Rede
- conectividade local
- rotas
- DNS
- portas abertas
- conexoes estabelecidas
- latencia
- perda de pacote

### Processamento
- CPU
- load average
- memoria
- swap
- top processos
- threads

### Disco e filesystem
- uso de disco
- inodes
- mounts
- IO basico

### Interrupcoes e kernel
- dmesg recente
- OOM killer
- erros de device
- mensagens criticas do kernel

### MySQL
- status do servico
- conexoes
- processlist
- variaveis relevantes
- slow queries quando permitido
- tamanho de databases
- locks e waits

### NodeAccess Agent
- status do servico
- versao
- conectividade com API
- rotas locais
- ultimos erros

## Exemplo de playbook

```yaml
id: linux-network-baseline
name: Diagnostico basico de rede Linux
category: network
target:
  os: linux
risk: low
requiresApproval: false
timeoutSeconds: 30
commands:
  - id: hostname
    command: hostnamectl
  - id: ip-address
    command: ip addr
  - id: routes
    command: ip route
  - id: dns
    command: resolvectl status || cat /etc/resolv.conf
  - id: connections
    command: ss -tunap
redaction:
  maskPatterns:
    - "(password|passwd|token|secret)=\\S+"
analysisPrompt: |
  Analise os resultados de rede.
  Destaque falhas provaveis, evidencias e proximas verificacoes seguras.
```

## Exemplo de playbook com steps

```yaml
id: linux-network-advanced
name: Diagnostico avancado de rede Linux
category: network
target:
  os: linux
risk: medium
requiresApproval: true
timeoutSeconds: 60
steps:
  - id: baseline
    type: command
    command: ip addr && ip route
    timeoutSeconds: 15
  - id: dns-check
    type: script
    scriptRef: linux/network/dns-health/v1
    timeoutSeconds: 20
  - id: summary
    type: script
    scriptRef: linux/network/collector-json/v1
    timeoutSeconds: 20
```

## Relacao com MCP
MCP pode ser usado como uma interface para expor diagnosticos a assistentes externos, mas nao deve ser a unica forma de implementar.

Arquitetura recomendada:
- criar primeiro uma camada interna de diagnosticos no NodeAccess
- depois expor capacidades via MCP ou outra interface de tools/action layer
- manter a fundacao desacoplada do canal de consumo: UI, assistente interno, MCP ou integracoes futuras devem usar a mesma camada central

Possiveis tools MCP futuras:
- `list_diagnostic_playbooks`
- `get_diagnostic_playbook`
- `request_diagnostic_run`
- `get_diagnostic_run_result`
- `analyze_diagnostic_run`
- `request_diagnostic_action`
- `get_diagnostic_capabilities`

No primeiro corte MCP nao deve executar diagnostico diretamente sem politica de permissao, aprovacao e auditoria.

## IA integrada e autonomia controlada
O NodeAccess deve ficar preparado para dois modos:

### 1. IA assistida
- a IA sugere playbooks, scripts, proximos passos e acoes
- o usuario confirma
- o NodeAccess executa e registra tudo

### 2. IA autonoma controlada
- uma IA integrada via OpenAI, Claude, local AI, MCP ou outra interface pode usar tools do NodeAccess
- a IA pode conectar no host, executar diagnosticos e propor ou executar acoes
- tudo isso deve respeitar:
  - permissoes do tenant
  - politicas por host, grupo e usuario
  - escopos de ferramenta
  - trilha completa de auditoria
  - modo `read-only`, `approval-required` ou `autonomous`

### Modo autonomo nao significa execucao irrestrita
A autonomia deve ser configurada. O NodeAccess continua sendo o enforcement point.

## Fluxo recomendado

### Fluxo manual assistido
1. usuario escolhe host
2. usuario escolhe playbook
3. NodeAccess mostra comandos que serao executados
4. usuario confirma
5. NodeAccess executa em sessao tecnica isolada ou sessao existente autorizada
6. resultados sao armazenados
7. IA analisa os resultados
8. usuario recebe resumo, evidencias e proximos passos

### Fluxo com IA
1. usuario pergunta: "diagnostique lentidao no MySQL deste host"
2. IA sugere playbook adequado
3. NodeAccess mostra plano de execucao
4. usuario confirma
5. sistema executa comandos aprovados
6. IA analisa saida coletada
7. conclusao fica vinculada ao host e ao usuario

### Fluxo futuro com autonomia controlada
1. tenant configura provider de IA e tools liberadas
2. politica define se a IA pode apenas ler, diagnosticar ou agir
3. IA consulta capacidades do host e do tenant
4. IA escolhe playbook ou script aprovado
5. NodeAccess aplica gates de permissao
6. execucao ocorre com auditoria completa
7. se a acao for permitida, a IA pode abrir uma fase de remediation ou action run
8. resultado, racional e evidencias ficam vinculados ao host

## Guardrails obrigatorios
- allowlist de comandos por playbook
- allowlist de scripts por playbook
- sem comando arbitrario gerado livremente pela IA
- confirmacao humana antes de executar no MVP
- timeout por comando e por playbook
- limite de output
- mascaramento de segredos
- execucao com usuario SSH autorizado
- respeitar acesso ao host
- auditoria de cada comando executado
- auditoria de cada script executado, com versao e hash
- logs de quem solicitou, aprovou e executou
- bloqueio de comandos destrutivos por padrao
- feature flag por tenant
- politica de autonomia por tenant, grupo, host e ferramenta
- modo `read-only`, `approval-required` e `autonomous`
- possibilidade de revogacao imediata

## Niveis de risco

### Low
Somente leitura, baixo impacto.

Exemplos:
- `uptime`
- `df -h`
- `free -m`
- `ip route`
- `ss -tunap`

### Medium
Somente leitura, mas pode gerar carga moderada, expor volume grande de dados ou tocar servicos sensiveis.

Exemplos:
- consulta MySQL em tabelas de status
- leitura de logs grandes com filtro
- comandos com maior custo de CPU/IO

### High
Pode alterar estado, reiniciar servico, matar processo, limpar cache ou modificar arquivo.

Fora do MVP.

## Execucao tecnica sugerida
Nao executar diagnosticos pelo mesmo caminho mental de snippets simples.

Snippets sao produtividade do usuario. Playbooks de diagnostico devem ter governanca propria:
- catalogo versionado
- escopo e risco
- parser
- auditoria
- politica de aprovacao
- retencao de resultado

Pode reutilizar partes de snippets no futuro, mas o dominio deve ser separado.

## Acao futura
Depois da base de diagnostico amadurecer, o mesmo arcabouco pode suportar `actions`:
- remediation playbooks
- coleta + correcao
- acoes operacionais aprovadas

Mas esse passo deve ser um dominio separado de `diagnostics`, com risco, policy e UX proprios.

## Backlog de evolucao de steps
Registrar como proxima evolucao estrutural do modulo:

1. backend aceitar `steps` como contrato interno do playbook
2. steps `command` continuarem sendo persistidos e executados como hoje
3. `script` entrar apenas por feature/policy, ainda bloqueado por padrao
4. UI administrativa deixar de ser apenas semantica e passar a salvar `stepType`
5. runner e auditoria passarem a registrar `DiagnosticRunStep`
6. `script_asset` entrar antes de qualquer suporte a script inline

## Modelo de dados inicial

### DiagnosticPlaybook
- id
- tenantId nullable para playbooks globais
- name
- description
- category
- targetOs
- riskLevel
- requiresApproval
- enabled
- version
- definitionJson
- createdById
- createdAt
- updatedAt

### DiagnosticRun
- id
- tenantId
- hostId
- playbookId
- requestedById
- approvedById nullable
- status
- startedAt
- finishedAt
- errorMessage
- aiSummaryStatus
- aiSummaryText
- aiFindingsJson

### DiagnosticRunCommand
- id
- runId
- commandId
- command
- status
- startedAt
- finishedAt
- exitCode
- outputPreview
- outputRef ou output cifrado/truncado

## UI recomendada

### No dashboard do host
Adicionar aba ou card:
- "Diagnosticos"
- playbooks recomendados
- ultimos diagnosticos
- botao "Executar diagnostico"
- resultado resumido
- link para detalhe

### Tela de detalhe do diagnostico
- host
- playbook
- usuario solicitante
- tempo de execucao
- comandos executados
- saida por comando
- resumo da IA
- evidencias
- proximos passos
- exportar resultado

### Tela administrativa
- catalogo de playbooks
- ativar/desativar
- editar descricao e politica
- permissao por grupo
- historico de versoes

## Analise por IA
A IA deve receber somente:
- outputs coletados e sanitizados
- metadados do host permitidos
- contexto do playbook
- objetivo informado pelo usuario

A IA nao deve receber:
- senhas
- PEM
- tokens
- secrets resolvidos
- conteudo integral de logs sem limite
- dados de hosts fora do escopo

## Resultado esperado da IA
Formato recomendado:
- resumo executivo
- evidencias encontradas
- hipoteses mais provaveis
- riscos
- proximas verificacoes seguras
- comandos sugeridos para etapa seguinte, sem executar automaticamente

## Rollout recomendado

### Fase 0 - Documentacao e riscos
- definir categorias
- definir comandos permitidos
- definir modelo de auditoria
- definir limites de output

### Fase 1 - Catalogo read-only
- cadastrar playbooks estaticos
- listar por host/categoria
- sem execucao automatica

### Fase 2 - Execucao manual confirmada
- executar playbook em host autorizado
- salvar resultado
- auditar comandos
- sem IA no caminho critico

### Fase 3 - Analise por IA pos-execucao
- job assincrono
- resumo e conclusoes
- exportacao

### Fase 4 - Sugestao por IA
- IA sugere playbook
- usuario aprova
- execucao continua governada pelo NodeAccess

### Fase 5 - MCP
- expor catalogo e resultados
- permitir solicitacao de diagnostico apenas com politica explicita

## MVP recomendado
Comecar pequeno:
- 4 playbooks Linux read-only:
  - rede basica
  - CPU/memoria/processos
  - disco/filesystem
  - MySQL basico
- execucao manual com confirmacao
- resultado salvo
- resumo IA assincrono opcional
- visivel no dashboard do host

## Escopo implementado no primeiro corte
- 4 playbooks Linux low-risk:
  - rede basica
  - CPU e memoria
  - disco e filesystem
  - MySQL basico
- listagem no dashboard do host
- solicitacao de execucao no dashboard do host
- historico recente por host
- detalhe da execucao com:
  - status
  - timestamps
  - comandos
  - exit code
  - saida por comando
  - redaction
  - truncamento
- resumo por IA com:
  - texto consolidado
  - risco
  - confianca
  - achados principais
  - proximos passos
- regeneracao do resumo por IA
- ajuda contextual em:
  - dashboard do host
  - detalhe da execucao

## Limitacoes atuais
- runner inicial suporta apenas hosts com rota `DIRECT`
- nao ha suporte inicial para `agent` ou `auto` no runner de diagnostico
- nao ha exportacao do resultado nesta fase
- nao ha catalogo administrativo de playbooks pela UI
- nao ha aprovacao multi-etapa para playbooks medium/high risk
- o resumo por IA depende da licenca e da integracao de IA ja habilitadas no tenant

## Proximo passo natural
- ampliar o runner para hosts via agent
- adicionar exportacao do resultado do diagnostico
- adicionar ordenacao e filtros mais ricos no historico
- criar visao administrativa do catalogo e das execucoes

## Fora do escopo inicial
- comandos corretivos
- reinicio de servico
- alteracao de configuracao
- execucao sem confirmacao
- comandos gerados livremente pela IA
- diagnostico multi-host automatico
- playbooks de alto risco

## Criterios de aceite do MVP
- usuario so executa diagnostico em host que pode acessar
- comandos sao exibidos antes da execucao
- playbook tem timeout e limite de output
- resultado fica auditado
- IA nao executa comando arbitrario
- usuario consegue ver conclusao e evidencias
- falha de diagnostico nao quebra terminal SSH normal

## Recomendacao
Faz sentido implementar, mas como modulo proprio de `Diagnostic Playbooks`, nao como simples snippets e nao como IA com liberdade de executar comandos.

MCP pode entrar como camada de exposicao depois. A base real deve estar no NodeAccess, com autorizacao, auditoria, execucao controlada e retencao de evidencias.
