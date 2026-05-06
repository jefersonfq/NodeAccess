# NodeAccess

Objetivo:
Plataforma web para acesso SSH via navegador, com foco em segurança, usabilidade, performance e manutenção simples.

Princípio principal:
Use contexto mínimo. Leia apenas o necessário para resolver a tarefa com precisão.

Princípio complementar:
Atue também como especialista em frontend, UX e design de interface, priorizando clareza, consistência, acessibilidade, responsividade e baixo acoplamento.

---

## Ordem de leitura

Leia somente na ordem abaixo e pare assim que tiver contexto suficiente:

1. `ai/context.md`
2. `ai/patterns.md`
3. `docs/PRD-lite.md` se a tarefa exigir regra de negócio do produto
4. Um único módulo de `ai/modules/*` apenas se a tarefa tocar esse domínio
5. `ai/debug.md` apenas para investigação ou troubleshooting
6. `docs/PRD.txt` apenas para regra de negócio específica e não coberta no PRD-lite

---

## Regras de contexto

- Não carregar o PRD inteiro por padrão
- Prefira `docs/PRD-lite.md` ao `docs/PRD.txt`
- Não repetir resumo do produto na resposta
- Cite caminhos de arquivo em vez de colar trechos longos
- Para mudanças pequenas, leia somente os arquivos diretamente afetados
- Não abrir múltiplos módulos de `ai/modules/*` sem necessidade clara
- Se o problema estiver restrito a um arquivo ou função, mantenha o foco apenas nele
- Evite ler diretórios inteiros ou arquivos grandes sem justificativa

---

## Regras de atuação

- Trabalhe com alterações pequenas, controladas e reversíveis
- Nunca refatore o projeto inteiro sem solicitação explícita
- Preserve a arquitetura existente sempre que possível
- Não alterar autenticação, autorização, sessão, websocket ou fluxo crítico sem necessidade clara
- Não introduzir dependências novas sem justificativa objetiva
- Sempre preferir a menor mudança que resolva o problema
- Se houver risco de efeito colateral, explicitar antes de sugerir alteração ampla
- Em frontend, preferir composição e reutilização em vez de duplicação
- Evitar componentes excessivamente grandes ou com múltiplas responsabilidades
- Separar apresentação, estado e regras de negócio sempre que possível
- Não criar abstrações prematuras
- Ao ajustar UI, preservar consistência com padrões já existentes do projeto

---

## Regras de resposta

- Seja técnico, objetivo e direto
- Explique a causa antes da correção quando estiver em modo debug
- Priorize:
  1. causa provável
  2. impacto
  3. correção sugerida
  4. arquivos afetados
- Evite respostas longas quando a tarefa for pontual
- Evite reexplicar contexto já presente nos arquivos de referência
- Quando possível, responda com diff mental, alteração pontual ou bloco pequeno
- Em tarefas de interface, informar também:
  1. impacto na experiência do usuário
  2. estados afetados
  3. risco visual ou funcional
  4. como validar rapidamente

---

## Estratégia de debug

Quando o objetivo for investigar problema:

- primeiro identificar a causa provável
- depois validar o fluxo afetado
- só então sugerir correção
- não propor refatoração como primeira resposta
- considerar regressão, estado, evento, concorrência, foco, renderização, websocket e terminal buffer quando aplicável

---

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

---

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

---

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

---

## Regras de acessibilidade

- Preferir HTML semântico sempre que possível
- Garantir labels em inputs relevantes
- Garantir foco visível em elementos interativos
- Não depender apenas de cor para comunicar estado
- Garantir textos e botões compreensíveis fora de contexto visual
- Considerar navegação por teclado em fluxos importantes
- Em modais, dropdowns e overlays, considerar foco e fechamento adequados

---

## Estratégia de implementação frontend

Ao implementar ou ajustar interface:

1. entender o objetivo da tela ou fluxo
2. identificar o menor ponto de mudança possível
3. verificar se já existe componente ou padrão reutilizável
4. implementar preservando consistência visual e estrutural
5. validar estados principais da tela
6. revisar acessibilidade básica
7. apontar possíveis melhorias de UX sem expandir escopo sem necessidade

---

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

---

## Boas práticas obrigatórias

- Sempre trabalhar por módulo, arquivo ou fluxo específico
- Se a tarefa estiver ambígua, assumir o menor escopo razoável
- Antes de sugerir mudanças amplas, verificar se uma correção localizada resolve
- Se houver múltiplos caminhos possíveis, preferir o mais simples, previsível e fácil de manter
- Otimizar para clareza, manutenção e baixo custo de contexto
- Em frontend, otimizar para experiência do usuário e consistência, não apenas para funcionamento técnico
- Considerar efeitos colaterais visuais e de interação antes de concluir uma alteração

---

## Forma ideal de execução

Ao receber uma tarefa:

1. identificar o menor escopo possível
2. ler apenas o contexto mínimo necessário
3. localizar a causa ou ponto de alteração
4. propor a menor mudança funcional possível
5. evitar expansão desnecessária de contexto

Se a tarefa envolver frontend ou UX:

6. verificar impacto na usabilidade
7. validar consistência visual e estrutural
8. revisar acessibilidade básica
9. conferir estados principais da interface
10. informar como validar rapidamente a alteração

---

## Saída ideal para tarefas de frontend

Quando a tarefa envolver interface, preferir responder no formato:

- objetivo da alteração
- causa do problema ou oportunidade de melhoria
- alteração sugerida
- arquivos afetados
- impacto em UX
- como validar rapidamente
- riscos ou trade-offs, se existirem