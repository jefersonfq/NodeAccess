# Retorno ao tenant original — 24/09/2026

## Causa e comportamento esperado

“Gerenciar” chamava `enterTenantManagement` inclusive para o tenant de origem. O backend emitia um token com `actingTenantId` igual a esse tenant; portanto, o banner de modo delegado refletia um estado real, não apenas texto desatualizado.

Selecionar o tenant da sessão original deve restaurar essa identidade e encerrar o modo delegado. A origem é determinada pelo token original preservado, não por nome, slug ou ID fixo. Selecionar a origem sem delegação ativa não cria uma nova delegação.

## Correção localizada

`apps/frontend/src/stores/auth.ts` identifica o retorno à origem e usa a saída existente, com notificação de auditoria ao servidor e restauração do token original. O aviso desaparece porque a identidade original é restaurada. Uma falha de entrada não persiste mais uma cópia parcial do estado delegado. As regras de autorização no backend e a projeção de sessões por tenant não foram alteradas.

Para uma sessão já persistida em modo delegado no próprio tenant, selecionar novamente o tenant original ou usar a ação de sair do gerenciamento restaura a sessão preservada. Esta mudança não migra automaticamente sessões persistidas ao carregar a página.

## Testes reproduzíveis

```sh
npx vitest run apps/frontend/src/stores/auth-tenant-management.test.ts apps/frontend/src/services/host-open-sessions.service.test.ts
FRONTEND_BASE=http://127.0.0.1:5178 TENANT_RETURN_REVIEW=1 REPORT_PATH=/tmp/nodeaccess-tenant-return-review.json npm run test:terminal-experience:web
npm run typecheck -w apps/frontend
```

Os testes unitários cobrem retorno exato ao token original, seleção da origem sem delegação, múltiplos tenants, falhas 403/500, falha ao trocar de tenant delegado, falha na notificação de saída e recuperação de delegação persistida para o próprio tenant. Os testes de projeção verificam isolamento e preservação das sessões ocultas.

O cenário Playwright abre uma sessão de terminal, gerencia outro tenant pela tabela de tenants, verifica ausência da sessão em Hosts, retorna à origem pela mesma tabela e verifica o desaparecimento do banner, a restauração do token original e a reapresentação da sessão sem reconexão. Repete o ciclo duas vezes e verifica que não foi solicitada delegação para o tenant original. API/WebSocket simulados; nenhuma alteração ou validação em produção.

## Resultado

13 testes unitários aprovados, incluindo origem com ID diferente de 1; percurso visual aprovado em dois ciclos, sem erros de execução da página, sem delegação para a origem e sem nova conexão SSH. Typecheck frontend aprovado. Evidências locais: `/tmp/nodeaccess-tenant-return-review.json` e `/tmp/nodeaccess-tenant-return.png`.
