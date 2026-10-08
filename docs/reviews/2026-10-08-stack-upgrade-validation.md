# Atualização local da stack — validação em 08/10/2026

Implementação em worktree isolada `/tmp/nodeaccess-security-local`. Guacd e produção não foram alterados. O workspace original foi preservado; alterações e pontos de retorno estão nas branches Git do repositório original.

## Versões adotadas

| Componente | Versão/localização |
| --- | --- |
| Node.js | 24.21.0 LTS; `.nvmrc`, CI e imagens |
| Fastify | 5.12.5 com plugins compatíveis |
| Prisma/client | 6.19.3; override restrito de deepmerge-ts 8.0.2 |
| MySQL | 8.4.12 LTS em imagem derivada Oracle, usuário 999 e bibliotecas atualizadas |
| Redis | 8.2.10 em imagem derivada Alpine atualizada |
| Nginx | 1.30.5, bases fixadas por digest; módulo de imagem desnecessário removido |
| Vue / Vue I18n | 3.5.43 / 11.4.13 |
| Vite / Tailwind | 7.3.7 / 4.3.3 |
| TypeScript / Vitest | 5.9.3 / 4.1.11 |
| Certbot | 5.6.0; ambiente Python isolado e dependências fixadas, incluindo cryptography 50.0.0 e urllib3 2.8.0 |
| Guacd | 1.5.5, preservado por instrução explícita |

Prisma 7 foi avaliado e adiado: a árvore testada trouxe alertas no driver e exigia alteração de pool/TLS. A linha 6.19.3 passou pelos contratos reais do banco mantendo o driver existente. Não se adotou versão RC.

## Validação e regressões prevenidas

- 1.839 testes de unidade/serviços aprovados; integrações opt-in registradas separadamente.
- MySQL: migrations, conversão de autenticação antiga, atualização física 8.0 -> 8.4, transações, constraints, valores Unicode/JSON, senhas/segredos cifrados, contagens de todas as tabelas e restore em volumes novos 8.4/8.0. Failover e rejoin HA também validados.
- Redis: persistência AOF/RDB, TTL, estruturas, locks, Lua e pub/sub; indisponibilidade e recuperação de readiness da API.
- Stack em containers: login/MFA, refresh/logout, negativa de acesso entre tenants, migrations sem root, HTTPS, headers/cache, WebSocket, SSH com verificação explícita da host key, shell, resize PTY, SFTP e encerramento persistido da sessão. API/gateway encerram com SIGTERM sem kill forçado.
- Terminal visual/PTTY real revalidado. TLS/ACME validado com Pebble, incluindo emissão/renovação, falhas, recuperação e preservação da conexão SSH.
- npm audit completo: zero achados conhecidos. Semgrep e Gitleaks locais: resultados da revisão em NA-0047/0048. Imagens: zero Critical e nenhum High não revisado; dois registros High Oracle/FIPS permanecem visíveis e classificados por versões/fontes exatas, com expiração em 08/11/2026. Alertas Medium/Low continuam registrados.

O ensaio encontrou e tratou incompatibilidades concretas: UID do volume MySQL, mysql_native_password desativado no 8.4, arquivo de configuração Oracle não incluído por padrão, execução Prisma sem npm na imagem, precedência de cache Nginx e certificado da CA de teste incompatível com validação TLS mais estrita. O npm recente também passou a ter uma lista explícita de scripts de instalação aprovados por versão.

## Pontos de retorno

| Branch | Commit/escopo |
| --- | --- |
| security/NA-0045-20261008-frontend-build | 22daf49 — migração Tailwind validada |
| security/NA-0046-20261008-state-stack | 6feebf1 — MySQL/Redis, guardas de upgrade e restore |
| security/NA-0047-20261008-prisma-runtime | b0461d5 — Prisma e contratos reais |
| security/NA-0048-20261008-container-stack | fechamento das imagens, scanners e regressão integrada |

As branches são sequenciais. Para revisar ou voltar a uma etapa, crie outra worktree a partir da branch escolhida; não aplique reset sobre o workspace original com alterações não salvas. Rollback de código não reverte um volume MySQL atualizado: a recuperação ensaiada usa backup anterior em volume separado.

## Antes da publicação

Ainda não há pacote final distribuído. O target backend `prod` exige agentes atualizados e assinados; a falta da chave pública foi validada como bloqueio de build. A release posterior precisa gerar esses artefatos, repetir os gates com a base de CVEs atual e ser homologada com backup da instalação antes da atualização remota.

Esta atualização não encerra a revisão geral de segurança. Guacd foi mantido por decisão do usuário; CSP efetiva e redução de privilégios no perfil Compose permanecem trabalhos próprios. Não houve teste real com contas de provedores externos de SSO/1Password nem validação gráfica RDP/VNC.

Evidências detalhadas: `docs/changes/2026/10/NA-0046-state-stack/`, `NA-0047-prisma-runtime/` e `NA-0048-container-stack/`. Inventário de imagens em `docker/stack-images.json`; comandos e política em `security/README.md`.
