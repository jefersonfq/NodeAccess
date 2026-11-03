# NA-0138 — Registro da implementação

## Pedido e objetivo

CI66b falhou antes do scanner: Vitest3456PASS, Nodeexit0, browserexit1; faltaLCOV. Causa interna não demonstrada no artefato sanitizado inicial.

## Implementação

Base SHA:66b72db3483bf51412526e25a03c3124c948cfd3. Worktree isolado, sem alteração da integração congelada.

## Validação

Investigação em andamento; nenhuma aprovação inferida.

## Recuperação

Recursos descartáveis próprios, gates preservados.

## Pendências

Reprodução, correção, contratos e revisão. Índices/workbook coordenados pela raiz.

## Diário de interações

### 2026-11-03T20:40:48-03:00 — Investigação autorizada

Lido coletor browser e diagnóstico CI; readiness60s é hipótese, não causa confirmada.

### 2026-11-03T20:51:50-03:00 — Causa comprovada e correção localizada

Readiness foi hipótese descartada nos ensaios: cache frio com shared compilado e dependências próprias respondeu vue.js/naive-ui.js em cerca de2s. WSL/Chromium1234 passou5harnesses em160,8s; controle Ubuntu24.04.5/Playwright1.64.0/Chromium1248/Node24.22.1, CI=true e NODE_V8_COVERAGE, CPU2/mem6GiB, passou5harnesses em170,5s. Controle Ubuntu inicial precisou corrigir montagem readonly do Git comum; essa falha de fixture não é a causa atribuída ao CI.

Causa reproduzida separadamente: clone --no-local --single-branch da branch66b não contém commit3aa551378. O harness frontend executava gitshow desse objeto antes de abrir browser, falhando exit1 Invalid object name. Repositório local o retém por frentes auxiliares. Commit publicado f4a44b4b7ae87a8f688b1246d9e52a31f9a104bc é ancestral e possui arquivos Vue byte-idênticos: gitdiff --name-only f4..3aa --apps/frontend/src vazio. Somente duas chamadas tools/scripts usavam o snapshot local. Agora usam constante SHA completa publicada; nenhuma assertion de UI mudou.

Novo contrato clona histórico independente, exige ausência do objeto local e ancestralidade da baseline publicada, então executa bootstrap real do harness (Git e compilador Vue reais) em VM até antes do browser. Verifica44labels+10controles; dependências vêm do checkout de teste, não executa npmci. Não substitui captura DOM real, já validada no controle e posteriormente na integração.

Diagnóstico adicional pequeno: coletor registra fase literal setup/listen/readiness/harness/complete/cleanup. Publicação inclui apenas fases conhecidas, categorias exatas e cinco nomes permitidos (frontend/table/terminal/platform/flows) com exitCode inteiro0..255 e timedOut booleano. Duplicados não expandem saída; nomes desconhecidos, paths, erros livres e payloads brutos são descartados. Gates e limites de execução não mudaram.

56/56 contratos focais passaram; lint6arquivos sem erros/avisos e diffcheckPASS. Revisão independente solicitada. Nenhum scanner/npmci/serviço deprodução alterado. Dependências copiadas para worktree próprio; container --rm/networknone e montagemGit/runtime readonly. Root fará fullcoverage/Sonar no próximo checkpoint; ausência de falha na próxima execução hospedada ainda não foi demonstrada.

### 2026-11-03T20:51:50-03:00 — Revisão independente concluída

Frontend reproduziu56/56 comNode24.22.1 e conferiu baselineVue equivalente/objetoausente no clone. PASS_WITH_WARNINGS, sem bloqueador. Limite explicitado: VM executa bootstrap Git/Vue real, mas não main/browser; require usa helpers/deps do worktree de teste. ControleUbuntu real é evidência do autor, não rerun do revisor. Container descartável removido automaticamente; imagens e clone mantidos para reprodução, sem modificar tags/serviços existentes.

Documentação da frente sincronizada para projeto canônico. Checkpoint autorizado para integração; planejamento vivo/índices coordenados pela raiz. Reexecução fullcoverage/Sonar/CI no SHA final continua pendente.
