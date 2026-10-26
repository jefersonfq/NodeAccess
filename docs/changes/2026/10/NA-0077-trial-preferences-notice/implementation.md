# NA-0077 — Registro da implementação

## Pedido e objetivo
Adicionar aviso elegante e sempre visível às preferências opcionais, preservando marcação voluntária.

## Implementação
Base SHA 201afd9ae524fc0e7a4d86e222d5fca60266dbac. Aviso permanente implementado somente no template e CSS scoped de TrialView.vue, com ícone decorativo e aria-describedby no grupo. Modelos/defaults/API intactos.

## Validação
Ran: contexto mínimo, leitura do fieldset e baseline Git. Planned: build, lint, browser, revisão, CI e smoke público. Manual: aceitação visual do usuário após publicação.

## Recuperação
Backup da imagem/configuração frontend antes da troca; rollback somente frontend. Sem alteração de banco ou backend.

## Pendências
CI do SHA final, publicação e aceitação visual do usuário.

## Diário de interações

### 2026-10-26T10:24:22-03:00 — Confirmação da alternativa com escolha ativa
Usuário aprovou manter os dois consentimentos desmarcados e adicionar aviso permanente. Nenhum consentimento será preenchido automaticamente. Plano registrado; próximo passo é revisão e implementação localizada.

### 2026-10-26T10:27:06-03:00 — Implementação localizada

Ran: build/frontend com vue-tsc e diff --check passaram. A primeira execução de lint apresentou três avisos de formatação; o status inicialmente lido do comando composto não representava esse resultado, corrigido na revisão do log do CI. Revisão independente estática confirmou escopo e acessibilidade. Avisos preexistentes do bundle mantidos. Planned: quatro cenários browser em claro/escuro com payload interceptado para demonstrar opcionais false; commit/CI, backup próprio e publicação frontend-only. Operação reaproveita guard/rollback revisados, preserva proveniência do frontend anterior e passou em 11 testes locais; ainda sem mutação remota.

### 2026-10-26T10:27:21-03:00 — Validação independente de interface

Ran: quatro cenários browser 390/1440 × claro/escuro passaram; texto e associação acessível corretos, ícone decorativo, duas opções inicialmente false, Space marca/desmarca, termos independentes e payload false/false com aceite dos termos em API exclusivamente interceptada. Zero escritas reais e erros de página. Quatro capturas revisadas pelo validador: legíveis, sem overflow. GO de produto conforme revisão e evidências. Próximo: commit autorizado, revalidação do SHA, CI e atualização frontend-only com backup.

### 2026-10-26T10:31:57-03:00 — Correção da formatação identificada no CI

CI static-quality recusou três atributos SVG na mesma linha. Alteração necessária restrita a quebras de linha no ícone; aparência e lógica intactas. Registro anterior de lint corrigido após leitura do log real. Ran: lint estrito com interrupção em falha passou sem avisos; revisor também executou ESLint --max-warnings 0 com sucesso e confirmou diff somente de formatação. Próximo: revalidação da fonte e novo CI antes de publicar.
