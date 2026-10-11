# Revisão documental e datasheets — 24/09/2026

## Escopo e método

Revisão técnico-comercial baseada no código e na documentação locais. Referência Git: `e833542`, acrescida das alterações presentes no workspace, inclusive trabalhos ainda não publicados. A edição documental é `2026-09`, não uma afirmação de versão instalada do produto.

Foram lidos contexto, padrões, PRD curto, contexto funcional e resumo de valor. A conferência dirigida usou registro de rotas, capacidades de protocolos, políticas de autenticação, serviços de integração, telas relevantes, deploy e relatórios de compatibilidade. Não foi feita leitura integral de todos os arquivos nem homologação de produção. Nenhum endpoint privado, credencial ou dado de cliente foi necessário.

O estado “implementado” significa presença de caminho funcional no código, não disponibilidade automática em qualquer contrato/ambiente. Os PRDs incluem intenções futuras; enum, item de menu e nome de script de teste isoladamente não comprovam operação completa.

## Matriz de evidências

Os caminhos abaixo são relativos à raiz do repositório.

| Afirmação | Fonte principal conferida | Decisão editorial |
|---|---|---|
| Áreas operacionais e administrativas | `apps/frontend/src/router/index.ts`; `apps/backend/src/server.ts` | Separar usuário, tenant e plataforma |
| SSH/Telnet funcionais; serial sem transporte | `apps/backend/src/modules/ssh/ssh.gateway.ts`; `packages/shared/src/protocols/access-protocol.capabilities.ts` | Não vender serial operacional |
| RDP/VNC via guacd | `apps/backend/src/modules/graphical/graphical-session.adapter.ts`; `charts/nodeaccess/values.yaml` | Informar dependência gráfica |
| Operações SFTP | `apps/backend/src/modules/sftp/sftp.routes.ts` | Não generalizar a todos os protocolos |
| ACL e inventário corporativo | `apps/backend/src/modules/inventory/inventory-acl.routes.ts`; `docs/PROJECT-functional-context-nodeaccess.md` | Remover indicação de que toda ACL é futura |
| Importação e formatos | `apps/backend/src/modules/host-imports/host-import.routes.ts`; `docs/PROJECT-functional-context-nodeaccess.md` | Informar limites de credenciais proprietárias e rollback |
| Compartilhamento e supervisão | `apps/backend/src/modules/shared-sessions/shared-session.routes.ts`; `apps/backend/src/modules/session-supervision/session-supervision.routes.ts` | Permissões, expiração e controle explícitos |
| Destaques pessoais e administrativos | `apps/backend/src/modules/terminal-highlights/terminal-highlight.routes.ts`; `apps/frontend/src/router/index.ts` | Diferenciar apresentação de saída/auditoria |
| MFA e política por tenant | `apps/backend/src/modules/auth/auth-policy.ts`; `apps/backend/src/modules/auth/tenant-auth-policy.service.ts` | Manter obrigatoriedade atual de MFA; não inferir opção de desabilitar a partir da interface genérica |
| Criptografia AES-256-GCM | `apps/backend/src/shared/crypto.ts` | Não estender afirmação a todo armazenamento |
| LDAP implementado | `apps/backend/src/modules/auth/ldap-identity.provider.ts` | Autenticação/provisionamento no login; não declarar sync completo |
| OIDC e grupos | `apps/backend/src/modules/auth/oidc-auth.routes.ts`; `apps/backend/src/modules/auth/oidc-group-mapping.routes.ts` | Incluir no contexto e no datasheet |
| SCIM Users/Groups | `apps/backend/src/modules/auth/scim.routes.ts` | Declarar subconjunto; bulk/password/sort/ETag não suportados |
| Compatibilidade Entra | `docs/changes/2026/08/NA-0018-entra-oidc-certification/test-results.md` | Testes locais/metadados não são login real homologado |
| Compatibilidade Okta | `docs/changes/2026/08/NA-0019-okta-oidc-certification/test-results.md` | Homologação exige organização controlada |
| Providers e AWS futuro | `apps/backend/src/modules/integrations/integration.service.ts`; `apps/frontend/src/views/admin/IntegrationsView.vue` | AWS é “em breve”, não integração entregue |
| Auditoria derivada | `apps/backend/src/modules/session-audit/session-audit.routes.ts` | Reconstrução pode ser incompleta |
| Replay textual existente | `apps/frontend/src/views/admin/SessionAuditDetailView.vue` | Corrigir “apenas evolução” no contexto funcional |
| Agentes/conectores | `apps/backend/src/modules/agents/agent.service.ts`; `docs/PROJECT-functional-context-nodeaccess.md` | Não prometer substituição universal de VPN |
| IA, MCP, ActionRuns e diagnósticos | `apps/backend/src/server.ts`; `apps/backend/src/modules/features/features.routes.ts`; `docs/PROJECT-functional-context-nodeaccess.md` | Configuração, licença, escopo e revisão humana |
| Piloto TACACS+ | `docs/PRD-network-access-lite.md`; `apps/backend/src/modules/network-access/network-access.routes.ts` | Não declarar homologação multivendor/produção |
| Entitlements em uso | `apps/backend/src/modules/features/features.routes.ts`; `apps/backend/src/modules/license/license-entitlement.service.ts` | Não criar planos ou preços não aprovados |
| Imagens e Docker CLI | `docker/backend.Dockerfile`; `scripts/release/build-release.sh`; `scripts/deploy/prepare-nodeaccess-host.sh` | Próxima imagem construída; endpoint do daemon é configuração separada |
| Compose e serviços | `docker-compose.prod.yml`; `scripts/deploy/install-nodeaccess.sh` | Implantação e atualização, sem executar deploy |
| Kubernetes | `charts/nodeaccess/values.yaml`; `docs/DEPLOY-kubernetes-oidc-lite.md` | Réplicas não garantem HA do estado; MySQL/Redis externos ao chart |
| HA de dois nós | `docs/OPERATIONS-ha-node-install-and-actions.md`; `docs/PROJECT-functional-context-nodeaccess.md` | Sem SLA, migração transparente de SSH ou RPO/RTO inventados |
| Observabilidade | `apps/backend/src/modules/observability/observability.service.ts`; `apps/frontend/src/views/admin/ObservabilityView.vue` | Local, carga por núcleo e backups por idade/presença |
| Portas e serviços opcionais | `apps/backend/src/config/env.ts`; `docker-compose.prod.yml`; `charts/nodeaccess/values.yaml` | Portas de referência, não requisito de publicação pública |
| Capacidade/latência | `ai/context.md`; `docs/PRD-lite.md` | 300 usuários e 50 ms p95 são metas, não benchmark ou SLA |

## Divergências corrigidas na documentação de referência

1. **Serial:** contexto funcional listava terminal textual; capacidades e gateway indicam que não há transporte operacional.
2. **ACL corporativa:** PRD curto ainda descrevia o conjunto como evolução em estudo e afirmava apenas pastas pessoais. Atualizado para coexistência de organização pessoal e inventário corporativo com herança.
3. **Replay:** contexto apresentava como evolução; a tela de auditoria possui playback. Atualizado com dependência de captura/artefatos.
4. **LDAP/OIDC/SCIM:** contexto incompleto; LDAP tem autenticação/provisionamento no login, OIDC e SCIM possuem endpoints próprios. Limites foram registrados.
5. **AWS Secrets Manager:** descrição genérica podia sugerir disponibilidade. Marcado como futuro, conforme interface e providers implementados.
6. **Kubernetes:** acrescentada a opção Helm e suas dependências externas ao contexto funcional.
7. **Mapa de acessos:** caso de uso atualizado para relatório de sessões, destino da rota legada.
8. **Metas comerciais:** 300 usuários e latência p95 não equivalem a resultados homologados, sessões simultâneas ou SLA.

Não se reescreveu todo PRD histórico: documentos de planejamento permanecem como histórico/contrato de evolução. O datasheet e o estado conferido no PRD curto devem orientar a apresentação de capacidades atuais.

## Entregáveis e manutenção

- Fonte principal: `docs/DATASHEET-NodeAccess.md`.
- Índice das edições: `docs/datasheets/README.md`.
- Completo, comercial, técnico/funcional e infraestrutura/operação: PDF e HTML; edições segmentadas também em Markdown.
- Gerador: `tools/docs/build-datasheets.cjs`, usando `marked` já presente na árvore de dependências e Playwright existente. Nenhuma dependência foi adicionada. Não editar manualmente as edições derivadas.
- Regerar: `node tools/docs/build-datasheets.cjs`; opcional `CHROMIUM_PATH` para selecionar o executável. Padrão: `/usr/bin/chromium-browser`.
- Validações de geração: `docs/datasheets/validation.json`; imagens de revisão em `/tmp/nodeaccess-datasheet-review/`.

## Validação e limites

A validação desta tarefa é documental: estrutura, links internos, existência das fontes, consistência das edições, geração e inspeção visual dos PDFs. Não houve alteração de código de aplicação, autenticação, terminal ou transporte. Não foi necessário repetir a suíte funcional da plataforma.

Os relatórios históricos de testes citados na matriz conservam suas datas e limites. A existência desses relatórios não significa que todos os testes foram reexecutados nesta revisão, nem que a versão de produção corresponda ao workspace.

### Resultado da validação documental

- 46 referências de arquivos conferidas: nenhuma ausente.
- 13 links locais no índice e nos documentos novos: nenhum destino ausente.
- PDFs gerados: completo 13 páginas; comercial 5; técnico/funcional 9; infraestrutura/operação 6.
- Geração Chromium sem erros de página; estrutura HTML sem células vazias ou valores acidentais `undefined`/`[object Object]`.
- Ghostscript abriu e extraiu texto dos quatro PDFs. Capítulos e termos essenciais foram conferidos na extração.
- Inspeção visual de capa, proposta de valor, tabela de integrações e requisitos; ajustadas quebras que isolavam parágrafos em páginas adicionais.
- `node --check tools/docs/build-datasheets.cjs` e `git diff --check` dos documentos de referência: aprovados.

A extração textual com Ghostscript complementa a geração; não é dependência do script de geração. Essas verificações validam os documentos e sua apresentação, não o funcionamento dos recursos descritos.
