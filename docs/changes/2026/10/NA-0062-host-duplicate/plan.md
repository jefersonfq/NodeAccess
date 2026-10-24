# NA-0062 — Duplicar host
## Objetivo
Duplicar configuração pelo menu contextual ou menu de ações, abrindo novo cadastro para revisão. Criar somente ao salvar; manter host original intacto.
## Escopo
Reaproveitar formulário e POST existentes. Copiar campos explicitamente permitidos, vínculo às pastas existentes, descrição, tags, protocolo/perfil, rota explícita, referências acessíveis de credenciais e macro. Links associados viram cópias manuais sem IDs/origem de sincronização. Nome recebe indicação de cópia, IP vazio, porta mantida.
Não copiar IDs/tenant/ACL específica, senha local, confiança SSH, histórico, sessões ou links de compartilhamento. Permissões herdadas do destino continuam aplicáveis. Macro não é duplicada: conserva referência.
Bloquear descarte silencioso de relação indisponível; manter rascunho em erro e impedir requisição dupla enquanto salvando.
## Arquivos principais
HostsView.vue; services/host-duplicate.ts e teste; locales pt-BR/en; tools/frontend/host-duplicate-playwright.cjs; manual Hosts e manifesto.
## Validação
Unitários de transformação e serviços de host; Playwright claro/escuro em 390/768/1440, contexto e ações, falha na origem, permissão ao salvar, relações indisponíveis, usuário sem criação, cancelamento e clique duplo. Suíte geral, typecheck/build, regressão de formulário e validação/captura do manual. Resultados observados no implementation.md.
## Compatibilidade e recuperação
Sem endpoint, migration, dependência ou alteração de transporte. Reversão pelo diff da frente, preservando mudanças locais de outras frentes.
