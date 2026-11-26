---
change_id: NA-0204
title: Identificar gestores do cofre na administração de usuários
type: feature
status: blocked
created_at: 2026-11-25T19:32:51-03:00
base_branch: feature/NA-0203-20261124-vault-diagnostics
base_sha: 0ff5c1f9a8cf87c2b4715728ef7d91f96c37cf6e
branch: feature/NA-0204-20261125-users-vault-managers
owner: unassigned
planner: Codex
risk: medium
issue: null
---

# NA-0204 — Gestores do cofre em /admin/users

## Contexto e objetivo

Usuário aprovou mostrar quem é gestor do cofre, filtro e orientação, separados do papel ADMIN. O selo existente depende de administration-status, cujo contrato só devolve gestores ao próprio gestor. Um administrador sem esse papel não consegue identificar os responsáveis.

## Escopo aprovado

Expor somente o indicador de gestor ativo na listagem administrativa do tenant; reutilizar o selo e incluir explicação acessível e filtro no servidor antes da paginação. Gestor ativo exige nomeação enabled, usuário ativo e não excluído no mesmo tenant, conforme administração do cofre. Nenhum direito é inferido de ADMIN. Mostrar orientação compacta sobre os dois gestores iniciais pelo operador e dupla aprovação para alterações posteriores. Não criar checkbox de concessão nem liberar propostas, segredos ou ações a administradores comuns. Manter contrato de status do cofre e rotas de escrita inalterados.

## Critérios de aceitação

- ADMIN que não é gestor identifica gestores ativos do próprio tenant, incluindo usuário de papel USER; ADMIN sem nomeação não recebe selo.
- Filtro de gestores é aplicado antes da paginação, preserva busca e não retorna nomeações desabilitadas/inativas/excluídas ou outro tenant.
- Tooltip/explicação distingue gestão de acesso aos segredos; orientação inicial não afirma ausência de gestores com base na página atual.
- Não-ADMIN continua sem acesso ao endpoint administrativo; o indicador é somente leitura e não altera auth, grants ou dupla aprovação.
- Layout, teclado e textos PT/EN validados em desktop/mobile; falha da listagem não apresenta informação antiga como atual após mudança de contexto.

## Estratégia técnica

Contrato de item da listagem distinto de UserPublic genérico, sem alterar payloads de escrita ou sessão. Consulta em lote tenant-scoped a vault_managers; filtro e total coerentes. UI reutiliza NTag e controles existentes, com ajuda compacta. Sem migração, dependência ou polling adicional. Validar respostas tardias da listagem se necessárias para manter o filtro/contexto correto.

## Validação e evidência

Baseline frontend users-view e backend user.service/repositório; testes de consulta/isolamento/serialização/guards e comportamento do filtro; Playwright com fixtures sintéticas em desktop/mobile. Manual de Hosts mapeia UsersView: aplicar skill de manual com captura e revisão após validação. Tipos/lint e validate:sonar obrigatórios; revisão independente. Evidências privadas em .tmp/NA-0204/. Roadmap: uma escrita ao consolidar o resultado.

## Riscos, rollback e limites

Risco de confundir indicador com autorização: somente leitura e ações existentes intactas. Risco de falso vazio por paginação: filtro no servidor. Reversão por retirada do indicador/filtro sem alteração de dados. NA-0203 está COMMITTED localmente, não publicada/mesclada; esta branch depende desse SHA. Sem commit/publicação autorizados para esta nova frente.

## Aprovação

GO_WITH_RISKS: aprovação explícita do usuário à proposta de selo, filtro e orientação; implementação solicitada nesta interação. Não requer nova confirmação para o mesmo escopo. Baseline será registrada antes de editar aplicação.

## Correções necessárias de validação

O lint do controller tocado revelou 3 erros/17 avisos anteriores, fora do método list. Correção limitada à tipagem: retornos Promise<FastifyReply> e API multipart tipada, sem alterar chamada, resposta, autorização ou upload; teste HTTP multipart verifica o comportamento. O novo teste SQL entra no runner MySQL existente para não ficar apenas em um comando temporário. A lista da UI descarta respostas antigas após filtro/tenant/saída da tela; mudança local de leitura, sem alterar autenticação.

## Resultado local

Implementação e validações técnicas concluídas. Validação formal bloqueada por `REVIEW_CHECKOUT_CHANGED`, sem contorno do guard ou commit não autorizado. Detalhes, falhas preservadas e limites no registro de implementação.
