# NA-0076 — Registro da implementação

## Pedido e objetivo
Substituir cartão de carregamento pelo efeito nativo de páginas, chamado pousar.

## Implementação
Base SHA215ac13738b4d0a24d53de41d991a692459434be. Escopo: saída do site e chegada do trial; backend/dados intactos.

## Validação
Ran: browser do site e frontend compilado (oito cenários), build/vue-tsc, lint incremental e revisão independente de produto: PASS. Planned: checks do SHA final e smoke público.

## Recuperação
Backup de assets e imagem/configuração frontend antes da publicação. Sem rollback de dados.

## Pendências
Checks do SHA final e publicação frontend-only; aceitação visual do usuário pendente.

## Diário de interações

### 2026-10-26T09:34:17-03:00 — Pedido de efeito nativo
Confirmado padrão de90ms/-4px na saída e170ms/+6px na chegada. Origens distintas exigem CSS no trial além dos assets do site. Plano revisto independentemente com GO. Preparação operacional somente leitura em andamento.

### 2026-10-26T09:42:48-03:00 — Movimento implementado e validado localmente

Ran: site browser4cenários, Enter, modificadores/novaaba/download, retorno, movimento reduzido e ausência de animationend; navegação1vez e valores90ms/ease-in/-4px. TrialView compilado4cenários390/1440×normal/reduced:170ms/ease-out/+6px→0, apenas montagem, sem repetição ao carregar dados ou validar formulário; zeroPOST. Buildfrontend/vue-tsc e linttargeted passaram; aviso preexistente de chunkgrande mantido. Não muda área do terminal nem fluxos do manual.

Preparação operacional somente leitura confirmou nginxfrontend participa do caminhoWS; atualização terá guard temporário apenas para novosWS, exige zero sessões antes/depois do guard e não reinicia backend/gateway/stateful. Descriptor registrará frontendOverride com fonte/digest próprios, preservando releasebackend existente. Sem execução remota de publicação nesta etapa. Próximo: revisão final/commit, imagem no SHA limpo, backup/guard, atualização frontend-only e smoke público.

### 2026-10-26T09:52:05-03:00 — Revisão independente de produto

GO para commit/build: escopo e oito cenários confirmados pelo revisor. Roteiro operacional preparado com oito selftests e dez sondas HTTP do guard; revisão operacional separada antes da execução remota. Nenhum dado/serviço remoto alterado nesta etapa. Próximo passo: commit autorizado, checks do SHA, imagem oficial frontend e publicação com backup.
