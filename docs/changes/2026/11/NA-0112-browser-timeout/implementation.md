# NA-0112 — Registro da implementação

## Pedido e objetivo

Corrigir vazamento de descendente após timeout do harness da rotina de cobertura.

## Implementação

Base SHA 47f06b51e693d91f5ed724b7b86e5362af75bc35. Worktree /tmp/nodeaccess-NA-0112, branch fix/NA-0112-20261103-browser-timeout. Nenhuma alteração na árvore NA0093 em análise.

## Validação

Regressão versionada antes da mudança: 9 PASS/1 FAIL, descendente resistente continuou ativo. Após mudança: 11/11 testes browser PASS; 17/17 testes de integração run/analysis-scope PASS. ESLint dos dois arquivos exit 0. Evidências before.txt, after.txt e integration.txt.

## Recuperação

Fixtures sintéticas com cleanup explícito. Sem scanner, Docker, VPS ou sessão de usuário.

## Pendências

Integração pelo root; sem publicação ou homologação humana. Workbook e índices globais coordenados pelo root.

## Diário de interações

### 2026-11-03T17:17:39-03:00 — Correção autorizada

Root reservou NA0112 após revisão adicional e reprodução isolada. A alteração será limitada ao encerramento do grupo POSIX; Windows mantém fallback de processo sem prova de encerramento da árvore.

### 2026-11-03T17:19:08-03:00 — Correção e verificações

No evento close após timeout, o harness envia SIGKILL imediatamente ao grupo POSIX privado antes de cancelar o fallback e resolver a Promise. Se o pai também resistir a SIGTERM, o fallback de 5 segundos continua ativo. No fechamento normal e spawn error não há escalada. Testes reais verificam ambos os caminhos de timeout e também que fechamento normal não mata descendente. A revisão independente foi solicitada ao agente frontend.

Risco/limites: a sinalização usa o PGID privado do processo criado. A escalada imediata evita manter um timer atrasado direcionado a PID de líder já encerrado; não há promessa de eliminar toda corrida de identificadores do SO. A implementação não percorre /proc nem espera reaping. A prova Linux usa /proc apenas no teste e considera zombie terminado, pois não executa trabalho. Windows preserva sinalização somente do processo; os novos testes de grupo são Linux-only. A chamada sinaliza antes de resolver, e o teste verifica ausência de trabalho sobrevivente numa janela limitada. Não há alteração de transporte SSH, terminal, produto ou scanner.

### 2026-11-03T17:20:40-03:00 — Revisão independente

Agente frontend reproduziu 11/11 testes browser e aprovou PASS_WITH_WARNINGS. Confirmou que close normal/spawn error permanecem intactos, escalada imediata ocorre somente depois de timeout e fallback de 5s continua. Limites Linux/Windows e ausência de promessa de reaping preservados. Evidência independent.txt. Estado de entrega: COMMITTED após checkpoint local autorizado; merge/publicação pendentes.
