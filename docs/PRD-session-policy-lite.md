# PRD Lite - Session Policy

Versao curta para evolucao da politica entre sessao web e sessoes SSH.

## Objetivo
- separar claramente o ciclo de vida da sessao web da sessao SSH
- definir comportamento seguro quando o token web expira
- permitir evolucao futura para manter sessoes SSH vivas sob politica controlada

## Estado atual
- expiracao da sessao web remove acesso a UI
- o frontend limpa tokens locais
- o frontend limpa abas/sessoes SSH abertas no navegador
- o usuario e redirecionado para login
- esta e a politica segura padrao atual

## Motivacao
- operadores podem ter sessoes SSH abertas por mais tempo que a sessao web
- o comportamento atual privilegia seguranca e simplicidade
- a evolucao futura precisa deixar explicito quando SSH pode sobreviver alem da sessao web

## Politica atual
- `web_expired => revoke_ui_access`
- `web_expired => clear_local_terminal_tabs`
- `web_expired => redirect_to_login`
- nenhuma sessao SSH deve permanecer reutilizavel pela UI apos expiracao web

## Politica futura a avaliar
- configuracao por tenant/admin para definir o destino de sessoes SSH existentes
- opcoes candidatas:
  - `close_immediately`
  - `keep_until_ssh_disconnect`
  - `keep_for_grace_period`
- a UI deve informar claramente qual politica esta ativa

## Regras de produto
- a sessao web continua sendo obrigatoria para navegar e operar na UI
- politicas mais permissivas para SSH nao podem reabrir acesso administrativo sem novo login
- qualquer politica avancada deve deixar auditoria e limites claros
- o padrao deve continuar sendo conservador

## Fora do escopo agora
- manter sessoes SSH vivas apos logout/expiracao com reattach completo
- registry global de sessoes SSH vivas no gateway
- encerramento remoto seletivo de sessoes ja abertas por politica dinamica
- grace period configuravel por tenant com persistencia em banco

## Arquivos provaveis
- frontend:
  - `apps/frontend/src/services/auth-session.service.ts`
  - `apps/frontend/src/composables/useTerminal.ts`
  - `apps/frontend/src/stores/terminals.ts`
- backend:
  - `apps/backend/src/modules/ssh/ssh.gateway.ts`
  - `apps/backend/src/modules/settings/*`
  - `apps/backend/prisma/schema.prisma`

## Proximo corte recomendado
1. expor politica atual de forma visivel em configuracoes/admin
2. desenhar modelo de politica futura sem implementar ainda
3. avaliar registry de sessoes SSH vivas no gateway
4. so depois decidir se vale suportar `keep_until_ssh_disconnect` ou `grace_period`

## Riscos
- confundir sessao web com sessao SSH
- manter SSH vivo sem clareza de auditoria
- reattach de sessoes antigas sem garantias suficientes
- expectativa do usuario divergir da politica ativa
