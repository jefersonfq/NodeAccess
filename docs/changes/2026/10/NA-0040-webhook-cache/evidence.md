# Evidências NA-0040

Estado: LOCAL_VALIDATED; sem push, merge ou deploy.

- Node 20.20.2, instalação independente, Prisma gerado; typecheck backend/frontend aprovado.
- Testes focados: 58/58; suíte geral: {'passed': 1832, 'skipped': 34}.
- Navegador Chromium: cache-settings aprovado, TTL persistido, propagação entre abas, recuperação de indisponibilidade e viewport 390px.
- SSRF: bloqueio IPv4/IPv6 mapeado, DNS misto e rebinding; fetch real usa resolver validado e recusa loopback antes de abrir socket. Sem redirect; limite de 512 bytes na resposta de entregas e testes.
- Undici 7.29.1 passa a dependência direta para configurar o resolver do socket, preservando hostname HTTP/TLS.
- Cache: geração/identidade impede refresh/update/getCached de reapresentar contexto invalidado; TTL inicia na resolução. Chamadas get já entregues aos consumidores continuam exigindo o descarte normal de componentes na troca de contexto.
- Guacd inalterado. Workspace original preservado.
- Logs completos temporários: /tmp/nodeaccess-0040-{full.json,tests.log,typecheck.log,browser.log}.
- Preparação inicial Node 24 falhou no compilador C++ antigo do host; não é resultado de regressão. Migração de runtime será validada separadamente.
