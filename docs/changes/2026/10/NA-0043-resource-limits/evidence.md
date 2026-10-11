# Evidências NA-0043

Estado LOCAL_VALIDATED, sem deploy.

- Typecheck backend e suíte geral: 1.838 testes aprovados, 34 opt-in não executados.
- MySQL 8.4 descartável: todas as migrations aplicadas; 24 criações concorrentes por vias local/Google/LDAP/admin, 12 ativações e 12 restaurações disputam uma vaga. Uma operação vence em cada cenário; redução de cota abaixo do uso é recusada.
- WebSocket real: cliente TCP pausado, saída intensa limitada a 2 MiB por conexão; outra conexão responde. Fechamento 1013 e término forçado após 2s quando necessário. Strings contabilizadas em bytes UTF-8.
- Chromium: terminal-experience aprovado. PTY top/htop aprovado com SshSession atualizado e OpenSSH descartável (API fixture sem autenticação real).
- Guacd preservado. Procedimento do manual inalterado; recomendações de reconexão existentes continuam válidas.
- Logs completos /tmp/nodeaccess-0043-*. Nenhuma alteração de schema necessária para o lock por tenant.
