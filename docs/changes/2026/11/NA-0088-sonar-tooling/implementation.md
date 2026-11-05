# NA-0088 — Registro da implementação

## Pedido e objetivo

Tratar todos os 270 achados de tooling/scripts atribuídos na revisão SonarQube autorizada pelo usuário em 03/11/2026, com branches recuperáveis, testes, simulações e evidência individual.

## Implementação

Base SHA `3aa5513789d63ef24b3e268c5f2077fde7db616e`; branch `fix/NA-0088-20261103-sonar-tooling`; execução no worktree `/tmp/nodeaccess-NA-0088`. Nenhum teste foi executado no checkout canônico nesta frente.

- Artefatos locais passam a usar raiz privada por UID/worktree. O helper rejeita root público, symlink, travessia e owner diferente; nomes e overrides explícitos permanecem. Foram migradas 119 expressões em 78 scripts e o relatório Python. Caminhos remotos sintéticos permanecem dados de fixture. O workflow manual-pilot acompanha os novos caminhos.
- Esperas sem prazo recebem deadline monotônico, diagnóstico e teste de callback ausente; quatro loops já limitados a 100 tentativas foram mantidos após revisão. Guards de payload, fechamento WebSocket aguardado e extração de alpha corrigem falhas dos harnesses.
- Parsers de email, atribuição env, frontmatter/trailers, nome de captura e métrica evitam backtracking ambíguo. Edição env preserva LF, CRLF e mistura de finais de linha, backup privado e symlink do deploy.
- Harnesses live Jira/HA exigem destino explícito antes da conexão. HA exige HTTPS fora de loopback e não ignora certificados. Harness Nginx valida certificado fixture com SAN correto.
- `dispositions.json` contém 272 keys únicas após a reanálise: 270 originais e 2 novas; 139 `fixed`, 133 `context_reviewed`; tabela humana em `findings.md`. Revisão de contexto não fecha achados no servidor nem representa aprovação de risco em produção. Não foram alteradas regras, exclusões ou thresholds Sonar.

## Validação

Ran no worktree, Node 24 e Chromium headless instalado, frontend isolado na porta 5198:

| Validação | Resultado | Evidência |
|---|---|---|
| Node test: shared helpers, governança, TLS manager, trial installation e release provenance | 69 testes, 69 passam, 0 skips | `evidence/node-tests.txt` |
| Nginx real em Docker, perfis HTTP/HTTPS/prod/k8s | 24 verificações passam; certificado verificado | `evidence/nginx-headers.json` |
| Observabilidade claro/escuro, rede/503/403, dados antigos e recuperação | Passa; 15 requests por tema; largura 390 sem overflow; runtimeErrors vazio | `evidence/observability.json` + capturas |
| Terminal lifecycle, edição SFTP, concorrência, compartilhamento, navegação e reconexão simulados | 12 cenários passam, runtimeErrors vazio | `evidence/terminal-lifecycle.json` |
| Manual integrado | Passa, 5 capítulos; popup sem reconexão, busca, mobile, falhas/retry | `evidence/manual.json` + captura |
| Trial onboarding | Claro/escuro e 1440/390 passam com API simulada | `evidence/trial-onboarding.json` |
| Platform settings | Persistência/reflexo do perfil e geometria mobile passam | `evidence/platform-settings.json` |
| Sharing flows | JIT, PIN, falhas/retry, expiração e viewer autenticado passam | `evidence/sharing-flows.json` |
| Sintaxe | 83 arquivos JS via node --check; 13 TS via transpile diagnostics; Python via ast.parse | Não é typecheck completo |
| Governança | validatePlan, validateImplementationRecord e quatro validateCommit passam; diff --check passa | Execução local |
| Consumidores de artefatos | Globs locais encontram diretórios privados de manual/observabilidade; YAML mantém upload manual nos novos destinos | CI GitHub não executado nesta frente |

Comando consolidado: `node --test tools/shared/*.test.cjs scripts/change-governance.test.mjs tools/tls/manager.test.mjs tools/deploy/trial-installation.test.mjs tools/deploy/release-provenance.test.mjs`.

Falhas iniciais registradas: manual esperava versão 9.8.7 enquanto Vite expunha dev; repetição com `MANUAL_EXPECTED_VERSION=dev` passou. Lifecycle usava botão Editar, mas menu usa NDropdown; papel menuitem também não encontrou o controle. Seleção pelo texto exato do item passou nos 12 cenários; não houve mudança no app.

Revisão visual das capturas de observabilidade: cards e mensagens legíveis, linhas quebradas dentro de 390px, sem overflow horizontal. Toast transitório de erro sobrepõe título no mobile; comportamento preexistente registrado, sem expansão de interface. Não há alegação de ausência de toda poluição visual ou homologação humana. Nenhuma simulação certifica SMTP, VM remota ou rede de produção.

## Recuperação

Quatro commits locais de código separados por lote, com no máximo cinco correções lógicas por lote. Reverter cada lote desfaz comportamento correspondente. Não houve deploy, push, migração nem conexão à VPS; credenciais do usuário não foram usadas. Diretórios antigos de artefatos são preservados; overrides podem manter destinos anteriores se explicitamente desejado. Containers Nginx criados pelo harness foram removidos pelo finally; Vite 5198 e cache Python próprios são encerrados/removidos ao finalizar.

## Pendências

Revisão independente do root, integração e reanálise Sonar serial. Não houve execução de todos os harnesses de implantação, Kubernetes, HA/Jira live ou PTY real: endpoints live só receberam testes negativos/guard e revisão; não existe máquina descartável autorizada para esses fluxos nesta frente. Não houve typecheck completo do monorepo nem execução do workflow GitHub.

A planilha viva e índices globais são coordenados pelo agente principal junto à iniciativa de qualidade/Sonar; não editados por esta frente para evitar concorrência. Documentos desta frente devem existir também em `NodeAccess-current/docs/changes/2026/11/NA-0088-sonar-tooling` antes da entrega global.

## Diário de interações

### 2026-11-03T14:10:00-03:00 — Delegação e escopo

Usuário autorizou todos os achados e commits em branches separadas. Recebidas 270 ocorrências de tooling; inventário examinado por contexto, sem reproduzir credenciais operacionais. Fronteiras de arquivos de outros agentes preservadas.

### 2026-11-03T14:32:21-03:00 — Correções e validação local

Raiz privada de artefatos aprovada pelo root, incluindo consumidores manual-pilot. Revisão diferenciou fixtures, execução CLI confiada e riscos reais. Quatro lotes de código concluídos; 69 testes consolidados, 24 verificações reais Nginx e seis famílias de simulação browser passaram. Mensagens dos commits locais foram ajustadas para a governança, sem alterar suas árvores. Próximo passo: validação documental, cópia canônica e revisão independente; nenhuma homologação humana ou publicação inferida.

### 2026-11-03T14:58:49-03:00 — Dois alertas novos após integração

A reanálise identificou S905 em recent-host-access-playwright e lucien-feedback-ux-playwright: o require do helper havia antecedido use strict, tornando-o expressão sem efeito. Diretiva restaurada como primeira instrução após shebang; nenhum alerta suprimido. Conferidas as seis diretivas use strict existentes em tools/scripts: nenhuma outra ficou precedida por import/require. Sintaxe, diff e teste de prologue em VM passam. Browser recent-host-access passou desktop/mobile, favoritos, falhas de metadados/pastas, IPv6 e hierarquia; lucien-feedback-ux passou 14 cenários. Evidências em evidence/followup-*.json. Executados novamente no worktree e Vite 5198, não no checkout canônico; Vite próprio encerrado. Duas ocorrências novas adicionadas à tabela, mantendo as 270 originais. Próximo passo: integração e confirmação de ausência na nova análise pelo root.
