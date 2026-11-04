# NA-0139 — Registro da implementação

## Pedido e objetivo

Corrigir a falha intermitente do harness flows no CI e preservar diagnóstico seguro após cleanup. O job anterior perdeu o log privado; não é possível atribuir sua causa histórica com certeza.

## Implementação

Base `2ce54c08887a7de4e194fdcb97a8f33c55655419`, branch `fix/NA-0139-20261103-flow-ci-diagnostics`. Plano registrado antes do código.

A fixture genérica `[]` não atendia `/hosts/sidebar-bootstrap` nem `/sessions/filter-options` e as listagens paginadas. O consumidor real de Hosts executava `data.groups.map` e lançava TypeError. O harness voltava ao dashboard assim que a URL mudava, podendo cancelar o carregamento e esconder a falha. Corrigidos contratos de fixtures; agora cada navegação aguarda conteúdo vazio renderizado, incluindo a ação pública “Ver todos os hosts” para sair da home. Usuários já possuía paginação correta; foi incluído na fábrica comum. Sessões aguarda tabela e fim do indicador de carregamento.

Os mesmos quatro contratos de teclado permanecem (Enter/Space navegam; x não navega), com verificação de pageerrors após cada destino. Nenhuma fonte do produto, timeout, limiar, exclusão ou baseline foi alterada.

`sonar-flow-diagnostics.cjs` preserva somente etapa e categoria enumeradas (ASSERTION/TIMEOUT/OTHER). Leitor rejeita symlink, arquivo não regular, JSON inválido e mais de 64KiB. O coletor remove relatório anterior antes da execução; só incorpora diagnóstico da falha atual. O resumo CI revalida a projeção e descarta mensagens, stack e quaisquer campos extras. A falha continua bloqueando o pipeline.

## Validação

Ran: controle baseline Ubuntu Noble/Chromium1248, duas CPUs, 6GiB, rede desabilitada, Node24.22.1 e V8/CDP: cinco harnesses PASS em174s; fonte permaneceu intacta durante o controle. Uma primeira tentativa iniciou antes da cópia de dependências terminar e falhou por módulo ausente; não foi usada como evidência de produto.

Ran: reprodução dirigida com Chromium1234 e fixtures originais: navegação por Space para Hosts, aguardando pageerror, comprovou TypeError/undefined.map originado em HostsView e requisição sidebar-bootstrap. Evidência privada `/tmp/NA0139-host-repro-dAUd5R/report.json`. Não houve espera arbitrária. Isso comprova o defeito da fixture, não a causa exata do job histórico.

Ran: after Ubuntu1248/CPU2, seis grupos flows PASS, quatro destinos carregados, zero pageerrors, geometria1440/390 sem overflow e sete ações móveis dentro da viewport. Execução37s, artefatos privados em `coverage/NA0139-flows-XAVZcx/`. O campo fixture do runner privado foi herdado da reprodução. O resumo público derivado `after-summary.json` corrige explicitamente essa descrição editorial e registra hashes das fontes, preservando resultado/horários e original privado; não representa nova execução. `flow-report.json` é o relatório original do harness, sem campo contraditório. Primeira tentativa after usou seletor de lista ainda na home e falhou; ajustado para clicar a ação pública Ver todos, sem aumentar timeout.

Ran: três contratos Vitest de schemas públicos PASS e 35 contratos Node PASS, incluindo sanitização, symlinks, tamanho, diagnóstico atual versus stale, falha fechada e operações de consumo dos contratos de navegação. ESLint nove arquivos sem erros/warnings; git diff --check PASS. Logs privados `/tmp/NA0139-tests-final.log` e `/tmp/NA0139-lint.log`.

Manual: capturas after diagnostic-mobile e dashboard-desktop abertas. Cards e ações alinhados; textos legíveis; sem alteração de UI ou poluição adicionada. Geometria/associação de labels/foco são verificações DOM do harness; screenshots não demonstram leitor de tela nem conformidade WCAG completa.

Ran: orquestrador final Ubuntu1248/CPU2/V8/CDP: cinco harnesses PASS, sem timeout, 174,19s totais, limite original120s por filho preservado. Run `71403162-c329-4886-8ab0-73b28a7e550e`, horários exatos em browser-summary.json. Container removido e servidor encerrado. Nenhum scanner/cobertura global executado nesta frente. Revisão independente tooling PASS_WITH_WARNINGS: 35/35 contratos reproduzidos, diffcheck e três hashes de fontes conferidos; revisão de fixtures/esperas/enums/remoção stale sem bloqueador. Browser real e três schemas Vitest são evidência atribuída ao autor. Limite: leitura de arquivo assume checkout confiável; não implementa proteção global contra troca concorrente do filesystem. Log privado `/tmp/NA0139-independent.log`. Checkpoint local após revisão, publicação pela raiz.

## Recuperação

Reverter esta frente isoladamente. Sem banco/configuração de produto; fixtures e diagnósticos permanecem compatíveis com resumos anteriores, que simplesmente não possuem failure por etapa.

## Pendências

Causa histórica do job permanece inferida por ausência de rawlog. Se o processo morrer antes de escrever o relatório (por exemplo launch ou kill), o resumo continua expondo nome/exit/timeout, sem inventar etapa específica. Dados são sintéticos e APIs interceptadas; sem SSH/backend reais. Índices, planilha canônica e publicação coordenados pela raiz; esta frente não declara esses itens concluídos.

## Diário de interações

### 2026-11-04T00:10:05+00:00 — Investigação autorizada

CI evidencia flows exit1 sem timeout; log bruto indisponível. Preparado ambiente isolado e plano antes de código. Tooling auxilia leitura independente, sem editar.

### 2026-11-04T00:19:49+00:00 — Defeito reproduzido e correção mínima

Controle baseline passou; reprodução dirigida comprovou contrato inválido em Hosts. Revisão identificou também opções de sessões. Corrigidas fixtures e espera por destinos renderizados; after1248 passou. Diagnóstico seguro preservado sem relaxar gates. Revisão independente solicitada e orquestrador final em andamento.
