# NA-0141 — Registro da implementação

## Pedido e objetivo

CIde7 frontendharness exit1 semtimeout; demais coletores testesPASS, LCOV ausente. Causa ainda desconhecida.

## Implementação

Base SHA: de7817938134c0c1e08e00833b671af937ad5864. Worktree isolado.

## Validação

Pendente reprodução; nada aprovado por inferência.

## Recuperação

Recursos próprios descartáveis; gates preservados.

## Pendências

Reprodução, patch mínimo, contratos e revisão; índices/workbook coordenados pela raiz.

## Diário de interações

### 2026-11-03T21:36:43.214602-03:00 — Escopo autorizado

Ownership browser.mjs/CIdiag nesta frente; NA0140 possui terminal e helper próprio. Nenhuma fonte integração alterada.

### 2026-11-03T21:43:42.826260-03:00 — Diagnóstico validado; causa histórica não reproduzida

Primeiro controle natural Ubuntu24.04.5/Chromium1248/Node24.22.1/CPU2/cachefrio passou44labels+10controles. Por decisão da raiz, executado depois plano fixo de TRÊS controles obrigatórios, todos registrados (não repetição até passar):21,24s/19,93s/18,46s, exit0 semtimeout nos três. Mesma imagem oficial Playwright1.64.0-noble, CI=true, NODE_V8_COVERAGE, memória6GiB, redeexterna desabilitada eGit/runtime readonly. Containers removidos. A falha frontend do CIde7 NÃO foi reproduzida; este checkpoint não declara correção causal.

Probe isola somente primeiro harness real; interrompe o orquestrador intencionalmente após esse resultado. Seu summary agregado não é evidência de cobertura nem aprovação dos outros quatro harnesses. Resultados sanitizados dos três controles em controls.json; logs completos continuam privados em /tmp/NA0141-control-N-frontend-private.log. Nenhum crédito de cobertura desses probes foi importado no gate.

Código frontend muda somente console.error(error.message) para console.error(error), mantendo stack no log privado. Assertions, waits e limites existentes permanecem byte-idênticos. Novo helper aceita exclusivamente frame de um dos cinco basenames conhecidos e publica categoria ASSERTION/TIMEOUT/OTHER +linha/coluna inteiras limitadas. Leitura usa descriptor O_NOFOLLOW/O_NONBLOCK, fstat regular e buffer limitado65537bytes (recusa acima64KiB), sem imprimir mensagem/path/HTML/selector/stack. CI valida novamente os campos; diagnóstico estruturado de flows preservado. Logs grandes ou semframe conhecido ficam semposição; não inferir causa.

39/39 contratos passaram e lint7arquivos semerros/avisos; diffcheckPASS. Subprocesso Node realmente falho prova exit1 e projeção sem dados privados; negativos cobrem nomes/frames malformados, bounds, symlink, diretório, ausente, loggrande e camposinjetados. Browserfixture preserva estadoFAILED ecleanup, CI mantém allowlist. Revisor frontend reproduziu39/39 e leu7arquivos:PASS_WITH_WARNINGS, sembloqueador. Não reexecutou controles browser.

Autorização raiz permite checkpoint de DIAGNÓSTICO após revisão; integração+novo CI decidirão se a falha reaparece e qualframe identifica. Nenhum scanner/suitecompleta/produção alterados nesta frente. Ownership NA0140terminal separado; revisão independente dele3/3PASS e browserreal atribuídoautor. Índices/planejamento vivo coordenados pela raiz.
