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

As instruções estáveis ficam curtas e apontam para documentação sob demanda. Em 2026-11-08 (NA-0173) o AGENTS.md foi enxugado sem remover regras obrigatórias (checklists de frontend/UX movidos para `ai/frontend-guidelines.md`) e as regras de aprovação do Codex foram consolidadas; reversão em `ai/backup/codex-config-2026-11-08/ROLLBACK.md`. Evitar delegação redundante e repetir leituras cujo conteúdo não mudou.

## Cache e modelos: o que validar antes de adotar

Na API, prefixos reutilizáveis estáveis e dados variáveis ao final podem favorecer cache. Cache não reduz automaticamente a quantidade de texto enviada; preços, escrita de cache e retenção variam por modelo. Compare tokens de entrada/saída, cache lido/escrito, latência e custo real, respeitando isolamento e política de dados. Não acrescentar texto inútil para atingir cache nem migrar modelo só pelo preço unitário. Para tarefas simples, testar modelo de menor custo com critérios de qualidade; manter revisão reforçada para segurança, autorização, migração e protocolos.

Essas opções de API não são configurações garantidamente expostas nesta sessão do Codex. Não foram feitas chamadas pagas, trocas de modelo, alterações de cache ou mudanças de prompts do produto nesta frente.

## Validação e medição

Testes do resumo cobrem SHA diferente, árvore suja, falha de teste/scanner/gate, falta de revisão, relatório ausente/incompleto/malformado e ausência de conteúdo privado na saída. A evidência da frente NA0165 mede tamanho em bytes do catálogo versus resumo — apenas volume de informação exibido, não economia de tokens. Após uso real, medir por tarefa concluída: leituras repetidas, bytes expostos, tokens efetivos quando disponíveis, tempo e regressões.

## Fontes oficiais consultadas em 2026-11-04

- [Instruções AGENTS.md no Codex](https://learn.chatgpt.com/docs/agent-configuration/agents-md): descoberta hierárquica de instruções e limite configurável.
- [Prompt caching na API](https://developers.openai.com/api/docs/guides/prompt-caching): prefixos estáveis, contabilização e diferenças de cache por modelo.
- [Checks obrigatórios no GitHub](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets): exigir origem específica do check e base atualizada.

## Medição de 2026-11-08 (NA-0173)

Leitura das sessões locais do Codex de outubro e novembro (`token_count` dos rollouts):
cerca de 3,76 bilhões de tokens de entrada em 71 sessões principais (98% em cache) e
548 milhões em 267 sessões do revisor automático de aprovações. Maiores fatores: threads
únicas muito longas (uma com ~747 milhões), milhares de pedidos de escalação revisados um a um
(1.920 regras pontuais que quase nunca voltavam a casar) e leituras repetidas de `plan.md`,
`implementation.md`, `package.json` e da skill de lifecycle. Ações: thread por assunto,
regras genéricas de leitura/teste, temporários em `.tmp/`, saída limitada e instruções
sob demanda. A economia real deve ser medida nas próximas semanas com a mesma leitura.

### Como repetir a medição

`npm run ai:usage -- --since AAAA-MM-DD [--until AAAA-MM-DD] [--top N]` lê os registros locais
do Codex (`~/.codex/sessions`) e do Claude Code (`~/.claude/projects`, todos os projetos) e
imprime só contadores: sessões, entrada total/cache/fora do cache, saída, escalações, compactações
e as maiores sessões (nome do arquivo e contexto da última chamada). Nada de prompts ou comandos.
Rodar como o mesmo usuário dos agentes (root neste WSL). Linha de base de 2026-11-08 (01/10–08/11):
Codex 71 sessões / 3,76 bi (55 mi fora do cache), revisor 267 / 548 mi (48 mi fora do cache),
18.617 escalações; Claude Code 23 sessões / 2,27 bi (25 mi fora do cache), contexto máximo de
744 mil tokens com `opus[1m]`.

Limitação confirmada em 11/11: `--since` e `--until` selecionam arquivos pela data de
modificação, mas os contadores incluem todo o histórico de cada arquivo selecionado.
Esses totais não representam consumo restrito ao período e não sustentam comparação
semanal ou economia após os ajustes. Esse uso exige recorte por timestamps dos eventos
e diferenças dos contadores cumulativos; a correção continua pendente.
