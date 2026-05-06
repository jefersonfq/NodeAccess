# Decision - Acesso SSH Operacional por IA v1

## Decisao
O NodeAccess pode evoluir para permitir acesso SSH operacional por IA, inclusive com modo amplo, mas isso sera construido sobre uma camada interna governada de sessao tecnica e policy, e nao como shell livre exposto diretamente ao provider ou ao MCP.

## Motivo
- reduz acoplamento a provider
- preserva a arquitetura existente
- permite auditoria e kill switch
- evita que MCP ou integracao externa virem atalho inseguro para execucao

## Regras v1
- `read_only`, `diagnostic_only`, `approval_required` e `full_operational_access`
- `full_operational_access` desligado por padrao
- sessao tecnica separada da sessao interativa do usuario
- diagnostico e acao permanecem dominios distintos
- aprovacao expira
- toda execucao gera trilha auditavel

## Fora de escopo da v1
- shell arbitrario aberto por padrao
- execucao destrutiva sem aprovacao
- bypass da camada de policy por MCP ou provider
