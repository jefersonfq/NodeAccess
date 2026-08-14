# PRD Lite — Integração Jira

## Objetivo

Correlacionar atendimentos SSH a tickets Jira sem permitir que queda de rede,
reconexão ou fechamento de aba alterem acidentalmente o workflow do chamado.

## Autenticação

- API token permanece compatível.
- Jira Cloud suporta OAuth 2.0 3LO, refresh token rotativo e revogação local.
- Escopos de escrita são opt-in e dependem de liberação da instalação.
- Tokens ficam cifrados e respostas públicas não expõem corpo bruto do provedor.

## Política

- enforcement: `off`, `tenant` ou `selected`;
- seleção por usuários, grupos e pastas corporativas, com semântica OR;
- pastas abrangem hosts descendentes;
- regras opcionais por tipo, status, labels, responsável e idade desde a última atualização;
- break-glass somente para administrador, quando habilitado, com justificativa auditada.

## Atendimento

- uma interaction ID agrupa sessão inicial, reconexões e abas duplicadas;
- o ticket e o atendimento aparecem no terminal;
- fechar aba ou websocket não encerra o atendimento;
- encerramento explícito informa consequências e enfileira efeitos Jira.

## Escritas e confiabilidade

- comentários inicial/final, anexo de link da auditoria e transição são independentes;
- capabilities efetivas desabilitam opções sem escopo;
- outbox persistente usa chave idempotente, retry e backoff;
- falha posterior do Jira não encerra uma sessão SSH ativa;
- anexos não incluem conteúdo integral do terminal, somente referência autenticada.

## Performance e consistência

- consultas simultâneas do mesmo tenant e ticket compartilham a chamada Jira em andamento;
- respostas e erros não permanecem em cache apó a conclusão;
- tickets usados para autorização não usam TTL, evitando aceitar status,
  responsável ou labels obsoletos;
- a chave de deduplicação inclui tenant e ticket para preservar isolamento.

## Observabilidade e testes

- métricas de autorização e outbox não contêm ticket ou token;
- unitários cobrem scopes, grants, regras e retry;
- harness Playwright aceita Chromium local ou `CHROMIUM_CDP_URL`;
- escrita real somente contra ticket sandbox autorizado.
