# NA-0061 — Fail2ban para gateway SSH da instalação legada

## Objetivo

Validar falhas de autenticação registradas no banco da instalação legada e bloquear suas origens sem afetar os sites compartilhados no Nginx.

## Escopo

- Inspecionar eventos de auditoria e o caminho de entrada.
- Exportar somente falhas do `native-ssh-gateway` para um log dedicado.
- Aplicar Fail2ban na cadeia Docker `DOCKER-USER`, exclusivamente TCP 2222: 5 eventos em 600 segundos, bloqueio de 604800 segundos (7 dias, conforme ajuste solicitado posteriormente).
- Validar filtro, bloqueio/desbloqueio real e disponibilidade dos sites.
- Preservar configuração de Nginx, autenticação, banco e SSH administrativo.

## Entrega

Configuração operacional remota, backup e registro de implementação. Sem release, commit ou publicação de código do produto.
