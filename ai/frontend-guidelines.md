# Diretrizes por domínio, frontend e UX

Carregar sob demanda: somente quando a tarefa tocar interface, UX, terminal,
backend SSH/WebSocket ou auth. Conteúdo movido sem alteração do `AGENTS.md`
em 2026-11-08 (backup em `ai/backup/codex-config-2026-11-08/`).

Princípio complementar: atue também como especialista em frontend, UX e design
de interface, priorizando clareza, consistência, acessibilidade, responsividade e
baixo acoplamento.

## Estratégia de debug

Quando o objetivo for investigar problema:

- primeiro identificar a causa provável
- depois validar o fluxo afetado
- só então sugerir correção
- não propor refatoração como primeira resposta
- considerar regressão, estado, evento, concorrência, foco, renderização, websocket e terminal buffer quando aplicável


## Estratégia por domínio

### Frontend / UX
Priorizar análise de:
- clareza do fluxo
- hierarquia visual
- responsividade
- acessibilidade
- consistência entre telas e componentes
- estados de loading, vazio, erro e sucesso
- feedback ao usuário
- microcopy
- navegação
- fricção desnecessária
- semântica HTML
- acoplamento entre UI e regra de negócio

### Terminal / xterm.js
Priorizar análise de:
- seleção
- copy/paste
- scroll
- resize
- foco
- input
- buffer
- renderização
- eventos de teclado/mouse

Toda alteração que possa mudar a área útil do terminal deve executar `npm run test:terminal-experience:web`. Alterações de resize, WebSocket ou transporte SSH devem executar também `npm run test:terminal-pty:real` contra um host descartável. Essas validações são opt-in e não podem adicionar sondagens, comandos ou latência ao fluxo normal do usuário.

### Backend / SSH / websocket
Priorizar análise de:
- sessão
- conexão
- stream
- concorrência
- fechamento de socket
- reconexão
- latência
- perda de estado

### Auth / acesso
Priorizar análise de:
- sessão
- permissões
- escopo de usuário
- isolamento de acesso
- expiração
- segurança

## Critérios obrigatórios para frontend

Sempre que tocar interface, validar mentalmente ou tecnicamente:

- A tela tem objetivo claro?
- O próximo passo do usuário está evidente?
- O CTA principal está claro?
- Existem estados de loading, vazio, erro e sucesso?
- A interface funciona em telas menores?
- Labels, foco e navegação por teclado estão minimamente corretos?
- O texto da interface está claro e direto?
- Há consistência visual com o restante do projeto?
- A alteração melhora a usabilidade ou apenas muda aparência?
- Existe forma mais simples de resolver com menos complexidade?


## Regras de UX e design

- Priorizar clareza antes de sofisticação visual
- Evitar poluição visual
- Destacar ações principais e reduzir peso de ações secundárias
- Minimizar esforço cognitivo
- Confirmar ações destrutivas ou de alto impacto
- Informar claramente erro, progresso e sucesso
- Evitar esconder informação importante atrás de interações desnecessárias
- Preferir interfaces previsíveis e consistentes
- Melhorar microcopy quando houver ambiguidade
- Não assumir que “mais elementos” significam melhor UX


## Regras de acessibilidade

- Preferir HTML semântico sempre que possível
- Garantir labels em inputs relevantes
- Garantir foco visível em elementos interativos
- Não depender apenas de cor para comunicar estado
- Garantir textos e botões compreensíveis fora de contexto visual
- Considerar navegação por teclado em fluxos importantes
- Em modais, dropdowns e overlays, considerar foco e fechamento adequados


## Estratégia de implementação frontend

Ao implementar ou ajustar interface:

1. entender o objetivo da tela ou fluxo
2. identificar o menor ponto de mudança possível
3. verificar se já existe componente ou padrão reutilizável
4. implementar preservando consistência visual e estrutural
5. validar estados principais da tela
6. revisar acessibilidade básica
7. apontar possíveis melhorias de UX sem expandir escopo sem necessidade


## Estratégia de revisão de componentes

Ao revisar componente frontend, verificar:

- responsabilidade única
- legibilidade
- facilidade de manutenção
- repetição de lógica
- repetição de estilos
- nomes claros
- props e eventos previsíveis
- acoplamento excessivo
- tratamento de estados
- impacto em mobile
- impacto em acessibilidade

## Saída ideal para tarefas de frontend

Quando a tarefa envolver interface, preferir responder no formato:

- objetivo da alteração
- causa do problema ou oportunidade de melhoria
- alteração sugerida
- arquivos afetados
- impacto em UX
- como validar rapidamente
- riscos ou trade-offs, se existirem
