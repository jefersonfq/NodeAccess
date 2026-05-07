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
- ainda sujeita a policy, rate limit, auditoria e kill switch
- nunca deve ficar habilitado por padrao

## Canais de consumo
A mesma camada interna deve atender:
- assistente local do NodeAccess
- provider online integrado
- cliente MCP
- fluxos internos futuros de automacao

Canal nao pode alterar a regra de negocio.

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
- quais tools, playbooks, steps ou comandos sao permitidos
- se exige aprovacao
- limite de duracao e de volume

## Regras obrigatorias
- autonomia nunca implicita
- shell arbitrario nunca como primeiro passo
- toda execucao precisa de identidade e origem
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
- bloqueio de segredos resolvidos
- bloqueio de comandos proibidos
- aprovacao com expiracao

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

### Fase 2
- `approval_required`
- IA propoe acao ou comando
- NodeAccess apresenta diff operacional e exige confirmacao
- comandos classificados como `approval_required` nao executam em `read_only` ou `diagnostic_only`
- comandos classificados como `blocked` nao executam nem com aprovacao
- primeiro corte de configuracao permite override por ambiente para classificar comandos como `safe`, `approval_required` ou `blocked`
- evolucao posterior deve persistir policy por tenant, host e grupo

### Fase 3
- `full_operational_access`
- apenas para tenants e hosts explicitamente liberados
- com token/sessao tecnica dedicados

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

## Criterios de aceite da preparacao
- desenho desacoplado do provider
- sessao tecnica definida
- modos de acesso definidos
- guardrails minimos definidos
- relacao com MCP e diagnosticos documentada
- rollout por fases registrado
