# Webhooks: consistência e resiliência — 2026-09-09

## Interface

`apps/frontend/src/views/admin/WebhooksView.vue` usa o outbound como referência para largura de modais, agrupamento de campos, espaçamento do estado vazio e CTA primário do inbound. O formulário inbound separa origem de segurança/eventos. Modais e gavetas limitam a largura ao viewport; grades outbound passam a uma coluna em telas pequenas.

Melhorias funcionais:

- Recarregar após erro nas listas; falhas em pausar/ativar/revogar inbound exibem mensagem.
- Diálogos de revogação/exclusão permanecem abertos quando a operação falha.
- Criação inbound bloqueia submissão repetida, congela campos após sucesso e troca criação por “Concluir”; evita perder o primeiro token ao criar outro endpoint acidentalmente. Durante criação, fechamento por máscara, Escape e X não interrompe a apresentação do token.
- Respostas antigas não sobrescrevem consultas novas nos dois históricos; abrir outro endpoint limpa o detalhe anterior.
- Filtro inbound inclui todos os estados e acompanha o idioma.
- `api-auth-classification.ts` e `api.ts` mantêm recuperação local de erros transitórios nessas telas, sem recarregar a aplicação e perder formulários. A autenticação continua obrigatória.

## Backend

Inbound:

- Assinatura e lista de eventos são validadas antes de reconhecer duplicidade.
- Tentativas rejeitadas não reservam a chave única de idempotência. O motivo continua no recibo; a chave dessa tentativa rejeitada fica nula.
- Reutilizar chave com outro payload retorna rejeição `IDEMPOTENCY_CONFLICT`.
- Colisão entre inserções concorrentes consulta o recibo vencedor.
- Criação de recibo lê `LAST_INSERT_ID()` na mesma transação/conexão, evitando devolver outro recibo com payload igual.

Outbound, tanto entrega quanto teste de conectividade:

- Redirecionamentos HTTP são bloqueados para não contornar a validação do destino.
- Timeout permanece ativo durante leitura do corpo; falha nessa leitura não vira sucesso com resposta vazia.
- Segredo configurado que não pode ser descriptografado interrompe envio, em vez de enviar sem assinatura.

## Validação

```bash
npm run test:webhooks:core
FRONTEND_BASE=http://127.0.0.1:5178 npm run test:webhooks:web
npm run typecheck -w apps/frontend
npm run typecheck -w apps/backend
```

Typecheck de frontend/backend e build de produção do frontend passaram. Build registrou os avisos de Browserslist desatualizado e tamanho de chunks; não houve erro de compilação.

56 testes passaram: assinatura válida/inválida, repetição, conflito, corrida de inserção, endpoint pausado/revogado, evento não permitido, ausência de identidade, isolamento por tenant, falha no banco, HTTP 2xx/4xx/429/5xx, tentativas esgotadas, erro de rede, SSRF, corpo de resposta travado, segredo inválido e recuperação local autenticada.

Playwright passou com a tela Vue real e APIs simuladas: falha 503 e retry, campos obrigatórios, preservação de formulário, submissão repetida, token único, largura do modal em 390 px, erro ao pausar e recuperação, recibo com assinatura inválida, entrega com HTTP 503, teste de conectividade outbound com erro, largura de ambos os modais em celular e resposta antiga descartada no histórico. Capturas: `/tmp/nodeaccess-webhooks-inbound.png` e `/tmp/nodeaccess-webhooks-deliveries.png`.

## Impactos e limites

- Destinos que dependem de redirecionamento precisam configurar a URL final diretamente.
- A mudança de rejeição/idempotência vale para novos recibos; não limpa automaticamente chaves reservadas por rejeições históricas.
- Testes de banco, concorrência e rede usam doubles controlados. Não houve ensaio com MySQL/Redis reais, envio a provedores externos nem deploy.
- Inbound continua recebendo/normalizando eventos conforme a implementação existente; esta alteração não cria processadores de automação para cada tipo de evento.
- Melhorias futuras: edição e rotação de credenciais inbound pela UI; paginação dos históricos; assinatura sobre bytes originais para interoperabilidade com provedores que não usam o JSON serializado esperado atualmente; política explícita para rejeições históricas com chave reservada. Essas mudanças exigem contratos e validação próprios.

As quatro melhorias futuras listadas acima foram implementadas no complemento [Conclusão das melhorias](2026-09-09-webhooks-completion.md), incluindo política para chaves históricas e testes de regressão.
