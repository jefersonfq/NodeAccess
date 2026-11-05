# Evidências NA0148

Execuções no worktree isolado, Node24.22.1/npm12.2.1 e Chromium1234. Dados/credenciais de fixture; nenhum host real acessado.

- before-ui.json: fonte baseline ee436, duas capturas anteriores, Tab preso no playback e ausência de saída local por Tab/Escape no canvas.
- after-ui.json: fonte da frente, API/Guacd interceptados, teclado real do Chromium; screenshots correspondentes em ../screenshots.
- dcs-performance.json: medições pontuais sintéticas, sem extrapolação de SLA ou exploração end-to-end. O legado só foi medido até24k unidades; não executar versão quadrática em500k.
- copy-focus.png: ensaio completo do terminal, foco por teclado e leitura sem edição; linhas/colunas antes/depois iguais.

As imagens demonstram alinhamento e indicação visual, não certificação de acessibilidade. Canvas de fixture não contém desktop remoto real. A captura mobile anterior da primeira implementação tinha dica inferior fora da viewport; a evidência final usa topo com bounds verificados. Capturas do manual foram revalidadas separadamente pela rotina oficial e cinco imagens abertas para revisão.

A captura after-playback-overview.png vem do ensaio anterior com saída curta (hZTt4Q). after-playback-desktop.png vem do ensaio HL0Nez e último RRNSS5 com100linhas sintéticas: a área externa está rolada após a sequência PageDown/Tab; o enquadramento mostra o estado efetivamente navegado, não uma quebra do cabeçalho. Os dois ensaios usaram a mesma fonte de produto; o último ampliou apenas a fixture/asserções de rolagem e clipboard.
