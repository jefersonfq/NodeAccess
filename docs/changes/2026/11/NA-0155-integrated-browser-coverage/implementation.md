# NA-0155 — Registro da implementação

## Pedido e objetivo
Ampliar testes significativos de HA e integrar oito jornadas reais ao coletor, preservando produto, configuração de transformação e limites de qualidade.

## Implementação
SHA base: 28a77996deb4c004690e828c4a3a1f6dd292d198. Trabalho executado no worktree isolado `/tmp/nodeaccess-NA-0155`.

O teste HighAvailabilityView importa o SFC original e executa setup/template SSR com Vue oficial. São 22 contratos em duas implementações legítimas dos slots de componentes de fronteira: renderização SSR direta e retorno de VNodes. Os mesmos comportamentos são verificados nos dois modos: licença, inventário, carregamento, erros e retry, telemetria, preflight, confirmação de promoção, payloads, release, rejoin e planejamento. Operações bloqueadas verificam ausência de chamada; operações permitidas verificam argumentos e feedback. Nenhuma operação HA real é executada.

O harness HA anexa captura CDP antes da navegação. A orquestração agora exige oito harnesses: frontend, table, terminal, platform, flows, ha, audit-input e highlight-budget. Frontend, table e highlight-budget medem Node real apenas; os outros cinco também coletam browser na origem compartilhada. Callbacks page.evaluate não recebem cobertura Node. Budget mantém Vite próprio. Detalhes de ownership e revisão em evidence-tooling.md.

## Validação
Ran: testes e verificações abaixo foram executados no worktree isolado. Planned: união integrada e scanner pela raiz.
- 44/44 testes HA passaram; revisão independente backend reproduziu 44/44.
- 65/65 contratos de tooling passaram e foram reproduzidos pelo revisor backend.
- Lint focal sem erros ou warnings; typecheck frontend terminou com exit 0.
- Oito harnesses reais passaram em 265,486 s, todos exit 0 e sem timeout. Node 24.22.1 e Chromium 1234 explícito; sete cenários HA e quatro grupos audit-input incluídos. Origem loopback encerrada ao final.
- Medição focal HA: mapas statementMap/fnMap/branchMap idênticos à coleta oficial e fonte de produto idêntica. Ganho de 253 unidades novas (108 linhas e 145 condições) entre as 411 unidades HA; 158 continuam descobertas. Isso não demonstra aprovação do gate global. A nova instrumentação também acrescenta unidades mensuráveis e a união integrada precisa recalcular tudo.
- Revisões técnicas independentes: PASS_WITH_WARNINGS, preservando os limites abaixo. Não foi executado scanner nesta frente.

## Recuperação
Checkpoint isolado de testes e harnesses. Sem alteração de dados, serviços ou configuração de produção. Reversão não requer migração. Dependências compartilhadas foram usadas somente para execução; symlinks temporários não pertencem ao checkpoint.

## Pendências
Raiz executará união oficial, cobertura e Sonar no candidato integrado. Chromium 1248/CI e homologação humana não são inferidos dos ensaios Chromium 1234. Planilha e índice global da entrega serão consolidados pela raiz; nenhuma atualização da planilha foi feita por esta frente.

## Limitações
SSR usa serviços, Naive UI e componentes filhos simulados: load explícito não comprova onMounted/unmount, foco, portais ou renderização dos filhos. O browser complementa essas fronteiras. Retorno de VNodes corresponde a uma forma real de consumo de slots Vue, sem mudar transformação ou fabricar hits. Não há crédito manual de CDP em posições SSR incompatíveis nem de Worker não capturado.

O controle HA real registrou findings vazio nos sete cenários, mas o stderr do Vite contém uma notificação ResizeObserver; mantida na evidência, sem atribuição causal ao produto. O recorte interno mobile preexistente documentado em NA0154 permanece fora deste escopo e a ausência de overflow da página não prova que não existe recorte interno. Sem leitor de tela ou HA real.

## Diário de interações

### 2026-11-04T12:10:00-03:00 — Diagnóstico e escopo
Raiz autorizou testes significativos para o gate 80 e delimitou ownership. Diagnóstico confirmou 8294 unidades, 6055 hits e déficit inicial de 581. Plano submetido ao backend antes de implementar; GO_WITH_RISKS exigiu provas de ausência de IO nos bloqueios e payload/feedback nas operações permitidas.

### 2026-11-04T12:41:18-03:00 — Implementação e validação focal concluídas
Implementados contratos HA e coleta dos oito fluxos. Foram corrigidas expectativas iniciais de testes que confundiam o nó do planejamento (PRIMARY) com rejoin (STANDBY), preservando a verificação de payload exato e sem modificar produto. A variante VNode foi autorizada apenas como execução semanticamente real dos slots, com as mesmas asserções. Revisões independentes concluídas; fontes ficaram congeladas durante os oito harnesses. Próximo passo: checkpoint e medição integrada pela raiz. Evidências sanitizadas da frente sincronizadas para docs canônico; logs brutos e cobertura permanecem privados no worktree.
