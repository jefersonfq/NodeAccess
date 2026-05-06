# PRD Forwarding UX Lite

## Objetivo
Reduzir duvidas operacionais sobre port forwardings mostrando claramente a qual host estao vinculados e dando mais contexto quando houver conflito de porta.

## Problema Atual
- O usuario ve o forwarding, mas nem sempre entende rapidamente em qual host ele esta configurado.
- Ao editar um host, nao fica evidente que ele ja possui forwardings salvos.
- Em conflito de porta, a mensagem atual ainda pode ser insuficiente para identificar o forwarding responsavel.

## Direcionamento
- Forwarding continua vinculado explicitamente a um host.
- Nao transformar forwarding em recurso global reutilizavel nesta fase.
- Melhorar contexto e navegacao antes de discutir reuso entre hosts.

## Escopo Inicial
1. Mostrar quantidade de forwardings por host na tela de hosts
2. Mostrar resumo dos forwardings no modal de edicao do host
3. Enriquecer mensagem de conflito de porta com nome do host e, quando houver, descricao do forwarding ativo
4. Reforcar na listagem de forwardings o contexto do host e modo de conexao

## Regras de UX
- O usuario deve responder rapidamente:
  - este forwarding pertence a qual host?
  - este host ja tem quantos forwardings?
  - qual host esta usando a porta que conflitou?
- O contexto deve aparecer sem exigir abrir o terminal.

## Fora de Escopo Inicial
- Reuso global de forwarding entre hosts
- Duplicacao guiada para outro host
- Resolucao automatica de conflito de porta

## Proximo Corte Recomendado
- adicionar acao `Ir para host` na listagem de forwardings
- permitir `Duplicar para outro host`
