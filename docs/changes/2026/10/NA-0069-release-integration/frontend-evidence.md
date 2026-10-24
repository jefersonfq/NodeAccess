# NA-0069 — Integração e evidências frontend

Data: 2026-10-24T14:26:00-03:00. Base: `4e1b47f344f0e829b445254e4be2047da88eeeae`.

## Pedido e decisões
Integração autorizada de todas as frentes pendentes com a degustação, preservando o checkout original. Trabalho em `/tmp/nodeaccess-NA-0069`; nenhum commit/publicação realizado por este agente. Clientes nativos permanecem documentação/scaffold.

## Alterações
- Hosts: conflito resolvido combinando duplicação, breadcrumb e guardas assíncronas de edição/remoção de hosts próprios de trial. Nunca abrir o formulário normal como fallback do trial.
- Terminal: revisão da integração de macros/fila/IA com flags de degustação; IA e túneis continuam indisponíveis no trial. Biblioteca de snippets mantém execução, mas o painel recebe `readOnly` e não oferece CRUD nem consulta o Vault. Método puro da biblioteca renomeado de sort para select para evitar confusão com mutação de arrays na verificação Vue.
- Atualização de ACL em pasta recarrega também o bootstrap da navegação; a regressão independente encontrou um caminho antigo que ignorava erros/metadados após o primeiro carregamento.
- Cadastro público informa quotas iniciais/máximas, sessões, recursos e retenção antes do consentimento; campos adicionais opcionais preservam compatibilidade com respostas anteriores.
- Harness live aceita porta própria de API de trial e registra URL da API integrada; macro browser aceita modo trial e verifica ausência de CRUD/consulta de secrets.
- Manual: conflitos de imagens substituídos por cinco capturas novas do fluxo integrado. Texto do terminal distingue biblioteca somente leitura na degustação.

## Verificações executadas
- Frontend unitário: 73 arquivos, 659 testes aprovados; um SSH opt-in omitido nesta execução (revisor independente executou o transporte real).
- Tipos frontend aprovados após build shared e novamente após ajustes locais, conforme confirmação do agente principal.
- Unitários finais de biblioteca/trial: 21 aprovados.
- ESLint inicial encontrou avisos nas frentes integradas; todos foram corrigidos sem mudar regras. Gate global sem erros/avisos e tipos aprovados confirmados pelo agente principal após a correção final.
- `test:snippets:web`: página, editor e execução aprovados. Executor cobre legados, fila, cancelamento, timeout, regex em Worker, desconexão, ausência de reenvio por falha de auditoria e geometria.
- Execução de macros em modo trial: aprovada; sem controles CRUD e zero consultas ao Vault.
- `test:terminal-experience:web`: aprovado. `test:terminal-ai:web`: aprovado em claro/escuro, larguras 390/768/1440, erros/timeout/cancelamento/contexto/resposta tardia e inserção sem Enter.
- MCP onboarding: aprovado em três larguras, seis combinações agente/shell, cinco modalidades de probe, permissões e limpeza de segredo/contexto.
- Duplicação: seis combinações tema/largura aprovadas, falha/retry, permissão, cancelamento e duplo clique.
- Royal TS: simulações de importação/duplicatas/prévia/recuperação aprovadas; fixture sintética, sem aplicativo Royal TS instalado.
- Trial resources: três larguras aprovadas, quotas, falhas, credencial omitida na edição, exclusão confirmada e perfil normal sem consulta trial.
- Trial onboarding: 20 cenários em seis combinações tema/largura aprovados, incluindo quotas/retenção antes do aceite, consentimentos independentes, convite, cancelamento do participante e sessão normal preservada.
- Jornada real local: MySQL/Redis/Fastify/API/gateway integrados, login normal e trial com MFA, cadastro/verificação/ativação, expansão 1→3, CRUD de host próprio pelos menus, SSH e SFTP aprovados. Host público próprio foi apenas metadado, sem conexão à Internet. SMTP e provisionador foram simulados; SSH usou container descartável confiável e não comprova isolamento de VM de produção.
- `npm run test:terminal-pty:real`: top e htop aprovados contra SSH descartável; relatórios `/tmp/na0069-pty-real`, sem sondas no fluxo normal.
- `manual:capture` dev aprovado: cinco imagens inspecionadas; compartilhamento inclui 60 estados geométricos em dois temas. `test:manual`: 18 Vitest aprovados, verificações Node aprovadas.
- Páginas legais estáticas: 390/1440 sem overflow horizontal; capturas mobile inspecionadas, texto legível. Revisão visual não substitui a análise jurídica da frente principal.

## Limitações e próximos passos
Revisor independente confirmou logs de origem, dashboard e acesso recente completo em servidor Vite frio. Manifesto de Hosts/Terminal atualizado após revalidação; cinco capítulos aprovados no gate editorial. Build/artefatos assinados, certificados, backup e implantação remota pertencem ao agente principal. Nenhuma evidência local deve ser apresentada como validação do SMTP real ou isolamento real de VM.

## Gate de qualidade — 2026-10-24T14:32:00-03:00
O gate CI exige arquivos alterados completos sem avisos. Aplicada formatação ESLint apenas às fontes frontend candidatas em relação a origin/master e arquivos novos, sem mudar regras. Tipos de retorno e mocks receberam tipos explícitos; metadados do card de snippet foram movidos para um arquivo TypeScript compartilhado para resolver o tipo exportado do SFC na análise estática. Uma tentativa de inferência automática introduziu anotações temporárias incorretas em callbacks e foi corrigida antes de concluir; não houve commit/build entregue nesse estado. Revisor independente ajustou cinco testes sem reduzir as verificações. Reexecução frontend final: 73 arquivos/659 testes aprovados e um opt-in omitido. O agente principal confirmou lint global sem avisos e tipos aprovados após as correções.

## Fechamento editorial — 2026-10-24T14:43:31-03:00
Revalidados Hosts e Terminal após formatação e ajuste de atualização de ACL, mantendo procedimentos e capturas já inspecionadas. `manual:check-reviewed` e `manual:validate` aprovados para cinco capítulos. Reexecução de `test:manual` aprovada: 18 testes Vitest e verificações Node. UI congelada para os gates e commit do agente principal; nenhum commit realizado por este agente.

## Dependências atualizadas — 2026-10-24T14:58:15-03:00
Após instalação das dependências corrigidas e migração nativa para Zod 4/Fastify 5.12.7, repetidos em servidores Vite frios: jornada real normal/trial com MFA, cadastro/verificação/ativação, expansão 1→3, CRUD de host próprio, SSH e SFTP (PASS); `test:terminal-experience:web` (PASS); `test:terminal-pty:real` com top e htop (PASS, `/tmp/na0069-zod-pty`). API/gateway locais reiniciados com a árvore atual. Mantêm-se os limites: mailer/provisionador simulados e host SSH descartável confiável, sem prova de VM isolada.

A checagem de tipos identificou `LoginView.vue` usando o alias removido `ZodError.errors`. Corrigido para `issues`; a inclusão do arquivo no gate exigiu formatação local, retornos explícitos, tipo mínimo do Google SDK e tratamento explícito das promises de navegação, sem relaxar regras. Novo `tools/frontend/login-validation-playwright.cjs` passou com senha vazia: mensagem local, nenhuma requisição, nenhuma exceção; após correção, uma única requisição e recuperação de erro. ESLint do LoginView com `--max-warnings 0` e typecheck frontend final passaram. Jornada real completa repetida após essa correção também passou. Login não integra o mapeamento editorial; `manual:check-reviewed` segue aprovado nos cinco capítulos, sem atualizar hashes artificialmente.
