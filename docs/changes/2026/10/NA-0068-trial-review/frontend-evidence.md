# Frontend e integração local — NA-0068

Registro: 2026-10-24, America/Sao_Paulo. Base `66444a9dd4c167453004bb6089278548bdd2c0d9`; árvore de trabalho ainda sem commit final. Node 24.21.0 e dependências instaladas pelo lock do projeto (frontend Vite 7.3.7, Vitest 4.1.12).

## Entrega

- `/trial`: cadastro com termos obrigatórios e consentimentos opcionais independentes; confirmação por fragmento apagado imediatamente; capacidade de gestão em sessionStorage; provisionamento, ativação, convites, preferências, encerramento e recuperação de erros. Não altera a sessão normal existente. Login posterior usa o fluxo normal e MFA.
- `/platform/trials`: configuração parametrizada, perfil inicial não salvo, prontidão informada, prazo, quotas, recursos, rede, retenção e aviso antes da expiração; cancelamento confirmado.
- `/trial/audits`: consulta e download somente leitura, condicionados ao recurso audit e licença global; não reutiliza controles administrativos mutantes.
- Menu indica prazo; recursos indisponíveis de agentes/túneis/JIT não fazem consultas de bootstrap. Terminal respeita SFTP/sharing do perfil, oculta links próprios/JIT e túneis na degustação.

## Validações executadas

- Frontend typecheck passou; lint dos arquivos novos passou sem erros. Arquivos legados features/useTunnelPresence apresentam apenas avisos preexistentes de tipos de retorno.
- Unitários dos serviços trial/features: 18/18. Trial contém 17 casos. Após a suíte completa revelar importação de browser no teste Node de túneis, `tunnel-presence.test.ts` passou a simular explicitamente featuresService e aguardar sua etapa assíncrona no teste de concorrência; 5/5 passaram, incluindo não consultar túneis em trial e falha de capabilities. Nenhuma alteração de produto foi necessária para esse ajuste do teste.
- `tools/frontend/trial-onboarding-playwright.cjs`: 20 casos em seis combinações (390/768/1440px, claro/escuro), incluindo teclado, formulário inválido, falha503, consentimentos, fragmento, senha divergente, convites/quotas/consentimento próprio, cancelamento parcial, link expirado, flag desligada, sessão normal, administração e auditoria habilitada/desabilitada. HTTP/WebSocket simulados. Evidência local `/tmp/nodeaccess-trial-browser/results.json` e capturas.
- `trial.mysql.test.ts`: 8/8 casos com MySQL real, dois clientes Prisma, Fastify/JWT e ACL reais; SMTP e provisionador simulados. Reexecutado após a migration 148 de notificações de ciclo de vida em 2026-10-24T11:44:53-03:00: 8/8 passaram em 4,62 s. Log local `/tmp/na0068-mysql-trial-tests.log`. Cobre preservação de tenant normal, concorrência, snapshot, expiração sem worker, ACL, convite/cancelamento de participante, falha/retry de limpeza e negação administrativa.
- `tools/frontend/trial-live-playwright.mts`: PASS final em `2026-10-24T14:38:54Z`, sem erros JavaScript ou HTTP. MySQL, Redis/limitação de cadastro, rotas Fastify, login e MFA de contas normal/trial via interface, Hosts, gateway/SSH com saída de comando e SFTP reais. A conta normal permanece ativa. SMTP e provisionamento/isolamento de VM são explicitamente simulados; o SSH usa destino descartável confiável local. Evidência `/tmp/na0068-live-browser/result.json`.
- `npm run test:terminal-pty:real`: top e htop passaram em SSH real. A ferramenta usa JWT sintético da fixture; a autenticação normal foi validada separadamente no ensaio live. O wrapper fecha sua própria aba após cada caso por `CLOSE_TEST_SESSION=1`, impedindo que a primeira conexão bloqueie a segunda quando multi-connect está desligado. Evidências `/tmp/na0068-pty-real/top.json` e `htop.json`.
- `npm run test:terminal-experience:web`: passou após ajustes finais; evidência `/tmp/na0068-terminal-experience.json`.
- `manual:capture`, `test:manual` (18 testes e compilador), inspeção das cinco imagens e `manual:check-reviewed` passaram. A captura inicial exigiu ajustar a expectativa de versão do ensaio para `dev`; a repetição passou. Procedimentos normais preservados, notas de degustação adicionadas a Hosts/Terminal, hashes editoriais atualizados.

## Defeitos encontrados pelos ensaios e resolvidos

ACL de hosts provisionados não herdava inicialmente view/connect; convite cancelado perdia gestão própria; contagem de usuários omitira reservas; fingerprint OpenSSH sem padding divergia da comparação existente; bootstrap chamava recursos proibidos; login inicial abria lista rápida vazia. As correções foram exercitadas novamente. O ensaio PTY inicialmente preservava sua própria sessão anterior; o cleanup opt-in corrige o procedimento de certificação, sem comandos adicionais no fluxo de usuários.

## Limites

Não certifica provedor real de VMs, entrega de e-mail, isolamento de hypervisor, site público ou implantação remota. Não prova ausência absoluta de defeitos. Backups, restauração, build2.1.0 e implantação pertencem à frente principal. Credenciais e tokens não constam desta evidência.

## Ampliação de escopo — máquinas e hosts próprios (24/10/2026)

O perfil administrativo ganhou máquinas iniciais, máximo de máquinas de demonstração, permissão de hosts próprios e quota própria, respeitando o limite total. `TrialResourcesPanel.vue` apresenta capacidade, solicitação de quantidade total, progresso, falha com retry automático do provisionador e atalho para ver hosts. `TrialCustomHosts.vue` oferece cadastro/edição por senha ou PEM e remoção confirmada, sem exibir credenciais persistidas. O cadastro aceita somente IPv4 público autorizado; redes privadas/DNS/bastions/agentes permanecem fora desse fluxo.

Edição e exclusão pelo menu do card também encaminham ao formulário dedicado. O painel resolve o perfil e aguarda seus dados; um trial não recai no formulário administrativo quando a consulta ainda não terminou. Ações incompatíveis de mover/alterar ACL/dashboard foram retiradas desses menus somente para trial. Após criar, editar, remover ou disponibilizar máquinas, os caches de hosts/inventário são invalidados antes da atualização. O ensaio real identificou esse problema de catálogo antigo, corrigido e revalidado.

- Teste dos componentes reais com HTTP simulado: 11 casos × três larguras (390/768/1440), incluindo quota total, validação,503 com seleção preservada,provisionamento,refresh,perfil normal sem endpoints trial,403 preservando formulário,quota própria,credencial omitida na edição e confirmação de exclusão. Evidência `/tmp/na0068-trial-resources-browser/results.json`.
- Serviços trial e presença de túneis: 24/24 passaram, incluindo uso exclusivo da API autenticada nas mutações e normalização PASSWORD/PEM recebidos do backend.
- Jornada real ampliada: PASS em `2026-10-24T16:51:59.076Z`, zero erros HTTP/JavaScript, expansão de1 para3 máquinas em SQL, cadastro/edição/exclusão própria via UI/API, criptografia e preservação da credencial, menus dos cards encaminhando corretamente, normal login/MFA/Hosts preservados e SSH/SFTP do laboratório reais. O endereço público usado no cadastro foi apenas metadado descartável; nenhuma conexão foi estabelecida com ele. SMTP e provisionamento seguem doubles explícitos. Log `/tmp/na0068-live-resources-browser.log` e captura `resources-real.png`.
- Regressão `test:host-form-tabs:web`: seis combinações de largura/tema passaram, com oito gravações e dois testes de conexão simulados por combinação. Typecheck e lint escopado passaram.
- `manual:capture` repetido, cinco imagens inspecionadas; teste manual e gate editorial repetidos após incluir os dois componentes no mapeamento de Hosts. Houve falhas transitórias de importação em servidores Vite concorrentes; a instância de teste passou a usar cache de dependências exclusivo, e a captura completa voltou a passar. O teste de compartilhamento ganhou apenas evidência de falha na inicialização e passou em60 estados.

Nenhuma alteração de autenticação normal, instalação Windows ou implantação remota foi executada por esta frente.
