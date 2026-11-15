# PRD — Passagem de plantão e continuidade operacional

Data: 2026-10-30. Frente: NA-0084. Estado: corte3A autorizado para implementação, com central de notificações in-app;3B/3C permanecem propostas. Base local: f4a44b4b7ae87a8f688b1246d9e52a31f9a104bc. Documentação canônica em NodeAccess-current/docs. NA-0083 permanece LOCAL_WIP em checkout separado, sem commit/merge/deploy.

## Problema explicado na prática

Quem assume um atendimento precisa saber o estado atual, o que já foi tentado, o risco e a próxima ação. Hoje o contexto pode ficar em conversa, memória do operador ou sessão encerrada. A fase3 pretende registrar essa continuidade junto às evidências do NodeAccess.

Exemplo fictício: um link apresenta oscilações; o primeiro técnico registra a interface afetada, testes feitos, mitigação temporária e horário da próxima verificação. O colega lê, esclarece dúvidas e aceita continuar. A passagem fica datada. Encerrar a sessão ou terminar o turno não resolve a pendência automaticamente.

Há três conceitos distintos: resumo de um período, passagem de responsabilidade por uma pendência e concessão/transferência de controle SSH. A fase3 cobre os dois primeiros; o terceiro permanece na fase4 do roadmap. A pessoa pode aceitar uma pendência e depois abrir sessão própria com suas permissões.

## Pesquisa de mercado — evidência pública

Consultada em30/10/2026. Fontes primárias de práticas e produto; não houve testes comerciais, análise de preços ou garantia de disponibilidade por plano. Não há um formato universal obrigatório. As recomendações abaixo são uma síntese para o NodeAccess.

| Referência | Prática descrita | Aplicação proposta |
|---|---|---|
| [PagerDuty: normas de equipe](https://docs.pagerduty.com/ops-guides/going-on-call/setting-team-norms) | Passagem formal pode usar reunião, documento, e-mail ou consulta salva; inclui eventos recentes e assuntos em andamento | Modelo curto e consistente, com links para contexto |
| [incident.io: modelo assíncrono](https://incident.io/blog/async-on-call-handoff-template) | Resumo de incidentes, mudanças, contornos, tarefas e estado atual; confirmação de quem assume | Leitura assíncrona por padrão; conversa direta quando houver criticidade ou ambiguidade |
| [incident.io: passagem de incidente](https://incident.io/changelog/2023-05-03) | Substituição de respondente transfere papéis/ações e registra a mudança na timeline | Responsabilidade e histórico explícitos, separados de mensagem lida |
| [FireHydrant: respondentes](https://docs.firehydrant.com/docs/adding-responders) | Repasse de papel permite escolher também a transferência de tarefas incompletas | Exibir quais pendências estão sendo assumidas |
| [Atlassian: resposta a incidentes](https://www.atlassian.com/incident-management/handbook/incident-response) | Ticket, coordenação de pessoas e linha do tempo organizam o atendimento | Vincular chamado existente e evitar duas fontes conflitantes de estado |
| [Google SRE: gestão de incidentes](https://sre.google/sre-book/managing-incidents/) | Documento atualizado e confirmação explícita na passagem do comando | Pedido enviado não significa responsabilidade aceita |
| [Termy: colaboração](https://www.termy.one/) | Anuncia notas de turno com prioridade info/alerta/crítico, recebidas pelo próximo operador | Referência de simplicidade; a página não comprova semântica de aceite, concorrência ou ACLs |

Os produtos mostram mecanismos diferentes de atribuição; não inferir que todos exigem aceite bilateral. A política de aceite abaixo é recomendação própria, apoiada em continuidade operacional e prática explícita de handoff.

## Melhor formato proposto

Uma área **Plantão**, com lista priorizada de **pendências e avisos**, vinculados a host, sessão, auditoria e chamado. A troca de turno reúne esses mesmos registros em um resumo com período e remetente/recebedor; não cria cópias independentes das tarefas a cada turno.

O mesmo registro atende repasses pontuais entre técnicos. A preferência entre NOC com turnos e suporte pontual foi perguntada ao usuário; ainda não confirmada nesta versão. O modelo suporta ambos sem exigir escala automática.

| Alternativa | Avaliação |
|---|---|
| Texto livre único por turno | Fácil de preencher; mistura assuntos e dificulta identificar responsáveis e pendências herdadas |
| Novo sistema completo de incidentes/tickets | Exige escalas, SLA, canais e sincronização; duplica responsabilidades de ferramentas já usadas |
| Registros estruturados + resumo de turno | Recomendado: próximo passo claro, evidências locais e aceites rastreáveis, com pouco preenchimento |

### Conteúdo de cada registro

Obrigatórios para uma pendência: título curto, prioridade, situação/impacto atual, próximo passo concreto e responsável atual. Ao encaminhar: destinatário explícito. Horário da próxima ação é opcional no primeiro corte, mas recomendado para itens em observação; não transforma prioridade em SLA automático.

Campos complementares: ações executadas e resultado, mitigação/risco, bloqueio e dependência, links de evidência, chamado e instrução operacional existente. Separar fatos observados de hipótese. Evitar colar transcrição inteira ou credenciais.

Avisos informativos podem não ter ação ou dono operacional: nesse caso são identificados como aviso, com autoria e validade/revisão opcionais. Ler um aviso não equivale a assumir tarefa. Um período sem ocorrências pode ser confirmado manualmente como tal; ausência de auditoria ou telemetria não preenche esse estado automaticamente.

### Exemplo de leitura

| Campo | Exemplo fictício |
|---|---|
| Título | Oscilação no link do POP Norte |
| Prioridade e situação | Alta; serviço estável após mitigação, causa em investigação |
| Feito e observado | Rota alternativa aplicada; medições anexadas mostram redução de perda |
| Próximo passo | Verificar estabilidade às19h e atualizar chamado da operadora |
| Responsabilidade | TécnicoA; passagem proposta para TécnicoB, aguardando aceite |
| Evidências | Host autorizado, auditoria da sessão e chamado vinculado |

## Fluxo e regras de responsabilidade

1. Criar registro pelo host, auditoria ou área Plantão. Salvar rascunho sem notificar terceiros.
2. Revisar informações e selecionar pessoa de destino; encaminhar cria solicitação pendente.
3. Recebedor abre evidências autorizadas e escolhe **Aceitar responsabilidade** ou **Devolver com motivo**. Abrir tela ou receber notificação não aceita.
4. Aceite altera o responsável da pendência e grava autor, horário e versão aceita numa transação.
5. Trabalho continua como aberto, em acompanhamento ou concluído. Conclusão pede resultado; novo repasse cria outro evento preservando os anteriores.

Estado da solicitação de passagem (pendente/aceita/devolvida/cancelada) é separado do estado da pendência. Até o aceite, o responsável anterior permanece identificado. Se alguém sair, perder acesso ou não responder, a pendência fica visível como exceção para coordenação; nenhuma transferência ou conclusão silenciosa. Reatribuição administrativa deve ser explícita, justificada e auditada, sem fingir aceite do destinatário.

Destinatário individual no MVP; a equipe pode organizar a lista. Uma fila com vários destinatários capazes de assumir exige disputa atômica e política própria, ficando para evolução. Resumo de turno pode agrupar solicitações, mas o aceite inicial é individual por pendência, evitando aceite em massa sem leitura.

## Experiência proposta

Lista padrão: minhas pendências, aguardando meu aceite, encaminhadas e histórico, com filtros de equipe/host/prioridade quando autorizados. Mostrar estado, próximo passo, responsável, atualização e vencimento quando informado. Críticos e atrasados aparecem primeiro; usar texto/ícone, não só cor.

Ação principal contextual: encaminhar para quem prepara, aceitar para quem recebe, concluir para quem executa. Detalhe com conteúdo curto e linha do tempo de eventos. Links abrem evidência autorizada; “Abrir host” inicia fluxo normal de acesso, sem executar instruções ou assumir terminal.

Estados a validar: vazio, carregando, falha com nova tentativa, conteúdo alterado, destinatário indisponível, acesso revogado, evidência expirada e aceite concorrente. Mobile deve manter título/prioridade/próxima ação legíveis; labels, foco e navegação por teclado fazem parte do aceite. Sem modal obrigatório ao abrir todo SSH e sem reduzir área útil do terminal no primeiro corte.

## Permissões, evidências e integração

Tenant vem da identidade autenticada. Criar, ler, encaminhar e aceitar exigem política do módulo e verificação das referências. Autoria não concede acesso a host; aceite não concede senha, ACL, JIT, replay ou controle de sessão.

Antes de encaminhar, validar se o destinatário pode receber o contexto associado. Informação derivada de auditoria exige política de visibilidade tão restritiva quanto sua origem; não basta esconder o botão do replay se o texto já revelou seu conteúdo. Definir matriz concreta de equipe/host/auditoria na especificação técnica. Revalidar a cada leitura e aceite; revogação restringe o conteúdo e avisa a coordenação autorizada. Evidência expirada não é recriada ou copiada automaticamente.

3A guarda referência ao chamado Jira, sem sincronização de status/escrita externa. A pendência representa a continuidade no NodeAccess; o ticket externo continua sendo autoridade para seu próprio status. Mostrar claramente que estão separados. Links seguros, sem fetch automático de URL arbitrária. Não enviar mensagens Slack/e-mail nem criar issues como parte desta descoberta.

IA fica opcional para etapa posterior: sugere rascunho com referências e separação entre fato/hipótese; humano revisa antes de encaminhar. Não escolhe destinatário, não aceita, não encerra item e não executa comandos. Falha da IA mantém todo o fluxo manual utilizável. A fase3A não depende do merge da NA-0083.

## Cortes recomendados

| Corte | Entrega | Critério de aceitação |
|---|---|---|
| 3A — MVP | Pendências/avisos, evidências, encaminhar/aceitar/devolver, linha do tempo, lista e indicação de não aceites | Dois operadores continuam um caso sem perder contexto e sem ampliar acesso; concorrência e falhas cobertas |
| 3B — Visão de turno | Resumo por período/equipe, pendências herdadas por referência e registro explícito de turno sem ocorrências | Troca de turno não duplica tarefas nem encerra pendências; horário/timezone compreensíveis |
| 3C — Assistência opcional | Rascunho IA e integração Jira/canais após definir autoridade e permissões | Rascunho revisável; falha externa não perde o registro; nenhum envio/aceite automático |

Não incluir no primeiro corte: escala completa, telefonia/SMS, SLA complexo, escalonamento automático, substituição de ITSM, transferência SSH ou concessão temporária de acesso. Esses itens dependem de demanda confirmada e escopo separado.

## Plano de validação proposto — ainda não executado

Simulação funcional com2operadores e1coordenador: caso em observação, item crítico com dúvidas, devolução por falta de contexto, troca de turno sem pendência, falta de aceite e evidência indisponível. Pedir ao recebedor que explique estado/risco/próximo passo usando apenas o registro; documentar dúvidas antes de ampliar campos.

Testes backend: tenant/ACLs, destinatário removido, duas abas aceitando mesma versão, edição durante aceite, retry idempotente, falha entre alteração de dono e histórico, reatribuição administrativa e visibilidade após revogação. Testes browser: criação→encaminhamento→aceite→acompanhamento→conclusão, erros locais sem perder rascunho e desktop/mobile/teclado. Usar MySQL real para concorrência e transações; simulações não substituem homologação humana.

Métricas candidatas para piloto, sem baseline ou promessa de ganho: tempo até aceite, pendências sem responsável válido, solicitações devolvidas por falta de contexto e pendências herdadas esquecidas. Definir metas com a operação, não inventar percentuais.

## Decisões antes de implementar

Confirmar rotina prioritária (turnos/pontual/ambos), significado de equipe e responsável, visibilidade de notas derivadas, coordenação de não aceites, política de retenção e papel do Jira. Neste momento são hipóteses de produto; não bloqueiam a avaliação e não autorizam alteração de backend/SSH.

## Contrato inicial 3A — anterior à evolução gerencial

Estado: implementado e validado localmente, sem homologação humana ou deploy. As seções de descoberta acima preservam pesquisa e hipóteses; este corte delimita a entrega efetiva.

- Pendência acionável ligada a host: contexto, próximo passo obrigatório, prioridade, responsável e evidência opcional autorizada. Encaminhar não muda o dono até aceite; devolver exige motivo; concluir exige resultado; coordenador pode reatribuir explicitamente com motivo.
- Central in-app com lidas/não lidas, sino e navegação ao assunto. Leitura não implica aceite. Autorização atual do host/tenant e da auditoria é revalidada antes de mostrar dados.
- Domínio, eventos operacionais versionados e notificações separados; alteração e notificações persistidas na mesma transação. Registro de produtores permite novas origens sem acoplar regras de acesso à UI. O produtor integrado agora é passagem de pendências.
- Rascunho local preservado em erros, sem armazenamento de rascunho no servidor. Lista recente, sem escalonamento automático. Histórico de eventos/revisões, sem cópia integral de cada versão do texto.
- Avisos informativos independentes, chat, central genérica de tarefas, resumo de turno 3B, IA 3C e sincronização Jira permanecem propostas. Link de ticket não envia dados ao Jira.

[Fluxo com oito capturas](changes/2026/10/NA-0084-shift-handover/ux-walkthrough.md) · [Testes e limites](changes/2026/10/NA-0084-shift-handover/test-results.md) · [Arquitetura e operação](OPERATIONS-handover-and-notifications.md).

## Evolução autorizada: acompanhamento e visão de gestão

Esta evolução da NA-0084 amplia o corte operacional com filtros, prazo opcional de revisão, snapshots dos novos eventos, lembretes agrupados e quadro consolidado. O relatório foi considerado útil como fotografia operacional do recorte, sem avaliação individual de produtividade.

| Público | Visão | Limites |
|---|---|---|
| Operador | Pendências próprias, recebidas e encaminhadas; histórico e resumo pessoal | Participação e ACL atual |
| Administrador do tenant | Quadro geral, grupos/pessoas/hosts e concessões de leitura | Tenant atual e origem autorizada |
| Gestor autorizado | Tenant ou grupos explicitamente concedidos | ACL de host/auditoria continuam obrigatórias; sem ação por outra pessoa |

O quadro combina grupo de usuários, pessoa, host, prioridade e situação. Grupo considera dono atual ou destinatário que aguarda aceite. Indicadores mostram abertas/aguardando aceite/vencidas; agrupamentos ficam expansíveis, lista paginada em 20 e recorte limitado a 500 candidatos explicitamente sinalizado. CSV exporta esse recorte autorizado com horário/filtros, sem contexto livre e com proteção contra fórmulas.

Dashboards recebem um componente compacto de três assuntos e links para pendências/histórico do mesmo recorte. O dashboard do administrador identifica a visão do tenant; o usuário comum vê sua participação. Revisar até não é SLA e lembrete não é entrega proativa: resumo ao abrir/atualizar, com intervalo configurável e opção de desativar por usuário/tenant/navegador.

A implementação de chat, comentários, Jira, escala/fechamento de turno e tarefas de outros domínios permanece fora deste corte. [Fluxo e decisões de UX](changes/2026/10/NA-0084-shift-handover/evolution-ux.md).

Estado da evolução: validação técnica local concluída. [Evidências atuais](changes/2026/10/NA-0084-shift-handover/evolution-test-results.md); homologação humana e publicação pendentes.

## Consulta de plantão no terminal — implementação local

Indicador discreto por host em foco e painel flutuante somente leitura, com descrição autorizada, contexto, próximo passo e navegação ao detalhe. Deve preservar geometria, foco, conexão, fullscreen e tela dividida. Não promete total histórico: recorte recente autorizado com9+, cinco itens por página e atualização explícita. Erro distinto de vazio; notas privadas não anunciadas. Implementado e validado localmente, homologação humana/publicação pendentes. [Resultados](changes/2026/10/NA-0084-shift-handover/terminal-indicator-test-results.md).
