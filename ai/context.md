Projeto: NodeAccess
Produto: plataforma web de acesso SSH via browser, estilo MobaXterm.
Meta: acesso centralizado, seguro e com baixa latencia.
Escala alvo: ate 300 usuarios.

Stack:
- frontend: Vue 3 + TypeScript + Naive UI + xterm.js
- backend: Node.js + Fastify + WebSocket + ssh2
- dados: MySQL + Prisma + Redis
- infra: Docker + Nginx

Monorepo:
- `apps/frontend`: UI, terminal web, auth, hosts, arquivos
- `apps/backend`: API REST, gateway WebSocket SSH, regras de negocio
- `packages/shared`: schemas e tipos compartilhados
- `ai`: contexto curto para agentes

Fluxo principal:
- browser -> WSS -> backend -> SSH -> host
- com bastion: browser -> backend -> bastion -> host

Dominios importantes:
- auth com JWT, refresh token e TOTP
- hosts com escopo pessoal, equipe ou global
- SSH com password ou PEM
- bastion host / jump server
- SFTP, snippets, tunel e agentes
- integracao com 1Password

Comandos uteis:
- `npm run dev`
- `npm run build`
- `npm run typecheck`
- `npm run test`

Regra de contexto:
- use este arquivo como base curta
- leia modulos de `ai/modules/*` so quando a tarefa tocar esse dominio
- consulte `docs/PRD.txt` apenas para regra de negocio detalhada
