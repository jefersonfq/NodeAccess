# NA-0084 — Plantão 3A e central de notificações

Estado: implementado e validado localmente; publicação e homologação operacional pendentes. Código em `/tmp/nodeaccess-NA-0084`, branch `feature/NA-0084-20261030-shift-handover`. Documentação canônica em NodeAccess-current/docs. Base: f4a44b4b7ae87a8f688b1246d9e52a31f9a104bc.

## Entrega e fluxo simplificado

A área Plantão registra pendências por host com situação, próximo passo, prioridade e responsável. Pode ser acessada pela navegação ou pelo painel do host. O fluxo é criar → encaminhar → destinatário recebe notificação → revisar → aceitar/devolver → concluir com resultado. Leitura, aceite e conclusão são ações separadas. Até o aceite, o responsável anterior permanece.

Devolução registra motivo e permite corrigir contexto; edição fica bloqueada enquanto há encaminhamento pendente, que pode ser cancelado pelo responsável. Administrador pode reatribuir com justificativa, incluindo quando o responsável foi desativado. Esse evento não é apresentado como aceite do destinatário.

A central oferece sino com indicador, não lidas/todas, marcação individual e abertura da pendência. Cada usuário vê somente suas notificações e assuntos atualmente autorizados. Título/host são consultados após autorização; conteúdo não é copiado para uma caixa permanente acessível sem a origem. Rótulos descrevem o evento passado, não afirmam que uma pendência antiga ainda está aberta.

O badge atualiza ao abrir/focar e em polling de60s quando autenticado/visível. Não usa o transporte SSH nem garante entrega instantânea. Contagem visível limitada a99+, com indicação explícita. Lista e central têm paginação por ID; a lista é de registros recentes com tags de prioridade, não escalonamento automático por criticidade. Falha local não recarrega a aplicação inteira.

## Estrutura desacoplada

| Parte | Responsabilidade | Pontos principais |
|---|---|---|
| Pendências | Estado, responsável, revisão, visibilidade e transições | `modules/handovers`, `HostHandover` |
| Eventos operacionais | Registro durável versionado de ação/ator/revisão e correlação da requisição | `OperationalEvent`, contrato `OperationalEventV1` |
| Notificações | Caixa por destinatário, estado lido/não lido, consulta autorizada e apresentação | `modules/notifications`, `UserNotification`, registro de produtores `NotificationSource` |
| Frontend | Serviços HTTP, invalidação por identidade/tenant/ACL e componentes de apresentação | `useOperationalContext`, serviços handover/notification-center, views e sino |

Mudança de estado, evento e notificações pertencem à mesma transação MySQL. Se qualquer gravação falhar, nada do comando é confirmado. `requestId` com hash do comando evita efeitos duplicados; reutilizar a chave com outro conteúdo gera conflito. A revisão aceita deve ser a revisão corrente; requisição com revisão futura também é recusada.

O evento guarda versão1, tipo da entidade, ID, tipo de ação, ator/destinatário e revisão. Razões/resultados são protegidos pela autorização do domínio. Novos eventos preservam snapshots de título, contexto, próximo passo, prioridade, prazo e link de ticket. Eventos legados sem snapshot exibem essa ausência; não é possível reconstruir o texto antigo que não foi armazenado. A consulta do snapshot continua sujeita às permissões atuais da origem.

A central recebe um registro de produtores, cada qual fornecendo autorização atual e resumos permitidos. Tipos desconhecidos são ocultos; propriedades herdadas do objeto não são tratadas como produtores. Frontend usa destinos conhecidos, sem aceitar URL arbitrária de deep-link.

### Evoluções suportadas pelo desenho, ainda não implementadas

- Outros módulos podem registrar seus eventos e produtor autorizado, sem alterar a máquina de estados do plantão. Somente o plantão publica nesta entrega; notificações legadas de outros módulos não foram migradas automaticamente.
- Uma futura central de tarefas pode apresentar as pendências existentes e adicionar outros tipos, preservando origem e responsável. Evitar criar uma tarefa duplicada para cada notificação.
- Chat futuro pode referenciar host/pendência e produzir notificações próprias. Definir quem participa e quem pode consultar antes de exibir mensagens. Não criar conversa automaticamente ao aceitar uma passagem neste corte.
- Integração Jira futura pode consumir eventos com checkpoint/outbox, retry e chave de idempotência por evento/destino. O consumidor deve revalidar permissões, definir autoridade de status, evitar ciclos e permitir tentativa manual. Não há worker/exportação externa conectado agora.

O registro de eventos é durável, mas não é um broker distribuído nem um sistema de entrega externa pronto. Checkpoint, contratos de payload necessários a cada destino, retenção e recuperação do consumidor pertencem à implementação de cada adaptador.

## Acesso, falhas e limites

Backend obtém tenant da identidade e consulta usuário ativo/role/sessionVersion atuais. Acesso ao conteúdo exige participação, administração ou concessão vigente de leitura gerencial, além da permissão atual do host; evidência de auditoria exige também política da origem e correspondência de host/tenant. Não há concessão automática de credenciais, ACL ou terminal. Aceite não executa comandos.

Host excluído ou auditoria removida pode tornar o conteúdo inacessível mesmo para coordenação, preservando os registros no banco. Não existe restauração automática ou exportação alternativa para contornar ACL. A política de retenção/arquivamento desses dados deve ser definida antes de crescimento prolongado; esta versão não apaga histórico automaticamente.

Consultas de não lidas fazem autorização em lotes e param após o limite visível; muitos registros históricos sem acesso ainda podem exigir várias consultas. Não houve teste de carga de longa duração, e não se promete capacidade/latência específica.

A passagem exige próximo passo: aviso independente sem ação, escala completa, escala/resumo fechado por turno3B, SLA automático, chat e sincronização Jira permanecem evoluções. O rascunho é local ao formulário aberto; não é salvo como tarefa no servidor até a criação. O link de ticket aceita HTTP/HTTPS sem credenciais e somente abre o destino, sem fetch automático.

## Migração, validação e recuperação

Migração aditiva `20261030143500_na0084_handovers_notifications` cria `host_handovers`, `operational_events` e `user_notifications`, com índices e chaves de idempotência. Nenhuma tabela anterior é removida ou alterada. O laboratório aplicou o SQL sobre o schema completo da base com usuários/host existentes e comprovou sua preservação; não representa teste de toda a cadeia histórica de migrations/upgrade da VPS.

Publicação autorizada deve seguir o deploy padrão e sua etapa de migração antes de liberar o novo frontend/API. Não executar scripts do laboratório contra banco existente. Para rollback, voltar ao código anterior preservando as tabelas e colunas aditivas; não apagar pendências/eventos/notificações. As entradas novas ficarão inacessíveis pela interface antiga até recuperação apropriada.

Com Node24, Docker e dependências/shared/Prisma preparados no checkout:

```bash
npm run test:handover:core
npm run test:handover:lab
npm run test:handover:web:lab
npm run test:manual
```

O laboratório cria MySQL/Redis descartáveis com nomes exclusivos/portas loopback e credenciais sintéticas, aplica schema base+SQL novo e remove seus containers/volumes em finally. `PLAYWRIGHT_EXECUTABLE_PATH` pode selecionar Chromium instalado. O browser usa dois contextos autenticados separados, rotas reais de plantão/notificações/hosts autorizados e fixtures somente para partes externas da aplicação. Inclui uma503 simulada para verificar preservação do formulário. Não acessa VPS, SSH ou Jira. Interrupção abrupta pode exigir conferir recursos com prefixo `na0084-`; não usar prune global.

[Guia visual com as oito capturas](changes/2026/10/NA-0084-shift-handover/ux-walkthrough.md). [Evidências e limites](changes/2026/10/NA-0084-shift-handover/test-results.md). [Manual do usuário](manual/handover.md).

## Quadro gerencial, relatório e dashboards

A evolução acrescenta `/handovers/board` para acompanhar abertas, aguardando aceite, revisões vencidas, pessoas e hosts. Filtros de grupo/pessoa/host/prioridade/situação se combinam. Responsável e destinatário pendente podem aparecer nos agrupamentos por pessoa: não somar essas linhas como um total de pendências distintas. Não há ranking de produtividade.

`HandoverBoardGrantsService` administra concessões explícitas por usuário do tenant para todo tenant ou um grupo de usuários. Só ADMIN atual pode conceder/revogar. A associação ao grupo usada no recorte é do responsável atual ou do destinatário atual quando pending; não usa participantes antigos. União das concessões é intersectada com os filtros e ACL de host/auditoria. Grupo inválido/deletado não vira acesso geral. Não há elevação de role nem poderes de edição, aceite ou conclusão.

Concessões e revogações são eventos auditados no mesmo banco, com idempotência de requestId. Replay de uma concessão antiga após revogação não restaura acesso; uma ação nova precisa de nova identidade. Revogação afeta requisições posteriores; não promete apagar conteúdo já visto ou CSV já baixado. O tenant vem do JWT, não do filtro.

`HandoverBoardService` limita cada seleção a 500 candidatos recentes e sinaliza `truncated`. Contadores são sobre itens autorizados dentro dessa seleção. A UI pagina em blocos de 20; CSV exporta o recorte limitado inteiro, independentemente da página. Filtros adicionais podem refinar a consulta. CSV é gerado sob autorização novamente, com data/filtros/limite, sem contexto livre/próximo passo/snapshots, e neutraliza células interpretáveis como fórmulas. Alterações entre a consulta e o download podem mudar o resultado; não é um snapshot histórico imutável do tenant.

Dashboards reutilizam `HandoverSummaryWidget`: três itens, indicadores e links. Dashboard de ADMIN identifica visão operacional do tenant; usuário identifica assuntos de que participa. Host usa leitura gerencial quando concedida e participação nos demais casos. Link de histórico mostra concluídas no recorte atual, não organograma antigo. Não existe agregação de turnos com fechamento e assinatura neste corte.

## Prazos e lembretes

`dueAt` é instante opcional, enviado em ISO com offset, armazenado no banco e exibido no fuso do navegador. Vencimento considera pendências abertas. Não define SLA nem executa escalonamento. Novos eventos guardam esse prazo no snapshot; pendências antigas recebem null.

Lembretes são consulta agrupada ao abrir/atualizar a central (`/handovers/reminders`), para owner/destinatário atuais com espera desde o último `sent`. Intervalo entre 1 e 720 horas e exibição habilitada/desabilitada são preferências locais por usuário/tenant. Canceladas, aceitas e sem ACL são excluídas. Não há scheduler, push/email, novas notificações por consulta ou efeito sobre a responsabilidade.

## Migração adicional

`20261030171000_na0084_handover_board` adiciona `due_at` nullable e tabela `handover_board_grants`. Aplicar após a migração inicial desta frente. Preservar colunas, concessões e eventos em rollback; o código antigo deixa de expor a nova funcionalidade. Laboratório ensaia ambas sobre o schema base com dados sintéticos, sem migração de produção.

[Decisões de UX e roteiro da evolução](changes/2026/10/NA-0084-shift-handover/evolution-ux.md). O laboratório ampliado usa operadores, gestora e administrador com APIs reais do plantão e fixtures externas para o shell/dashboards históricos. Não testa login completo, MFA, entrega externa ou upgrades históricos completos.

[Evidência técnica atual da evolução](changes/2026/10/NA-0084-shift-handover/evolution-test-results.md).

## Consulta compacta no terminal (NA-0084)

GET `/api/v1/handovers/terminal` recebe hostId, mode indicator/details e cursor autorizado. Serviço separado reutiliza políticas de participação/gestão, tenant, host e auditoria. Varredura em lotes100, máximo1000 metadados; contagem9+, detalhes5 e cursor derivado de item permitido. Hidratação condicionada a id/revision impede retornar conteúdo novo após mudança concorrente. Nenhuma migração adicional para o indicador.

Frontend mantém apenas metadados em cache volátil45s/64entradas, deduplica consultas e invalida identidade/ACL. Notas não são persistidas. Overlay não envia comandos, não chama fit/resize e não cria polling contínuo fechado. Execute `test:handover:core`, `test:handover:terminal:web` e `test:handover:terminal:lab` (frontend local e navegador configurados). [Evidências e limites](changes/2026/10/NA-0084-shift-handover/terminal-indicator-test-results.md).
