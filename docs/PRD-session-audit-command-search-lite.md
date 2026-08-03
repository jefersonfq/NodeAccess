# PRD Lite - Pesquisa de comandos em auditoria SSH

## Contexto
Hoje a auditoria de sessao SSH persiste metadados em `session_audits`, referencias de chunks em `session_audit_chunks` e o stream bruto nos arquivos de chunk. Os comandos reconstruidos nao sao persistidos como linhas pesquisaveis no banco.

O campo `session_audits.command_count` ja existe e possui indice por tenant, quantidade de comandos e data. Portanto, filtrar sessoes com quantidade minima de comandos e uma operacao barata e adequada para a tela principal de auditoria.

## Decisao atual
Implementar primeiro apenas o filtro por quantidade minima de comandos:

- parametro de API: `minCommandCount`;
- condicao: `sa.command_count >= minCommandCount`;
- usar apenas valores inteiros positivos;
- nao recalcular comandos em tempo de listagem;
- manter a paginacao atual.

## Backlog registrado

- Definir um default por tenant para o filtro de quantidade minima de comandos, sem bloquear o filtro manual da tela.

## Pesquisa por comando especifico
Buscar comando especifico abrindo arquivos de chunk em tempo de request nao e recomendado para a listagem principal. Esse caminho pode degradar conforme crescerem sessoes, chunks e retencao.

Opcoes saudaveis para etapa posterior:

1. Criar indice materializado `session_audit_commands` para sessoes novas e backfill gradual.
2. Criar job assincrono de busca forense em chunks antigos, com limite de periodo, tenant, usuario opcional, timeout e progresso.
3. Usar metadados/caminho dos chunks para reduzir escopo por tenant, usuario, sessao e data, mantendo o chunk como fonte auditavel completa.

## Recomendacao
Para uso frequente na tela de Auditoria, preferir indice em banco. Para buscas eventuais em historico antigo, usar job assincrono de varredura de chunks e opcionalmente popular o indice.
