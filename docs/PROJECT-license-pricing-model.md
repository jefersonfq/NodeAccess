# Modelo De Precificacao Por Licenca E Entitlements

## Objetivo

Criar uma base simples para estimar cobranca do NodeAccess usando os campos que ja existem em Configuracoes > Licenca e Entitlements.

Arquivo editavel:

- `docs/PROJECT-license-pricing-calculator.csv`

Esse CSV pode ser aberto no Excel, LibreOffice ou Google Sheets. Ajuste:

- `Licenciado? (1/0)`
- `Quantidade`
- `Preco unitario mensal`
- descontos
- setup
- suporte premium

## Campos Do Produto Que Viram Cobranca

Base atual identificada no codigo:

- `license.activeUsers`
- `license.maxUsers`
- `license.registeredHosts`
- `license.maxHosts`
- `license.multiConnect`
- `license.sessionAuditEnabled`
- `license.sessionAuditAiEnabled`
- `license.sessionAuditAiProvider`
- `license.sessionAuditAiAutoSummaryEnabled`
- `featureEntitlements.agents`
- `featureEntitlements.secrets`
- `featureEntitlements.snippets`
- `featureEntitlements.portForwarding`
- `featureEntitlements.integrations`
- `featureEntitlements.feedback`
- `featureEntitlements.localAi`
- `featureEntitlements.mcp`
- `featureEntitlements.aiSshActions`
- `featureEntitlements.sessionAuditAiAutoSummary`
- `integrationEntitlements.jira`
- `integrationEntitlements.google`
- `integrationEntitlements.onepassword`

## Sugestao Comercial Inicial

Minha recomendacao e vender com uma base por usuario e add-ons por modulo.

### Plano Base

Cobrar por usuario ativo/licenciado.

Referencia inicial:

- R$ 29 a R$ 49 por usuario/mes

Inclui:

- acesso SSH via navegador
- cadastro de hosts dentro da franquia
- organizacao basica
- controle de usuarios
- logs administrativos basicos

Para comecar competitivo:

- SMB/self-hosted: R$ 29 por usuario/mes
- operacional profissional: R$ 39 por usuario/mes
- enterprise/compliance: R$ 49+ por usuario/mes

## Add-ons Recomendados

Valores iniciais para simulacao:

| Modulo | Sugestao |
|---|---:|
| Multi-connect | R$ 4 por usuario/mes |
| Auditoria de sessao SSH | R$ 8 por usuario/mes |
| Playback de sessao | R$ 5 por usuario/mes |
| IA da auditoria SSH | R$ 12 por usuario/mes |
| Resumo automatico pos-sessao | R$ 5 por usuario/mes |
| Snippets | R$ 4 por usuario/mes |
| Secrets | R$ 6 por usuario/mes |
| Tuneis SSH / Port forwarding | R$ 7 por usuario/mes |
| Assistente local | R$ 10 por usuario/mes |
| MCP | R$ 8 por usuario/mes |
| Acoes SSH por IA | R$ 15 por usuario/mes |
| Agentes | R$ 9 por agente/mes |

## Integracoes

Recomendo cobrar integracoes em duas camadas:

1. Base de integracoes do tenant
2. Providers liberados

Sugestao:

| Item | Sugestao |
|---|---:|
| Base de integracoes | R$ 99 por tenant/mes |
| Jira | R$ 49 por tenant/mes |
| Google | R$ 49 por tenant/mes |
| 1Password | R$ 79 por tenant/mes |

Motivo:

- integracao tem valor organizacional, mas nao escala necessariamente por usuario
- 1Password tende a ter maior valor percebido porque envolve segredo, seguranca e fluxo operacional
- separar provider ajuda vender pacotes simples sem bloquear expansao futura

## Hosts

Eu nao comecaria cobrando host por host desde o primeiro plano, porque isso pode criar friccao comercial.

Modelo recomendado:

- incluir uma franquia por plano
- cobrar excedente apenas acima da franquia

Exemplo:

| Plano | Hosts incluidos | Excedente |
|---|---:|---:|
| Starter | 50 | R$ 2 por host/mes |
| Pro | 200 | R$ 1 por host/mes |
| Enterprise | negociado | negociado |

## Planos Sugeridos

### Starter

Para times pequenos.

- R$ 29 por usuario/mes
- ate 50 hosts
- SSH browser
- usuarios/grupos
- snippets opcional
- sem auditoria avancada por padrao

### Pro

Plano principal.

- R$ 49 a R$ 69 por usuario/mes
- ate 200 hosts
- multi-connect
- snippets
- port forwarding
- auditoria de sessao
- integracoes como add-on

### Enterprise / Security

Para clientes com compliance e automacao.

- R$ 89 a R$ 149 por usuario/mes
- hosts negociados
- auditoria
- playback
- IA da auditoria
- secrets
- MCP
- acoes SSH por IA
- suporte premium
- politicas e governanca

## Formula Comercial Simples

```txt
MRR =
  usuarios_ativos * preco_base_usuario
  + soma(addons_por_usuario * usuarios_ativos)
  + soma(addons_por_tenant)
  + soma(providers_licenciados)
  + hosts_excedentes * preco_host_excedente
  + agentes * preco_agente
  - desconto
```

Na planilha:

```txt
Subtotal mensal = Licenciado * Quantidade * Preco unitario mensal
Total mensal recorrente = soma dos subtotais + suporte premium - desconto
Total anual recorrente = Total mensal recorrente * 12
Total primeiro ano = Total anual recorrente + setup
```

## Recomendacao Para O NodeAccess

Para vender melhor, eu usaria:

- preco base por usuario
- modulos de seguranca como add-on premium
- IA/MCP/acoes SSH por IA como add-ons de alto valor
- integracoes por tenant/provider
- hosts como franquia por plano, nao como cobranca principal

Isso evita que o produto pareca caro por inventario grande e concentra o preco onde ha mais valor percebido:

- seguranca
- auditoria
- automacao
- reducao de trabalho operacional
- governanca de acesso

## Observacao

Os valores acima sao referencias iniciais para simulacao comercial. O ideal e validar com:

- custo de suporte por cliente
- custo de infraestrutura
- tamanho medio dos clientes
- valor percebido por auditoria/compliance
- comparacao com alternativas de mercado
- disposicao de pagamento dos primeiros clientes
