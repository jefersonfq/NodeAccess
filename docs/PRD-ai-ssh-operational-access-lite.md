# PRD Lite - Acesso SSH Operacional por IA

## Objetivo
Preparar o NodeAccess para permitir que IAs locais, integradas por provider externo ou conectadas via MCP consigam operar em hosts via SSH de forma controlada, auditavel e reversivel.

O objetivo nao e apenas diagnostico. A frente deve permitir, quando liberado por politica:
- conectar no host
- executar diagnosticos
- rodar comandos
- propor acoes
- executar acoes
- revalidar estado

## Principio central
Nao entregar shell livre para a IA como primeira interface.

A fundacao correta e:
- sessao tecnica governada
- modos de acesso explicitos
- policy por tenant, host, grupo e ferramenta
- aprovacao quando exigida
- trilha de auditoria completa
- kill switch

## Modos de acesso

### `read_only`
- leitura de contexto
- dashboard
- auditoria
- sessoes
- diagnosticos anteriores
- snippets e playbooks visiveis

### `diagnostic_only`
- executar apenas playbooks e tools de diagnostico aprovados
- sem acao corretiva
- sem shell arbitrario

### `approval_required`
- IA pode propor comandos ou acoes
- NodeAccess mostra plano e impacto
- usuario/admin aprova antes da execucao
- usuarios com acesso ao host podem solicitar, mas a execucao permanece bloqueada ate aprovacao administrativa
- comandos de risco operacional controlado podem entrar nesse modo, como restart de servico, alteracao de firewall, instalacao/remocao de pacote, `chmod`, `chown`, `mount` e escrita em `/etc`
- comandos destrutivos continuam bloqueados em qualquer modo

### `full_operational_access`
- IA pode operar com mais liberdade dentro do escopo liberado
- pode conectar no host e executar o que foi solicitado quando a politica permitir
- pode atuar como modo limitado ou modo livre governado, conforme configuracao do tenant, host, grupo, usuario e canal
- ainda sujeita a policy, rate limit, auditoria, limites de escopo e kill switch
- nao significa bypass de seguranca, permissao de usuario, host visibility, policy de comandos ou auditoria
- nunca deve ficar habilitado por padrao

#### Perfis internos do modo `full_operational_access`

O modo full deve ser configuravel em perfis para evitar uma decisao binaria entre "bloqueado" e "livre".

##### `full_limited`
- IA pode executar comandos fora do catalogo de diagnostico, mas ainda dentro de uma allowlist/policy mais ampla
- comandos classificados como `safe` executam diretamente
- comandos classificados como `approval_required` exigem aprovacao
- comandos classificados como `blocked` nunca executam
- recomendado para primeiros tenants piloto

##### `full_governed_free`
- IA pode executar comandos livres solicitados pelo usuario, desde que a policy nao bloqueie
- continua exigindo:
  - tenant explicitamente habilitado
  - host/grupo explicitamente habilitado ou policy global equivalente
  - usuario solicitante com acesso ao host
  - canal autorizado (`local_ai`, provider de rede, MCP ou integracao)
  - auditoria completa antes, durante e depois
  - cancelamento/kill switch
- comandos destrutivos ou sensiveis podem ser permitidos apenas se a policy do tenant classificar explicitamente como permitido ou aprovavel
- recomendado apenas depois de maturidade operacional, testes e logs confiaveis

## Canais de consumo
A mesma camada interna deve atender:
- assistente local do NodeAccess
- provider online/internet integrado, como OpenAI, Claude/Anthropic, Gemini/Google ou API compativel com OpenAI
- cliente MCP
- fluxos internos futuros de automacao

Canal nao pode alterar a regra de negocio.

## Providers de IA
A interpretacao da intencao pode ser feita por IA local ou por provider de internet.

Providers previstos:
- Ollama/local models
- OpenAI
- Claude/Anthropic
- Gemini/Google
- providers compativeis com API OpenAI
- adapters futuros

Regras:
- provider apenas interpreta, resume ou sugere plano
- provider nao executa SSH diretamente
- execucao SSH ocorre no backend do NodeAccess via `ai-ssh-actions`
- todo provider deve respeitar tenant, usuario, host visibility, canal, modo, policy e auditoria
- dados sensiveis, segredos e credenciais nao devem ser enviados ao provider como contexto livre

## Arquitetura recomendada

### 1. Action layer interna
Criar um modulo interno separado de diagnosticos:

```txt
apps/backend/src/modules/ai-ssh-actions
```

Camadas sugeridas:

```txt
ai-ssh-action.service.ts
ai-ssh-action.policy.ts
ai-ssh-action.runner.ts
ai-ssh-action.repository.ts
ai-ssh-action.audit.ts
ai-ssh-action.schemas.ts
```

### 2. Sessao tecnica
Toda execucao por IA deve ocorrer em sessao tecnica identificavel, separada da sessao interativa comum do usuario.

A sessao tecnica deve registrar:
- tenant
- usuario solicitante
- aprovador, quando houver
- provider/canal
- modo de acesso
- host
- tempo de vida
- comandos executados
- saida sanitizada
- status final

### 3. Politica
A policy deve decidir:
- se a IA pode agir naquele tenant
- quais hosts podem ser operados
- quais grupos podem ser operados
- quais usuarios podem solicitar, aprovar ou executar
- quais canais podem agir (`local_ai`, provider de rede, MCP, integracao, interno)
- qual perfil full esta habilitado: nenhum, `full_limited` ou `full_governed_free`
- quais tools, playbooks, steps ou comandos sao permitidos
- se exige aprovacao
- limite de duracao e de volume
- limite de comandos por run
- limite de execucoes por janela
- limite de fan-out por host/grupo
- se comandos interativos ou shell persistente sao permitidos

### 4. Assistant action intent
O assistente nao deve executar texto livre diretamente.

Antes de criar um `ActionRun`, a intencao do usuario deve virar um plano estruturado:

```txt
intent -> target host/group -> mode -> steps -> policy evaluation -> preview -> action run
```

O plano deve conter:
- host ou grupo alvo
- motivo operacional
- modo solicitado
- perfil full solicitado, quando aplicavel
- comandos/steps propostos
- timeout por step
- avaliacao de risco por comando
- necessidade de aprovacao
- resumo para auditoria

No primeiro corte, o `/assistant` deve criar preview e `ActionRun`; a execucao continua pertencendo ao modulo `ai-ssh-actions`.

## Regras obrigatorias
- autonomia nunca implicita
- shell arbitrario nunca como primeiro passo
- modo full nunca significa permissao irrestrita fora da policy
- toda execucao precisa de identidade e origem
- toda execucao deve registrar quem solicitou, quando solicitou, canal, modo, host, comandos, saida sanitizada e resultado
- quando houver aprovacao, registrar quem aprovou, quando aprovou e justificativa
- toda saida precisa passar por redaction
- execucao deve ser cancelavel
- acao corretiva deve ficar separada de diagnostico
- preferir `propor e confirmar` antes de `executar direto`

## Guardrails minimos
- allowlist por capability
- allowlist por host/grupo
- timeout por comando e por run
- rate limit por janela
- limite de fan-out
- kill switch por tenant
- kill switch por sessao
- kill switch por run
- bloqueio por canal
- bloqueio de segredos resolvidos
- bloqueio de comandos proibidos
- aprovacao com expiracao
- dry-run/preview obrigatorio para intencoes vindas do assistente
- registro de policy snapshot usada na decisao

## Dominios

### Diagnostico
- seguro
- reprodutivel
- baixo risco
- orientado a coleta e leitura

### Acao
- corretiva
- potencialmente destrutiva
- exige controle mais forte
- precisa registrar antes/depois e rollback quando aplicavel

## Ordem recomendada de evolucao

### Fase 1
- manter `read_only` e `diagnostic_only`
- expandir runner de diagnostico
- consolidar policy e auditoria
- criar preview de intencao operacional no `/assistant`
- permitir que o assistente sugira plano, mas sem executar diretamente

### Fase 2
- `approval_required`
- IA propoe acao ou comando
- NodeAccess apresenta diff operacional e exige confirmacao
- `/assistant` cria `ActionRun` com `channel: local_ai`
- usuario acompanha status e resultado do run pela tela do assistente e pelo detalhe do run
- comandos classificados como `approval_required` nao executam em `read_only` ou `diagnostic_only`
- comandos classificados como `blocked` nao executam nem com aprovacao
- primeiro corte de configuracao permite override por ambiente para classificar comandos como `safe`, `approval_required` ou `blocked`
- evolucao posterior deve persistir policy por tenant, host e grupo

### Fase 3
- `full_operational_access`
- apenas para tenants e hosts explicitamente liberados
- com token/sessao tecnica dedicados
- iniciar com perfil `full_limited`
- permitir execucao direta apenas para comandos classificados como `safe`
- manter aprovacao para comandos classificados como `approval_required`

### Fase 4
- `full_governed_free`
- IA local ou provider de IA pode conectar no host e executar solicitacoes livres dentro da policy
- liberar somente por tenant/canal/host/grupo/usuario
- exigir auditoria forte, kill switch e limites operacionais
- avaliar necessidade de aprovacao adicional para comandos mutaveis, destrutivos ou de alto impacto

## Relacao com MCP
MCP e um canal valido para chegar nessa capacidade, mas nao deve ser a fundacao dela.

Sequencia correta:
- camada interna governada
- depois exposicao via MCP
- depois automacao mais ampla

## Relacao com diagnosticos
Diagnosticos continuam sendo a base segura e governada para entrada operacional.

Recomendacao:
- diagnostico e acao compartilham a mesma policy
- mas persistem em dominios separados
- `DiagnosticRun` nao deve virar `ActionRun` por acoplamento informal

## Relacao com `/assistant`
O `/assistant` deve ser tratado como um canal de orquestracao, nao como executor direto.

Fluxo recomendado:
1. usuario descreve a necessidade em linguagem natural
2. IA identifica host, contexto e objetivo
3. IA gera plano estruturado
4. backend avalia policy e riscos
5. frontend mostra preview claro
6. usuario confirma ou admin aprova, conforme modo
7. backend cria `ActionRun`
8. runner tecnico executa em sessao isolada
9. resultado volta ao `/assistant` com link para auditoria/detalhe

O assistente pode usar IA local ou provider de IA em rede para interpretar a intencao, mas a execucao SSH deve continuar centralizada no backend do NodeAccess.

## Criterios de aceite da preparacao
- desenho desacoplado do provider
- sessao tecnica definida
- modos de acesso definidos
- guardrails minimos definidos
- relacao com MCP e diagnosticos documentada
- rollout por fases registrado
