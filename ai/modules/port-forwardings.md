# Port Forwardings

Indice curto para revisar e evoluir port forwardings no NodeAccess.

## Ler primeiro
1. `ai/context.md`
2. `ai/patterns.md`
3. `docs/PRD-port-forwardings-lite.md`

## Pontos principais
- Existe diferenca entre:
  - configuracao salva por host
  - tunnel ativo em memoria
- Auto-start depende da sessao SSH do terminal.
- Hoje o tunnel ativo conecta direto do backend.
- Hosts com `connectionMode=agent` precisam ser alinhados com a mesma politica.

## Arquivos-chave
- `apps/backend/src/modules/tunnels/tunnel.service.ts`
- `apps/backend/src/modules/port-forwardings/port-forwarding.service.ts`
- `apps/frontend/src/components/TunnelManager.vue`
- `apps/frontend/src/views/ForwardingsView.vue`

## Riscos conhecidos
- bind local em `0.0.0.0`
- permissao por tenant sem reaplicar toda a visibilidade do host
- sem suporte coerente a `Via agente`
- conflito de `localPort` entre usuarios no mesmo backend
- `Abrir no navegador` ainda nao e trivial porque o tunnel nasce no backend

## Proximo corte sugerido
- corrigir topologia real do tunnel
- endurecer bind local
- melhorar mensagens e diagnostico
