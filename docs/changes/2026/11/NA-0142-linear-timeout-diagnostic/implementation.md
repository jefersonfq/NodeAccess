# NA-0142 — Registro da implementação

## Pedido e objetivo

Corrigir S8786 issueId f695f260-eb67-4017-b773-cf39ce03b045 observado em290.

## Implementação

Base SHA: 2902f526d60aa75ee8a623ebd7c2b20e751b560d; worktree isolado.

## Validação

Pendente contratos/revisão. Nenhum scanner nesta frente.

## Recuperação

Reverter commit isolado; sem serviços ou configuração alterados.

## Pendências

Contratos, revisão, integração. Índices/workbook coordenados pela raiz.

## Diário de interações

### 2026-11-03T21:56:59.490365-03:00 — Escopo aprovado

Scanner local290 falhou1violação; cobertura81.8 e0hotspots não significam gateaprovado. Baselineaceita não será alterada.

### 2026-11-03T21:59:09.187780-03:00 — Parser e regressões

Substituído somente detector de timeout: prefixo TimeoutError nas quebras reconhecidas pelo JavaScript, linhas LF e busca progressiva de : Timeout seguida de dígitosASCII e sufixo literal. Preserva múltiplos marcadores (inclusive inválido antes ou depois de válido), CR/U+2028, mensagem em várias linhas e prioridade ASSERTION. Sem alteração de projeção pública ou leitor64KiB.

Antes do checkpoint, comparação diferencial de324entradas limitadas comregexanterior passou; referência temporária ficou privada, contrato versionado contém20casos explícitos e precedência. Teste adversarial usa subprocesso real3s e verifica4categorias no pai para60kCR,2MBprefixo/dígitos,60kmarcadoresinválidos e válidoao fim. Código antigo processou60kCR em1,979s e terminou(exit0): não foi timeout e não é registrado comoFAIL. Novo teste processou os quatro inputs emaproximadamente112ms incluindo startup; medidas não são benchmark universal.

Primeira suíte40/40PASS; após adicionar casoCR,6/6helperPASS. Lint2arquivosPASS; validação final e revisão em andamento. Sem scanner/CI/baselineaceita alterados. Disposição individual/tabela registradas; catálogo/índices/workbook ficam coordenados pela raiz.

### 2026-11-03T22:01:22.653823-03:00 — Checkpoint revisado

Validação final40/40PASS, lint2arquivosPASS e diffcheckPASS. Revisor backend reproduziu40/40 e adicionalmente2016combinações diferenciais contrahelper290 (CR/LF/U+2028/U+2029, prioridadeASSERTION, múltiplosmarcadores/dígitos/sufixos), semdelta. Quatroinputs adversariais emchild limitado passaram em60,26ms no ambiente do revisor. PASS_WITH_WARNINGS: não é prova universal, nenhum scanner rerodado. Parser avança offsets e não repete busca a cadaCR; leitura e gates intactos.

Documentação sincronizada para projeto canônico. Próximo passo: integrar e confirmar ausência S8786 no scanner. Esta frente não afirma correção da falha histórica intermitente do harness frontend; as assertions dele permanecem intactas.
