# PRD Lite - User Preferences

Versao curta para persistencia de preferencias por usuario.

## Objetivo
- salvar preferencias de UX no backend por usuario
- manter experiencia consistente entre navegadores e dispositivos
- reduzir retrabalho de configuracao manual

## Escopo inicial
- preferencias de terminal por usuario
- carregar preferencias no login ou bootstrap do app
- permitir ajuste em tela de perfil
- manter fallback local quando a API ainda nao tiver valor salvo

## Preferencias iniciais
- preset de plataforma: `auto`, `windows`, `linux`, `macos`, `custom`
- tema do terminal
- tamanho da fonte
- familia de fonte

## Regras
- backend e a fonte primaria quando houver valor salvo
- frontend pode usar `localStorage` como fallback e cache leve
- valores invalidos devem cair para defaults seguros
- preferencias nao podem afetar regra de negocio ou permissao
- alteracao de preferencia deve ser isolada de autenticacao e sessao SSH

## Fluxo esperado
1. usuario autentica
2. frontend busca preferencias do usuario
3. se existir valor salvo, aplica no estado global
4. se nao existir, usa fallback local ou preset automatico
5. ao editar no perfil, frontend persiste no backend e atualiza cache local

## Arquivos provaveis
- backend:
  - `apps/backend/prisma/schema.prisma`
  - `apps/backend/src/modules/users/*`
  - `apps/backend/src/modules/auth/*`
  - `apps/backend/src/shared/*` se houver DTO ou schema comum
- frontend:
  - `apps/frontend/src/services/user.service.ts`
  - `apps/frontend/src/stores/auth.ts`
  - `apps/frontend/src/views/ProfileView.vue`
  - `apps/frontend/src/composables/useTerminal.ts`
- shared:
  - tipos e schemas de preferencias do usuario, se o projeto centralizar isso

## Fora do escopo inicial
- sincronizacao por dispositivo
- preferencias de layout complexo por view
- import/export de configuracoes
- preferencias administrativas por tenant

## Ordem recomendada
1. schema e API de leitura/escrita
2. carregar preferencias no bootstrap do frontend
3. salvar pelo perfil
4. manter fallback local controlado
