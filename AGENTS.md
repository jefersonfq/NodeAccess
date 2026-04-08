# NodeAccess

Objetivo:
Plataforma web para acesso SSH via navegador, com foco em segurança, usabilidade, performance e manutenção simples.

Princípio principal:
Use contexto mínimo. Leia apenas o necessário para resolver a tarefa com precisão.

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

## Boas práticas obrigatórias

- Sempre trabalhar por módulo, arquivo ou fluxo específico
- Se a tarefa estiver ambígua, assumir o menor escopo razoável
- Antes de sugerir mudanças amplas, verificar se uma correção localizada resolve
- Se houver múltiplos caminhos possíveis, preferir o mais simples, previsível e fácil de manter
- Otimizar para clareza, manutenção e baixo custo de contexto

---

## Forma ideal de execução

Ao receber uma tarefa:

1. identificar o menor escopo possível
2. ler apenas o contexto mínimo necessário
3. localizar a causa ou ponto de alteração
4. propor a menor mudança funcional possível
5. evitar expansão desnecessária de contexto