# Webhooks — conclusão das melhorias pendentes

Implementação complementar a `2026-09-09-webhooks-resilience.md`.

## Funcionalidades

- **Editar inbound:** nome, descrição, eventos e segredo HMAC; provider permanece fixo. Segredo em branco preserva o atual. Erro mantém os campos para nova tentativa.
- **Rotacionar credenciais:** confirmação explícita troca, numa atualização, token da URL e segredo HMAC. Novos valores aparecem somente na resposta/modal; banco recebe hash do token e segredo criptografado. A ação não reativa endpoints pausados. Endpoints revogados não podem ser editados, rotacionados nem reativados. Salvar fica bloqueado durante a rotação.
- **Históricos paginados:** inbound e outbound carregam 25 registros por consulta, com “Carregar mais”. API mantém resposta em array para compatibilidade e aceita `beforeId` e `limit` (1–100). Ordenação por ID decrescente evita repetição de linhas entre páginas quando novos eventos chegam. Atualizar/filtro reinicia o cursor; resposta atrasada continua sendo ignorada.
- **Assinatura original:** parser encapsulado na rota pública inbound preserva o JSON original, incluindo espaços e Unicode. HMAC verifica primeiro esse corpo. O formato legado (`JSON.stringify` do objeto recebido) continua aceito para não quebrar emissores existentes. Limite de 256 KiB permanece. JSON inválido retorna HTTP 400.
- **Rejeições históricas:** somente depois de validar endpoint ativo, assinatura e tipo de evento, a chave de uma rejeição antiga pode ser liberada. A chave original fica em `normalizedEventJson.releasedIdempotencyKey`, junto ao contexto anterior, sem truncar ou sobrescrever a mensagem de erro. Registros aceitos não são liberados. Não há limpeza global nem exclusão de histórico.

## Arquivos principais

- `apps/frontend/src/views/admin/WebhooksView.vue`
- `apps/frontend/src/services/inbound-webhook.service.ts` e `webhook.service.ts`
- `apps/backend/src/modules/inbound-webhooks/{inbound-webhook.routes,inbound-webhook.controller,inbound-webhook.service,inbound-webhook.repository}.ts`
- Rotas, controller, service e repository outbound para paginação.
- Traduções PT/EN, testes do módulo e `tools/frontend/webhooks-resilience-playwright.cjs`.

## Validação

```bash
npm run test:webhooks:core
FRONTEND_BASE=http://127.0.0.1:5190 npm run test:webhooks:web
npm run typecheck -w apps/backend
npm run typecheck -w apps/frontend
npm run build -w apps/frontend
```

Typecheck de frontend/backend e build de produção passaram. A build registrou apenas os avisos de Browserslist desatualizado e tamanho de chunks.

66 testes automatizados passaram, incluindo as regressões anteriores. Casos novos: JSON original e legado, corpo inválido, limites de cursor, tenant derivado da autenticação, administrador obrigatório para rotação, token e assinatura antigos rejeitados após rotação, endpoint revogado, recuperação de chave histórica e isolamento SQL da paginação.

Simulação Playwright cobre os fluxos anteriores e edição com falha/retry, cancelamento e confirmação de rotação, valores exibidos uma vez e paginação dos dois históricos. Testes HTTP usam Fastify real com `inject`; persistência e transporte externos são simulados. Não houve envio a provedores, indisponibilidade real de banco/Redis ou deploy.

## Operação

Após rotacionar, atualize a URL e o segredo no emissor externo imediatamente. Não há período de coexistência com credenciais antigas. Se os novos valores forem perdidos, faça nova rotação. Publicar backend antes ou junto com o frontend, pois a nova interface usa o endpoint de rotação e parâmetros de paginação.

Nenhuma migration é necessária. A compatibilidade de assinatura legada é intencional; não foi imposta uma migração obrigatória a provedores existentes. A implementação não adiciona novos processadores de automação para eventos recebidos.
