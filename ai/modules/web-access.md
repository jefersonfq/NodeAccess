# Web Access

Indice curto para acesso HTTP/HTTPS via NodeAccess sem expor forwarding bruto diretamente.

## Ler Antes
1. `ai/context.md`
2. `ai/patterns.md`
3. `docs/PRD-port-forwardings-lite.md`
4. `docs/PRD-web-access-lite.md`

## Ideia Central
- forwarding bruto e uma coisa
- acesso web e outra
- o caminho recomendado e proxy autenticado dentro do NodeAccess

## Regras Curtas
- bind seguro continua sendo o padrao
- sem `0.0.0.0` como estrategia principal de acesso web
- respeitar `direct` e `agent`
- respeitar visibilidade do host e ownership do forwarding
- manter auditoria do caminho real usado

## Foco Inicial
- HTTP/HTTPS
- UX clara de `Abrir no navegador`
- seguranca e auditoria
- evitar confundir tunnel tecnico com link web
