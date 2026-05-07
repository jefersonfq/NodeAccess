# Decision - Diagnostic Playbooks v1

## Decisao
O recurso de diagnostico assistido por IA do NodeAccess sera implementado primeiro como modulo interno de `Diagnostic Playbooks`, sem dependencia inicial de MCP.

## Motivo
- MCP nao resolve governanca de execucao por si so
- precisamos de auditoria, timeout, mascaramento e persistencia antes de expor a capacidade externamente
- o valor principal esta na base interna bem governada
- MCP pode vir depois como camada de exposicao

## Atualizacao de direcao
Mantemos a decisao de fundacao interna, mas a arquitetura deve nascer preparada para:
- steps do tipo `command` e `script`
- multiplos canais de consumo, incluindo MCP
- providers de IA diferentes
- modo assistido e modo autonomo controlado

## Regras v1
- sem comando arbitrario gerado por IA
- sem execucao sem confirmacao humana
- sem usar snippets como dominio principal
- runner isolado, nao sessao interativa do usuario
- playbooks low-risk primeiro
- IA apenas pos-execucao e assincrona

## Regras de evolucao
- scripts aprovados sao permitidos quando agregarem composicao real
- IA externa ou interna pode consumir tools do modulo, mas sempre via policy gate
- autonomia e configuravel, nunca implicita
- diagnostico e acao corretiva devem permanecer dominios separados
- a evolucao para `steps` deve preservar compatibilidade com o backend atual antes de ativar `script`

## Playbooks iniciais
- rede basica Linux
- CPU/memoria/processos Linux
- disco/filesystem Linux
- MySQL basico Linux

## Evolucao futura
- Agent runner
- permissoes granulares
- sugestao de playbook por IA
- exposicao via MCP
- suporte a `steps` com `script`
- canais de IA com tool use
- autonomia controlada por tenant/host/grupo
