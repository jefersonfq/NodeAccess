# Uso econômico de tokens e evidências

O maior ganho controlável nesta rotina é evitar reenvio de contexto redundante. Não há telemetria de cobrança desta conversa disponível: redução de bytes de um relatório não comprova redução percentual de tokens nem custo.

| Frente | Prática adotada / recomendada | Garantia preservada |
|---|---|---|
| Sonar/CI | `npm run quality:context`, catálogo filtrado e logs privados completos | Evidência vinculada ao SHA; não aprovar execução antiga ou incompleta |
| Bugs/backend | Repro mínimo, um módulo, trechos de logs relevantes | Regressão e testes negativos do fluxo afetado |
| Frontend/terminal | Capturas por estado relevante, resultado resumido e artefatos fora do prompt | Inspeção visual, teclado e suites de terminal obrigatórias |
| Planejamento | Resumo vivo de decisão e próximo passo; links para planos anteriores | Rastreabilidade, sem copiar transcrições |
| Revisão independente | Contexto mínimo: plano, base/head, diff e evidências | Revisor tenta refutar o resultado; não recebe apenas conclusão favorável |
| IA do produto | Medir tokens de entrada/saída/cache por operação, depois avaliar resumos incrementais e limites | Isolamento por tenant, fidelidade da auditoria e possibilidade de recuperar evidência original |

## Rotina aplicada

O resumo local usa campos selecionados: SHA/árvore suja, validação/coverage atuais e contagens do catálogo. Não imprime comandos do usuário, conteúdo de sessões, tokens ou justificativas extensas. Uma execução nova incompleta impede reutilização automática da anterior. O catálogo pode estar desatualizado e é identificado como histórico.

Durante implementação, testes focais reduzem ciclos de correção. Antes de promover a entrega, os testes completos exigidos, scanner, checks e revisão seguem obrigatórios. Não reduzir percentuais, silenciar regras, trocar por mocks favoráveis ou ocultar falhas para economizar.

As instruções estáveis ficam curtas e apontam para documentação sob demanda. Não removemos regras do AGENTS.md nem alteramos configurações globais do Codex. Evitar delegação redundante e repetir leituras cujo conteúdo não mudou.

## Cache e modelos: o que validar antes de adotar

Na API, prefixos reutilizáveis estáveis e dados variáveis ao final podem favorecer cache. Cache não reduz automaticamente a quantidade de texto enviada; preços, escrita de cache e retenção variam por modelo. Compare tokens de entrada/saída, cache lido/escrito, latência e custo real, respeitando isolamento e política de dados. Não acrescentar texto inútil para atingir cache nem migrar modelo só pelo preço unitário. Para tarefas simples, testar modelo de menor custo com critérios de qualidade; manter revisão reforçada para segurança, autorização, migração e protocolos.

Essas opções de API não são configurações garantidamente expostas nesta sessão do Codex. Não foram feitas chamadas pagas, trocas de modelo, alterações de cache ou mudanças de prompts do produto nesta frente.

## Validação e medição

Testes do resumo cobrem SHA diferente, árvore suja, falha de teste/scanner/gate, falta de revisão, relatório ausente/incompleto/malformado e ausência de conteúdo privado na saída. A evidência da frente NA0165 mede tamanho em bytes do catálogo versus resumo — apenas volume de informação exibido, não economia de tokens. Após uso real, medir por tarefa concluída: leituras repetidas, bytes expostos, tokens efetivos quando disponíveis, tempo e regressões.

## Fontes oficiais consultadas em 2026-11-04

- [Instruções AGENTS.md no Codex](https://learn.chatgpt.com/docs/agent-configuration/agents-md): descoberta hierárquica de instruções e limite configurável.
- [Prompt caching na API](https://developers.openai.com/api/docs/guides/prompt-caching): prefixos estáveis, contabilização e diferenças de cache por modelo.
- [Checks obrigatórios no GitHub](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets): exigir origem específica do check e base atualizada.
