# Evidências — Prisma e runtime

Validação local em 08/10/2026. Base NA-0046, sem acesso a produção.

## Decisão e alterações

- Prisma/client 5.22.0 -> 6.19.3; remove flag fullTextIndex já estável, sem migração de tabelas de negócio. Mantidos engine, construção do client, datasources, pool e parâmetros TLS existentes.
- Prisma CLI e dotenv agora são dependências de produção: migrate deploy e scripts administrativos devem continuar disponíveis depois da remoção de ferramentas de desenvolvimento das imagens. Ferramentas do repositório declaram Prisma explicitamente na raiz.
- Override limitado a @prisma/config/deepmerge-ts 8.0.2 corrige vulnerabilidade da dependência transitiva. Loader real testado com schema/migrations/seed e falha de configuração; nenhum mock do merger.
- Prisma 7.10.0 com adapter-mariadb foi avaliado e descartado nesta etapa: npm reportou seis achados (cinco altos), incluindo mariadb/mysql2/deepmerge-ts. A migração também mudaria driver/pool/TLS. Não se adotou Prisma 8 RC. Reavaliar essa transição em tarefa própria quando as dependências estiverem corrigidas.
- Release oficial Prisma 6.19.3: https://github.com/prisma/orm/releases/tag/6.19.3 (patch de segurança de effect).

## Testes

- Geração Prisma 6.19.3 e typecheck completo: aprovados.
- npm security:check: zero achados conhecidos em todas as dependências; SBOM gerado em artifacts/security.
- Loader Prisma real com override: aprovado; adicionado ao workflow de compatibilidade.
- Suíte: 1.839 testes aprovados, 34 integrações opt-in não executadas nessa suíte.
- Primeira execução irrestrita apresentou timeout de 5s em exportação de auditoria sob concorrência de todos os workers e bancos. Reexecução com quatro workers: todos aprovados em 30s. Limite de quatro workers incorporado; timeouts/assertivas permanecem iguais.
- Upgrade/restore MySQL e persistência Redis com o novo Prisma: resultado estruturado em stack-upgrade.json.

## Limites

Auditoria npm não cobre SO nem guacd. Testes usam dados e credenciais descartáveis; ainda será necessário ensaio com backup da instalação antes do deploy. Nenhum artefato de release assinado ou atualização remota foi produzido nesta etapa.

Ensaio final de upgrade/restauração: aprovado. Foi corrigida corrida do harness que conectava ao Redis antes do readiness; usa PING, tentativas limitadas e fecha cada client malsucedido.

Semgrep: 729 arquivos, zero achados/erros. Gitleaks manteve 42 ocorrências públicas: duas exceções precisaram de revalidação porque NA-0046 mudou a imagem nos harnesses de restore. Diff revisado: somente mysql:8.0 -> imagem 8.4.12; fixtures de credenciais de laboratório permanecem as mesmas. Atualizados apenas os dois hashes exatos em security/gitleaks-fixtures.json.
