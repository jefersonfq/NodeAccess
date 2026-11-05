# NA-0145 — Avaliação dos 294 achados abertos

Fonte avaliada: `ee436402db8bcce7fab4378d6ba28c1673b282b5`. Os 294 IDs e suas linhas foram conferidos contra a análise atual do Sonar, em 129 arquivos. Esta avaliação substitui as justificativas anteriores de `context_reviewed` para fins de decisão. Não altera a baseline nem fecha issues no servidor.

## Resultado

| Classificação proposta | Ocorrências | Significado |
|---|---:|---|
| Falso positivo | 242 | A finalidade e os consumidores inspecionados não apresentam o problema indicado pela regra. Não significa ausência de outros defeitos no arquivo. |
| Requer decisão de risco | 43 | Uso intencional ou risco condicionado ao ambiente; não há aceite humano presumido. |
| Correção recomendada | 7 | Quatro correções funcionais/de segurança e três anonimizações de fixtures. |
| Evidência insuficiente | 2 | Faltam verificações específicas de acessibilidade para concluir. |
| **Total** | **294** | Sem IDs ausentes ou duplicados. |

Consulta individual: [tabela HTML](review.html), [CSV](review.csv), [JSON](review.json). Cada linha contém local atual, justificativa, prioridade, evidências, validação executada e limitações. Os estados no Sonar continuam OPEN.

## O que corrigir primeiro

| Prioridade | Referência | Problema e evidência | Próximo passo |
|---|---|---|---|
| P1 | SQ-0052 | O normalizador de auditoria pode bloquear processamento síncrono. O consumidor original `summarizeInteractiveOutput` excedeu o limite de 1,5 s com cerca de 60 KB de saída sintética contendo U+2028. O corte das últimas linhas ocorre após a expressão custosa. | Substituir o reconhecimento por processamento linear; preservar a semântica de pager e testar entradas Unicode incompletas, tamanhos crescentes e reconstrução de auditoria. |
| P2 | SQ-0069 | A proteção de highlights aceita `(a|aa)+$`; a execução real do matcher sobre 61 caracteres excedeu 1,5 s. O orçamento é verificado depois do `RegExp.exec` síncrono. O detector backend também tem custo evitável, mas a prova forte é do matcher. | Rever validação e execução de padrões para garantir limite efetivo; validar terminal real e fidelidade dos destaques. |
| P2 | SQ-0208 / NA0145-F01 | Playback focável usa `@keydown.prevent` para todas as teclas. O modificador real do Vue cancela Tab, setas, PageDown e Ctrl+C. | Preservar navegação, rolagem e cópia; testar foco e player em navegador real. |
| P2 | SQ-0453 | Harness de trial tem alvo SSH padrão e coleta a primeira chave sem identidade previamente validada. O banco descartável não comprova isolamento do host SSH. Não foi feita conexão nesta revisão. | Exigir seleção explícita de alvo descartável e identidade esperada antes de conectar. |
| P3 | SQ-0314, SQ-0319, SQ-0503 | Fixtures contêm identificadores públicos operacionais desnecessários. Não foi demonstrada conexão nem vulnerabilidade nesses fixtures. | Anonimizar com endereços documentais, preservando os contratos dos testes. |

Recomendo tratar o P1 antes da homologação/merge da entrega integrada. O gate aprovado mede as condições configuradas; não invalida este defeito encontrado na reavaliação de um item anteriormente aceito na baseline.

## Dois defeitos adicionais, sem duplicar a contagem dos 294

- **NA0145-F02 — IPv6:** a função atual retorna sucesso para endereços com duas compressões `::`, rejeitados pelo controle `node:net.isIP`. A regra original aponta um byte sentinela intencional, portanto pode ser falso positivo mesmo com esse defeito adjacente. A prova não demonstra bypass no backend ou uma conexão aceita.
- **NA0145-F03 — DCS na visualização de auditoria:** prefixos ESC P sem terminador provocam reexame de sufixos. As medições de 1 mil, 4 mil e 12 mil prefixos cresceram aproximadamente de 1 ms para 16 ms e 124–146 ms. É um único problema associado a cinco alertas de bytes de controle, não cinco vulnerabilidades. Avaliar também a expressão equivalente da heurística de redraw.

O playback aparece no arquivo [de defeitos associados](frontend-related-findings.json), mas já integra as sete ocorrências com correção; não deve ser somado novamente.

## Decisões operacionais e lacunas

Dos 43 riscos condicionais, 32 tratam da resolução de executáveis pelo PATH. A inspeção não demonstrou que uma entrada externa controla esse PATH nos caminhos avaliados. Isso é uma fronteira de confiança do operador/CI, não 32 explorações confirmadas. A decisão pode combinar política de ambiente, verificação da resolução e endurecimento compatível com Windows e gerenciadores de versão; não se recomenda substituir indiscriminadamente por caminhos Unix fixos.

Os demais casos incluem persistência de diretórios temporários, contratos de configuração, laboratório com credenciais de teste, permissões do webroot ACME e precedência de erros na recuperação TLS. No último caso, a falha de gravação pode substituir o diagnóstico de falha do rollback; a prova preservou `pending` e `recoveryRequired` em memória e não demonstrou perda de certificado ou de dados.

O TACACS+ legado exige MD5 para a ofuscação definida pelo protocolo. Isso não transforma o algoritmo em proteção moderna; o uso precisa de condições operacionais e aceite explícitos. Referência primária: [RFC 8907, seção 4.5](https://www.rfc-editor.org/rfc/rfc8907.html#section-4.5).

SQ-0127 e SQ-0240 permanecem com evidência insuficiente: verificar indicação de foco no modo cópia e saída de foco/tecnologia assistiva no canvas remoto. Não presumir conformidade ou aceitar risco apenas porque falta um teste.

## Provas e limites

Foram feitas inspeções estáticas, confrontação dos IDs/linhas e simulações focais em Node 24.22.1, com TypeScript e Vue reais quando pertinentes. O parser de pager foi executado com quatro módulos originais transpilados; highlights e funções de frontend foram extraídos/transpilados da fonte revisada. Subprocessos adversariais tiveram deadline. A raiz repetiu as provas principais e houve revisão cruzada das conclusões sensíveis.

- [Pager no consumidor original](pager-probes.json) e [repetição independente](pager-consumer-independent-result.json).
- [Matcher real de highlights](highlight-independent-result.json).
- [IPv6, teclado e DCS](frontend-probes.json) e [repetição independente](frontend-independent-result.json).
- [Falha dupla TLS](tls-independent-result.json).
- [Verificação da fonte e IDs](source-verification.json).

Os scripts de reprodução estão nesta pasta e devem ser executados em checkout confiável com as dependências instaladas, conforme seus parâmetros de raiz. Não executam ataques contra a VPS. Os resultados não constituem exploração SSH/HTTP ponta a ponta, medição de FPS, auditoria WCAG ou homologação humana. Não houve mudança de produto, de gates, de baseline, de estado das issues ou novo scanner nesta frente documental.

## Encaminhamento

1. Corrigir o P1 em branch própria e revalidar auditoria e Sonar.
2. Tratar os P2 e os dois defeitos adicionais em alterações pequenas, com testes específicos.
3. Resolver as duas lacunas de acessibilidade e as anonimizações P3.
4. Submeter os 43 riscos condicionais a decisão explícita com condições e responsável.
5. Só então refletir no Sonar as decisões individualmente justificadas e refazer a análise; nenhuma baixa em lote foi autorizada ou realizada nesta avaliação.
