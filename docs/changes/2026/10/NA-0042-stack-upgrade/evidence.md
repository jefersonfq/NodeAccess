# Evidências NA-0042

Estado LOCAL_VALIDATED; sem release, push, merge ou deploy.

- Node 24.21.0; Fastify 5.12.5 e plugins compatíveis; bcrypt 6.0.0, nodemailer 10.0.16, Vue i18n 11.4.13; Vite 7.3.7, Vitest/coverage 4.1.11, ESLint 10.12.0. Lockfile regenerado sem force/legacy-peer-deps.
- Suíte geral: {'passed': 1834, 'skipped': 34}. Typecheck backend/frontend e build completo aprovados.
- Auditoria npm de produção: zero achados conhecidos na consulta. Auditoria completa ainda registra 7 achados na cadeia do Tailwind 3 (build); tratar em branch de frontend separada para controlar regressões visuais. Não é garantia de ausência de vulnerabilidades.
- Chromium: terminal-experience e cache-settings aprovados.
- PTY real: top e htop aprovados em OpenSSH descartável. API de fixture sem banco/autenticação real; transporte SshSession/ssh2 e terminal real. Não equivale a homologar SSO ou o gateway completo em produção.
- SFTP real: 5 cenários aprovados; 1 cenário opt-in adicional não executado. Agent fault harness: 4/4.
- Lint dos helpers novos aprovado. Configuração ESLint migrada para flat config; a dívida de lint anterior do restante do workspace não é certificada por esse teste dirigido.
- Build mantém alerta conhecido de chunk vendor-ui de ~1 MB. Não houve mudança de layout nesta etapa.
- Protocolos/API existentes preservados. Guacd não foi alterado.
- Logs e relatórios detalhados em /tmp/nodeaccess-0042-*.

Fontes de compatibilidade: https://fastify.dev/docs/latest/Guides/Migration-Guide-V5/ e https://nodejs.org/en/about/previous-releases; versões/alertas consultados no registro oficial npm. Imagens de produção ainda exigem build e scan da versão candidata.
