# Evidências NA-0041

Estado LOCAL_VALIDATED; sem implantação.

- Typecheck backend aprovado.
- 7 testes focados de migrations/saúde e Redis, incluindo servidor TCP real silencioso, 1.100 comandos, teto de 1.024 pendências e limpeza do socket/fila.
- Webhooks: 82 testes; presença de sessões: 34 testes.
- Helm: lint, renderizações e rejeição de grace periods incompatíveis aprovados. API 75s; gateway 180s para drain 110s + deadline 60s + margem.
- Readiness/deep conferem migrations aplicadas, pendentes e falhas; readiness reutiliza resultado por até 10s. Liveness continua independente do banco.
- Redis: commandTimeout 2s, socketTimeout/connectTimeout 5s, fila offline desabilitada, sem replay automático de comandos cujo ACK foi perdido. Erros devem continuar tratados conforme o domínio (cache opcional ou controle restritivo).
- Access log remove query string e Referer. Error log é suprimido apenas em /ws/, porque Nginx inclui a URL completa em falhas do upstream; status permanece no access log sanitizado.
- Compose preserva SSH nativo 2222; HTTP 3000/3001 fica em loopback. Guacd inalterado.
- Limite: SIGTERM integrado com sessões reais será revalidado junto da stack final; o teste Helm valida orçamentos, não prova ausência de interrupção em produção.

- Nginx real: 24 respostas nos quatro perfis, headers mantidos; tentativas WebSocket com token de teste não apareceram em stdout/stderr.
