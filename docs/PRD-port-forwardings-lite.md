# PRD Port Forwardings Lite

## Objetivo
Evoluir port forwardings para ficarem previsiveis, seguros e coerentes com a topologia real de conexao do host, incluindo hosts que dependem de agente.

## Contexto Atual
- Existem duas camadas:
  - configuracao persistida por host em `portForwardings`
  - tuneis ativos em memoria no backend
- A configuracao aparece em:
  - `apps/frontend/src/views/ForwardingsView.vue`
  - `apps/frontend/src/components/TunnelManager.vue`
- A execucao real do tunnel esta em:
  - `apps/backend/src/modules/tunnels/tunnel.service.ts`
- Auto-start acontece quando a sessao SSH do terminal conecta.

## Achados da Revisao
- O CRUD de configuracao existe e esta funcional para o caso basico.
- O tunnel ativo foi alinhado com `connectionMode` do host.
- O bind local foi endurecido para `127.0.0.1`.
- A permissao foi alinhada com a visibilidade real do host.
- Os tuneis ativos sao in-memory:
  - perdem estado em restart
  - nao sobrevivem a redistribuicao horizontal
- A UI separa bem configuracao e tuneis ativos, mas ainda nao mostra claramente:
  - motivo detalhado da falha
  - limite operacional de rodar no backend

## Problemas Prioritarios
1. Inconsistencia topologica
- Host configurado para `Via agente` pode ter terminal funcionando via agente, mas forwarding falhando porque o tunnel tenta conectar direto.

2. Seguranca do bind local
- `0.0.0.0` como padrao e forte demais para a maioria dos cenarios.
- O default deveria ser `127.0.0.1`, com override explicito apenas se necessario.

3. Permissao incompleta
- O forwarding deveria respeitar o mesmo acesso do host:
  - `personal`
  - `team`
  - `global`

4. Observabilidade curta
- Falta mostrar com clareza:
  - se o tunnel foi aberto direto ou via agente
  - qual etapa falhou
  - conflito de porta local vs erro remoto

5. Conflito de porta entre usuarios
- O tunnel atual abre `localPort` no servidor NodeAccess.
- Se dois usuarios tentarem usar a mesma `localPort` no mesmo servidor, pode haver conflito de bind.
- O problema nao depende do host remoto ser igual; depende da porta local escolhida no backend.
- Em ambiente multiusuario, confiar sempre numa porta fixa configurada pelo usuario tende a gerar atrito operacional.
- Faz sentido separar:
  - `porta preferida/configurada`
  - `porta efetiva/alocada no runtime`

6. Link de acesso via navegador depende da topologia
- Faz sentido oferecer link para servicos HTTP/HTTPS expostos por forwarding.
- Mas, no desenho atual, o tunnel nasce no backend NodeAccess.
- Isso significa que `127.0.0.1:porta` aponta para o servidor NodeAccess, nao para o navegador do usuario final.
- Antes de oferecer `Abrir no navegador`, o produto precisa decidir:
  - proxy web no proprio NodeAccess
  - tunnel local no cliente/agente do usuario
  - ou exposicao controlada por rota publica autenticada

## Escopo Inicial Recomendado
1. Alinhar tunnel com `connectionMode`
2. Endurecer seguranca do bind local
3. Reaplicar permissao real do host
4. Melhorar mensagens e diagnostico

## Fase 1
- Fazer `TunnelService` respeitar:
  - `direct`
  - `agent`
- Impedir fallback silencioso
- Falhar com mensagem clara quando host exigir agente e nao houver agente online
- Ajustar auto-start para usar o mesmo caminho real da conexao
- Status: concluido

## Fase 2
- Trocar bind default para `127.0.0.1`
- Opcionalmente adicionar `bindAddress` explicito por forwarding no futuro
- Melhorar mensagens de erro:
  - porta local em uso
  - host remoto inacessivel
  - agente indisponivel
  - falha de autenticacao SSH
- Status: bind seguro e mensagem de porta em uso concluidos; `bindAddress` explicito concluido com default seguro e opcao avancada controlada

## Fase 3
- Reaplicar guardas de visibilidade do host nos endpoints de forwarding e tunnel
- Exibir metodo real usado:
  - direto
  - via agente
- Exibir estado mais claro na UI
- Status: guardas de visibilidade concluidas; badge de metodo real nos tuneis ativos concluido; classificacao visual inicial de erros concluida; diagnostico adicional segue pendente

## Fase 4
- Tratar conflito de `localPort` entre usuarios com mensagem amigavel
- Avaliar estrategia de acesso web para tuneis HTTP/HTTPS
- So adicionar `Abrir no navegador` quando o caminho real estiver definido e seguro

## Fase 5
- Introduzir alocacao automatica de porta local no runtime para cenarios multiusuario
- Manter `localPort` como `porta preferida` quando fizer sentido
- Permitir modo `automatica` para evitar conflito por padrao
- Exibir na UI:
  - porta configurada
  - porta ativa no backend
  - motivo de fallback quando a porta preferida nao puder ser usada
- Prioridade sugerida de alocacao:
  - tentar `porta preferida` se estiver livre
  - se ocupada, alocar porta alta livre em faixa segura do backend
  - devolver ao frontend a `porta efetiva`
- Em links web, usar sempre a porta efetiva ou abstrair isso no proxy web
- Status inicial:
  - tuneis ativos agora expõem `requestedLocalPort` e `assignedLocalPort`
  - fallback de porta no runtime ficou explícito na UI de tuneis ativos
  - a porta ativa passa a ser a referência operacional do tunnel

## Proposta de Produto para Conflito de Porta
- `localPort` deixa de ser obrigatoriamente a porta final de bind no backend
- O produto passa a tratar:
  - `localPort`: preferencia do usuario/template
  - `assignedLocalPort`: porta realmente aberta no runtime
- Modos recomendados:
  - `prefer-fixed`: tenta a porta configurada; se falhar, retorna erro claro
  - `prefer-fixed-with-fallback`: tenta a porta configurada; se ocupada, aloca outra e avisa
  - `auto`: sempre aloca porta livre automaticamente
- Recomendacao para adocao:
  - `auto` como opcao mais segura para ambiente compartilhado
  - `prefer-fixed-with-fallback` como melhor equilibrio para maioria dos usuarios
- Regra de UX:
  - usuario precisa ver com clareza `localhost:porta-ativa`
  - copiar endpoint deve sempre usar a porta ativa
  - badges ou hint devem deixar claro quando houve fallback

## Regra para Link de Acesso
- O link gerado pelo NodeAccess nunca deve depender da `localPort` configurada como se ela fosse garantida.
- O link deve sempre apontar para a `assignedLocalPort` ativa naquele runtime.
- A porta remota do servidor de destino nao muda; o ajuste acontece apenas na porta local alocada no NodeAccess.
- Se houver fallback de porta:
  - o link novo deve nascer com a porta efetiva correta
  - a UI deve informar que houve alocacao automatica
  - copiar endpoint e abrir no navegador devem usar a porta efetiva
- Em resumo:
  - `remotePort` continua fixa no host remoto
  - `localPort` vira preferencia
  - `assignedLocalPort` vira a referencia real para uso e para links

## Regras de Produto
- A UI nunca deve assumir que a porta configurada e a porta ativa sao iguais.
- O endpoint copiado pelo usuario deve usar a porta ativa.
- Fallback automatico de porta deve ser explicito na UI, nunca silencioso.
- A faixa de portas automaticas deve ser segura e reservada para o NodeAccess quando possivel.
- O conflito de porta deve deixar de ser fatal nos modos `auto` e `prefer-fixed-with-fallback`.

## Compatibilidade e Corte Seguro
- Fluxos atuais podem continuar funcionando com `prefer-fixed` como comportamento legado.
- O primeiro corte pode evitar quebrar templates existentes assim:
  - templates atuais continuam com porta fixa
  - novos templates podem escolher `auto`
  - tuneis iniciados a partir da tela principal podem adotar fallback explicito
- O backend pode implementar isso sem acoplar na regra de host:
  - alocador de portas isolado
  - retorno enriquecido no tunnel ativo
  - UI consumindo `assignedLocalPort`
  - web/link service consumindo `assignedLocalPort`

## Backlog Tecnico Sugerido
1. Backend
- criar alocador isolado de portas livres no modulo de tunnels
- expandir `ActiveTunnel` para incluir `requestedLocalPort` e `assignedLocalPort`
- manter `assignedLocalPort === requestedLocalPort` quando a preferida estiver livre
- quando houver conflito e o modo permitir fallback, alocar porta livre e devolver esse valor

2. Web access / links
- ajustar o gerador de link para usar sempre `assignedLocalPort`
- impedir geracao de link baseada apenas no template persistido
- garantir que o link reflita o tunnel ativo do usuario e daquele runtime
- status inicial:
  - o gerador de link agora reserva/reaproveita tunnel com `assignedLocalPort`
  - a UI informa a porta ativa usada no web access
  - quando houver fallback, o usuario recebe esse contexto de forma explicita

3. Frontend
- exibir:
  - porta configurada
  - porta ativa
  - indicador de fallback
- atualizar botao de copiar endpoint para usar `assignedLocalPort`
- atualizar `Abrir web` para depender da porta efetiva
- status inicial:
  - UI de tuneis ativos ja mostra a porta ativa
  - copiar endpoint agora usa `assignedLocalPort`
  - `Abrir web` ja informa a porta ativa usada
  - area do terminal agora exibe feedback curto quando houver port forward ativo e funcional

4. Compatibilidade
- manter templates antigos validos
- tratar ausencia de `assignedLocalPort` como `localPort` apenas durante transicao

## Arquivos Provaveis
- backend:
  - `apps/backend/src/modules/tunnels/tunnel.service.ts`
  - `apps/backend/src/modules/tunnels/tunnel.controller.ts`
  - `apps/backend/src/modules/port-forwardings/port-forwarding.service.ts`
  - `apps/backend/src/modules/port-forwardings/port-forwarding.controller.ts`
  - `apps/backend/src/modules/ssh/ssh.repository.ts`
  - `apps/backend/src/modules/agents/agent.registry.ts`
- frontend:
  - `apps/frontend/src/components/TunnelManager.vue`
  - `apps/frontend/src/views/ForwardingsView.vue`
  - `apps/frontend/src/services/tunnel.service.ts`
  - `apps/frontend/src/services/portForwarding.service.ts`

## Fora de Escopo Inicial
- Persistencia distribuida de tuneis ativos
- Fleet/cluster coordination
- UDP forwarding
- SOCKS proxy geral

## Proximo Corte Recomendado
- melhorar diagnostico visual e mensagens operacionais
- decidir a estrategia de acesso web para servicos HTTP/HTTPS
- desenhar `porta preferida` vs `porta efetiva` para reduzir conflito multiusuario
