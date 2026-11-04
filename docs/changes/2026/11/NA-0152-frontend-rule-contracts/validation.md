# Validação NA0152

- Node24.22.1, Chromium1234 local, Vite loopback isolado; API bloqueada e clipboard simulado. SFC McpAgentSetup e Naive reais. Baseline28/28; após oito novos casos36/36.
- Diferencial extraído das fontes base/atual: 89887 comparações de parser/cursor, 1006 datas ISO incluindo anos negativos/estendidos e extremos válidos: PASS. É amostragem finita, não prova universal.
- Browser antes/depois: Codex três pre, Claude dois pre; Copy/Enter e abertura details, Tab e Shift+Tab comprovam remoção da parada estática preservando ação. Viewports1365x1000 e390x844. Conteúdo e dimensões dos três pre comparados byte/numericamente: idênticos. Zero pageerrors.
- Quatro screenshots abertas e inspecionadas: alinhamento e quebra responsiva preservados; nenhum elemento novo. Toast transitório de sucesso cobre parte do título nas duas versões; comportamento anterior, não alterado. Capturas limitadas à janela visível do modal rolável, não prova visual de toda página ou leitor de tela.
- Primeiro harness privado falhou por instâncias Vue distintas em caches Vite; corrigida apenas a resolução do harness para cache próprio. Aviso de virtual:nodeaccess-manual durante crawling de dependências apareceu em ambas versões, sem erro de página/asserção; fixture não monta manual.
- Lint focal: FAIL legado66errors/568warnings; comparação por regra/mensagem/severidade comprovou multiset idêntico à base. Cleanup separado NA0154 resolveu fontes; novos contratos foram movidos para arquivo próprio. Não houve supressão de regras. Typecheck frontend exit0 confirmado.
- Não alterados área útil, resize, WS ou SSH; sem necessidade de repetir PTY pelo delta. Sem scanner/homologação humana nesta frente.

## Checkpoint após cleanup
Base661b37f323537a788ff610bc487a3d823a79aee9 (NA0154). Delta produto3arquivos5inserções6remoções, mais novo arquivo8contratos; teste antigo intacto. Lint4arquivos0erros0warnings commax-warnings0;36/36testes em2arquivos; typecheckfrontendexit0; diferencial89887+1006PASS. Browser real reexecutado após reaplicação, sem alterar asserções, /tmp/NA0152-after-final:PASS. Dimensões/conteúdo iguais ao baseline, duas imagens finais abertas e inspecionadas.

Revisão backend independente:36testes+probe reproduzidos, PASS_WITH_WARNINGS; raiz releu delta pósbase, PASS_WITH_WARNINGS. Não implica AT formal/homologação humana nem fechamento Sonar. Resolution.json registra proposta pendente de análise integrada, sem duplicar dispositions.
