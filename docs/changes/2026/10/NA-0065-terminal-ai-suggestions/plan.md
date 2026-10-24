# NA-0065 — Consulta de IA junto ao cursor e assistente contextual

## Objetivo
Permitir pergunta cotidiana no terminal, sugestões com explicações e escolha pelo teclado, preservando investigação com contexto em um fluxo distinto.

## Implementação
- @ai/@ia + espaço abre pergunta local com foco junto ao cursor, dentro da área do terminal, reutilizando positionTerminalAutocomplete.
- Enter consulta; até três opções independentes; ↑/↓ escolhem; Enter insere sem quebra; Enter no terminal executa; Escape cancela.
- @ia-ass/@ai-ass + espaço abre o assistente contextual. Botão e Ctrl/Cmd+Shift+I preservados.
- API aceita pedido opcional de alternativas; retorno anterior continua válido. Deduplicação e política por alternativa.
- Aspas de apresentação simples normalizadas antes da política; aspas de argumentos preservadas; conteúdo ambíguo, markdown e controles não são inseridos.
- Proteções de sessão, entrada vazia, resposta tardia, timeout, retry e duplicidade mantidas. Sem buffer na consulta rápida.
- Manual e suíte de testes ampliados.

## Validação
Unitários específicos, suíte geral, Playwright em três larguras/claro/escuro, regressão terminal, manual/capturas, build e typechecks. Resultados e limites em implementation.md. Sem alteração de banco, resize ou transporte SSH; sem deploy.

## Correção após uso local
Mensagem genérica ocultava distinção entre policy e formato. Registro local mostrou comando seguro sem inserção permitida. Consulta agora expõe motivo e conteúdo recusado; normaliza Markdown de uma linha antes da policy e pede JSON nativo ao Ollama. Teste opt-in com modelo local cobre a frase reportada; sem executar SSH.

## Confiabilidade e recuperação implementadas
- Envelope estruturado nos quatro adapters (Ollama, OpenAI Responses, OpenAI-compatible e Anthropic), com validação comum no backend.
- Erros sanitizados por código, repetição somente explícita, pergunta preservada, estados de licença/permissão/configuração distintos.
- Deadline HTTP de 20s e cancelamento propagado ao provedor; frontend encerra em 21s. Cancelamento não dispara fallback nem abre circuito.
- Revisão conservadora restrita à inserção de sugestões no terminal; política global de outras automações preservada.
- Sistema do host remoto cadastrado no prompt e na revisão (Windows/Windows Server, Linux, macOS/FreeBSD); nenhum uso da plataforma do navegador.
- Assistente contextual com escolha de seleção/saída recente/ambas/nenhum texto, padrão recente, limite total de 8.000 caracteres e sem buffer duplicado.
- Dica de atalhos ao digitar prefixo; rascunho da consulta em memória na mesma sessão, limpo ao inserir/trocar contexto; contraste corrigido no tema claro.
- Auditoria de falhas por código sem conteúdo; suíte de modelo real opt-in para portas/Linux, disco/Linux e TCP/Windows.

## Diversidade da consulta rápida
Prompt multiopção separado do pedido unitário; recomendação mais alternativas realmente distintas quando adequadas. Testes reais contam alternativas aprovadas pela política e respeitam deadline de 20s. Sem mudar @ia-ass ou instruções gerais do tenant.
