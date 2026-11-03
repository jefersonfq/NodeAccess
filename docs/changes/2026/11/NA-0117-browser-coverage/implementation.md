# NA-0117 — Registro da implementação

## Pedido e objetivo
Cobertura real de módulos browser, preservando escopo e thresholds.

## Implementação
Base SHA fb2eb5c9ea0a9ed878c7b76d65ef7a39abcbd6dd. Plano escrito antes de editar coletor. Worktree /tmp/nodeaccess-NA-0117.

## Validação
Planned: conversão/proveniência/merge e ensaio browser. Scanner pela raiz.

## Recuperação
Reverter frente isolada, sem produto/dados afetados.

## Pendências
Implementação, revisão independente, medição integrada. Roadmap/índices consolidados pela raiz.

## Diário de interações

### 2026-11-03T20:40:22+00:00 — Início autorizado
Raiz aprovou Chromium real com sourcemaps; revisão tooling coordena protótipo de conversão. Reconstruções de markup no harness frontend não podem receber crédito da fonte Vue original. Somente componentes/módulos realmente importados.

### 2026-11-03T21:00:24+00:00 — Captura e política conservadora implementadas

Coletor Chromium opt-in nos harnesses terminal e plataforma, com parada antes de page/context/browser.close, idempotência concorrente e cleanup preservado em falha CDP. Cada captura inclui UUID da execução, origem loopback, janela temporal, fingerprint global e hash do código executado. Conversor valida mapa inline, conteúdo original exato, inventário, realpath e ranges; CSS glue, dependências e scripts anônimos são classificados sem crédito de produto. Browser nunca recebe crédito da reconstrução sintética de markup. Node page.evaluate continua sem crédito Node.

Overlay mantém todos os mapas/zeros/denominadores existentes; só concede hits para descriptors de localização original exatos e únicos, incluindo branches completos. Incompatibilidades SSR/client ficam sem crédito. Ran:49testes iniciais e82subset ampliado PASS; primeiro ciclo real5harnesses terminou0, mas detectado erro de fixture no redirect tenant→Hosts, corrigido com resposta sidebar-bootstrap válida e guarda pageerror. Rerun final em execução; não declarar esse primeiro ciclo livre de erros UI.

Probe diagnóstico (não importado para gate) combinou mapa da integração com CDP local verificado: denominadores80.096linhas/26.799funções/61.138branches preservados; +1751linhas/+507funções/+996branches cobertos. Gitdiff diagnóstico71,047%(3541/4984), ainda abaixo80. Raiz decidiu manter denominadores originais e adicionar testes de componentes Vue reais em NA-0120/NA-0121; nenhuma aproximação por linha ou remoção de formatação. Código de harness NA-0118 copiado só para ensaio, commit pertence à raiz.

Primeiro ensaio também identificou504 de optimizeDeps durante navegação; preparação passou a escanear index.html completo antes de executar. Nenhuma anomalia foi ignorada para aprovação. Saída raw anterior é removida ao iniciar a fase, inclusive standalone. Limite Chromium local1234/Chrome151 já conhecido, CI instala versão lock. Scanner e coleta ampla permanecem com raiz.

### 2026-11-03T21:07:27+00:00 — Ensaio revisado e validação final

Ran: cinco harnesses reais PASS sobre NA-0119 (inputs nativos/wrap mobile) e NA-0118 final (seis jornadas, quatro labels/foco, sete ações nomeadas no viewport). Sem erros UI capturados. CDP: quatro capturas,329scripts,107fontes convertidos,zero anomalias; /tmp/na0117-browser-reviewed-final.log e /tmp/na0117-reviewed-conversion.log. Na branch local,119/118 aparecem como dependências988b4ef49/e56b36aff; integração deve aplicar somente o commit próprio NA-0117, pois já possui os originais.

Revisão identificou dois casos adicionais: runID ausente em ambos metadados e symlink de saída podendo redirecionar chmod/cleanup. Leitor agora exige UUID válido; preflight valida root, coverage e browser por lstat/realpath antes de criar filhos, chmod ou remover raw antigo. Negativos preservam alvo0755 e conteúdo externo. Caso diretório preexistente0755 também reproduzido e corrigido para saída0700. Ran:84testes subset PASS e lint focal PASS após essas guardas. Última guarda de path foi adicionada após o ensaio Chromium e validada por testes focais; coleta ampla da raiz deve gerar artefatos frescos no SHA integrado, sem reutilizar ranges desta evidência. Nenhuma mutação de produção/scanner. Revisão independente final PASS_WITH_WARNINGS:49contratos captura/mapa/run/browser e dois negativos symlink reproduzidos pelo revisor; logs /tmp/na0117-independent-final.log e /tmp/na0117-symlink-independent.log. Limites: checkout confiável sem defesa FD contra corrida de filesystem, incompatibilidades Vue permanecem zero, mocks API não provam hosts reais.
