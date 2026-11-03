# NA-0105 — Registro da implementação

## Pedido e objetivo

Corrigir limites concorrentes e limite real de bytes na leitura MCP, com branch separada dos contratos NA-0100.

## Implementação

Base SHA 5e881ed9fa6991123ac691144cbcec5c2663bf1d, checkpoint NA-0100. Worktree /tmp/nodeaccess-NA-0105, branch fix/NA-0105-20261103-mcp-session-limits. Escopo restrito ao serviço MCP e suas regressões.

## Validação

Antes: 42 contratos PASS/2 regressões FAIL. Depois: 56 contratos PASS; módulo MCP completo 93 PASS/3 skips opt-in preexistentes. Shared e backend compilados no próprio worktree. Cobertura do serviço corrigido: 100% linhas (227/227), 89,4% branches (135/151), 91,8% funções (56/61). Revisão independente reproduziu 56/56 e aprovou com limitações explícitas.

## Recuperação

Reserva de abertura precisa finally idempotente; não muda autenticação, transporte, resize ou política de auditoria. Rollback por commit separado, sem deploy.

## Pendências

Integração, merge/publicação e homologação humana não realizadas. Quotas continuam por instância/processo; não há lock distribuído. Cursores arbitrários e surrogates já truncados pelo buffer são limitações preexistentes fora deste patch. Sem teste SSH/PTY real, pois transporte/resize não mudaram. Planilha/índices coordenados pelo root.

## Diário de interações

### 2026-11-03T16:49:00-03:00 — Correção autorizada

Root confirmou NA-0105 e os dois defeitos. Risco comunicado: tentativa pendente continua ocupando vaga até resolver/rejeitar; nenhuma nova semântica de cancelamento SSH. Read mantém cursor de string e limita saída por bytes sem dividir codepoint. Próximo passo: corrigir e enriquecer concorrência/falhas/reuso de capacidade.

### 2026-11-03T16:53:45-03:00 — Correção validada e revisada

Reserva é registrada sincronamente antes do primeiro await; promoção para sessão ativa remove pendência sem await intermediário e finally garante liberação idempotente. Leituras contam bytes de cada codepoint e preservam cursor UTF16 existente. Simulações incluem rajada de 20 limitado a 3 conexões, reserva por tenant entre tokens, outro tenant independente, liberação após 6 falhas, persistência pendente sem contagem dupla e reuso após close. Emoji/multibyte e orçamento insuficiente respeitam o cap sem consumir cursor indevidamente.

Suíte 56 PASS; módulo 93 PASS/3 skips externos. Build inicial detectou dist compartilhado canônico antigo (export findHostLinkTemplateTokens ausente); compilado shared local e usado link backend/node_modules/@nodeaccess/shared exclusivo deste worktree. Shared/backend então PASS, sem alterar dist canônico. Revisão independente PASS_WITH_WARNINGS, com 56 testes reproduzidos e riscos acima registrados. Próximo passo: commit local, checks no SHA e integração por root; sem publicação nesta frente.

### 2026-11-03T17:12:22-03:00 — Tipagem dos mocks após lint integrado

Root identificou acesso any em mocks de SQL, eventos, callbacks e chunks. Adicionados contratos explícitos Buffer, query.values, eventos administrativos, callback de revogação e JSON parse. Nenhuma supressão ou mudança de produto. ESLint real do arquivo exit 0; 56/56 contratos MCP passaram novamente em 1,50s. Evidência: evidence/lint-contracts-tests.txt.
