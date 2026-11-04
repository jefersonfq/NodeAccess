# NA-0140 — Registro da implementação

## Pedido e objetivo

Investigar timeout do cabeçalho HTOP após zoom no CI de781793. O rodapé já havia aparecido. Distinguir falha de sincronização do harness de defeito do produto, sem reduzir asserts ou deadlines.

## Implementação

Base `de7817938134c0c1e08e00833b671af937ad5864`, branch `fix/NA-0140-20261103-terminal-zoom-sync`, plano antes do código.

O harness aceitava `resizeMessages.length >= 2`, mas já havia dezenas de resizes anteriores ao gesto. Fonte/localStorage/feedback atualizam antes do fit agendado em dois requestAnimationFrame. Capturar altura antiga e emitir um frame dessa altura após a redução faz o xterm rolar o cabeçalho para fora; não é defeito de transporte demonstrado.

O contador é capturado antes do gesto. `terminal-zoom-observer.cjs` aguarda fonte esperada, mensagem nova, redução de linhas e igualdade de rows/cols entre DOM e último resize enviado. Retorna esse mesmo snapshot para montar o frame ANSI, evitando outra leitura posterior. Header, footer, alinhamento, convergência PTY, performance de primeiro frame e demais asserts/deadlines permanecem intactos.

Nenhuma fonte de produto, resize/SSH/WebSocket funcional, política ou limiar foi alterado. Apenas sincronização da simulação. Por isso não foi necessária nova alteração/manual de procedimento nem execução PTY real nesta frente; o teste terminal web completo permanece obrigatório e executado abaixo.

## Validação

Ran: controle baseline com instrumentação privada somente numérica, Ubuntu Noble Chromium1248/CPU2/Node24.22.1: PASS58,5s. Antes do gesto:40linhas/62resizes; captura natural:37linhas/63resizes. A condição antiga já era verdadeira antes do zoom, mas essa execução não reproduziu espontaneamente a falha.

Ran: interleaving dirigido no harness em memória: conservadas40linhas pré-zoom, aguardado fit real37linhas antes do frame ANSI original. Resultado headerfalse/footertrue e timeout30s original, mesmo sintoma do CI. Isso prova mecanismo possível, não cronologia exata do evento histórico. Nenhuma espera arbitrária ou fonte produto alterada. Resumo sanitizado reproduction.json, logs privados `/tmp/NA0140-before-terminal.log` e `/tmp/NA0140-stale-terminal.log`. Runner privado do negativo retorna0externo, mas registra childExitCode1 e statusfailed; não confundir com aprovação do teste.

Ran: sete contratos Node PASS (três de zoom e quatro SFTP existentes); negativos rejeitam contagem histórica, dimensões obsoletas/divergentes, fonte anterior, geometria inválida e container ausente. ESLint três arquivos sem warnings/erros; diffcheck PASS. Logs privados `/tmp/NA0140-tests-final.log` e `/tmp/NA0140-lint.log`.

Revisão independente tooling PASS_WITH_WARNINGS: três contratos reproduzidos, leitura do delta sem bloqueadores; fonte produto intacta. Limite: fixture pressupõe um container e histórico de mensagens controlado. Log `/tmp/NA0140-independent.log`; ensaios browser são atribuídos ao autor, não ao revisor.

Ran: `npm run test:terminal-experience:web` PASS no candidato Ubuntu1248/CPU2/npm12.2.1/Node24.22.1, 60,87s. Header/footer presentes,37rows/149cols convergentes com resize, gap11px, primeiro frame45ms e zero erros. `after-summary.json` preserva horários exatos e métricas; captura HTOP aberta e revisada: alinhamento e limites corretos, sem corte do topo/rodapé. Container e servidor encerrados. Scanner/cobertura global/publicação ficam na integração.

## Recuperação

Reversão isolada do harness/helper/testes; sem banco/configuração ou migração.

## Pendências

Não afirmar reprodução espontânea nem causa histórica confirmada. Índices, planilha e publicação coordenados pela raiz; não atualizados por esta frente. UI/servidor remotos são simulados, sem host real.

## Diário de interações

### 2026-11-04T00:35:00+00:00 — Investigação autorizada

CI aguardou header após footer. Inspecionado mock de frame e espera histórica de resize; preparado ambiente isolado e plano antes de código.

### 2026-11-04T00:40:00+00:00 — Mecanismo reproduzido e correção mínima

Controle natural passou; interleaving dirigido40→37 reproduziu header ausente/footer presente. Corrigida espera do harness por novo resize coerente, preservando todos os asserts. Testes/lint e revisão independente passaram; terminal completo do candidato em execução.

### 2026-11-04T00:41:16+00:00 — Validação final local

Terminal web completo aprovado no runtime de CI; captura revisada e metadados preservados. Revisão independente dos três contratos aprovada, sete contratos totais e lint sem falhas. Checkpoint autorizado; integração e publicação pela raiz.
