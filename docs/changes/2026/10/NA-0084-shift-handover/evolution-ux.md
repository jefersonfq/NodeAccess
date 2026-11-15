# Evolução do plantão — decisões de fluxo e UX

Estado: implementado e validado localmente; homologação humana pendente. [Testes e limites](evolution-test-results.md).

## Objetivo por tela

| Tela | Pergunta que resolve | Próxima ação |
|---|---|---|
| Minhas pendências | O que está comigo ou esperando meu aceite? | Abrir o assunto e agir |
| Central de notificações | O que mudou e o que ainda aguarda resposta? | Consultar contexto; leitura não aceita responsabilidade |
| Quadro de plantão | Onde a equipe precisa de atenção agora? | Filtrar grupo/pessoa/host e consultar a pendência |
| Dashboard pessoal | Há alguma pendência que exige minha atenção? | Abrir minhas pendências/histórico |
| Dashboard do host | Que trabalho está aberto ou foi encerrado neste host? | Consultar assunto autorizado |

## Hierarquia e densidade

Três indicadores principais no quadro: abertas, aguardando aceite e prazo vencido. Criticidade fica no filtro e no item, evitando mais um cartão. Prazo de revisão não representa SLA. Prioridade e vencimento são conceitos distintos. O usuário identifica o recorte ativo e o horário da consulta; resultados parciais não podem ser apresentados como totais gerais.

Pessoas e hosts funcionam como agrupadores para investigação. O detalhe, os textos extensos, o histórico e a administração de concessões ficam em áreas secundárias. Os dashboards recebem um componente compacto com poucos itens, sem repetir o quadro inteiro. Nenhum gráfico decorativo ou ranking individual de produtividade.

Em mobile, filtros e cartões podem empilhar; tabelas devem ter alternativa legível ou rolagem contida, nunca fazer a página inteira transbordar. Estados não dependem apenas de cor. Formulários têm labels e feedback local; erros de leitura não mostram zero como se fosse sucesso.

## Política de visibilidade

Admin pode consultar tenant e delegar leitura. Concessão de grupo corresponde a grupo de usuários: inclui pendências do responsável atual ou do destinatário que ainda aguarda aceite. Não é a associação do host a uma equipe. Permissões atuais do host e da auditoria continuam obrigatórias. O quadro não transforma gestor em responsável nem concede ações administrativas.

Mudança de responsável ou de associação ao grupo altera o recorte futuro. Isso é uma fotografia atual, não uma reconstrução de organograma histórico. Concluídas entram no histórico quando solicitadas. Revogação deve afetar dados, contagens, CSV e navegação ao detalhe.

## Relatório

CSV é útil para reunião e acompanhamento pontual. Deve carregar data e recorte, campos operacionais curtos, responsável, destinatário, host, situação, prioridade e prazo. Não exportar contexto livre/auditoria por padrão. Neutralizar células que possam executar fórmulas. Não gerar rankings, avaliação de desempenho, agendamento de e-mail ou integração Jira neste corte.

## Lembretes sem ruído

Mostrar um resumo agrupado das passagens que aguardam resposta há mais do que o intervalo selecionado. Permitir desativar/ajustar sem gerar uma notificação por item. Não alterar leitura, prazo, revisão ou responsável como efeito de consultar o resumo. A solução é acompanhamento ao abrir a interface, não promessa de entrega proativa quando ninguém estiver conectado.

## Roteiro de homologação

1. Operador cria pendência com prazo e encaminha; campos se mantêm ao falhar uma gravação.
2. Destinatário vê resumo de aceite e notificação; ler não transfere dono.
3. Admin abre quadro geral, filtra e concede leitura de um grupo ao gestor.
4. Gestor vê somente assuntos autorizados do grupo; não consegue agir por outro responsável.
5. Exportação corresponde ao mesmo recorte e evita fórmulas/textos sensíveis.
6. Revogação do grant, saída do grupo e remoção de acesso ao host retiram a visibilidade.
7. Dashboards mostram visão compacta e levam ao detalhe/histórico correto.
8. Desktop/mobile, teclado, carregamento, vazio, erro e retry permanecem claros.

## Evidência visual da interface real

Capturas de laboratório sintético; APIs de plantão, quadro, concessões e notificações são reais. Dados de sessões/atividade pré-existentes dos dashboards usam fixtures. A captura do host mostra somente o componente reutilizável para avaliar densidade e legibilidade.

### 1. Gestora consulta o grupo

Escopo autorizado e três indicadores; detalhes de pessoas/hosts ficam expansíveis.

![Gestora consulta o grupo](screenshots/09-gestora-quadro-do-grupo.png)

### 2. Prioridade e prazo

Filtro reduz a lista e o vencimento tem rótulo textual.

![Prioridade e prazo](screenshots/10-gestora-prioridades-e-prazo.png)

### 3. Consulta sem assumir

Gestora consulta contexto sem receber ações do responsável.

![Consulta sem assumir](screenshots/11-gestora-consulta-sem-assumir.png)

### 4. Administrador acompanha o tenant

Mesmo quadro com escopo do tenant; filtros combináveis.

![Administrador acompanha o tenant](screenshots/12-admin-visao-do-tenant.png)

### 5. Delegação explícita

Concessão de leitura de grupo em seção secundária, sem misturar com tratamento da pendência.

![Delegação explícita](screenshots/13-admin-delega-leitura-do-grupo.png)

### 6. Lembrete agrupado

Intervalo e opção de desativar; consultar não equivale a aceitar.

![Lembrete agrupado](screenshots/14-marina-lembrete-agrupado.png)

### 7. Dashboard do usuário

Três assuntos, indicadores e links; restante do dashboard preservado.

![Dashboard do usuário](screenshots/15-dashboard-pessoal-com-plantao.png)

### 8. Dashboard do host

Resumo compacto com o recorte autorizado do host e acesso ao histórico.

![Dashboard do host](screenshots/16-dashboard-host-resumo.png)

### 9. Quadro no celular

Filtros empilhados e indicadores legíveis, sem overflow horizontal.

![Quadro no celular](screenshots/17-mobile-quadro-do-grupo.png)

### 10. Lista operacional

Responsabilidade/aceite separados dos filtros de host, prioridade e situação.

![Lista operacional](screenshots/18-marina-lista-com-filtros.png)

### 11. Erro recuperável

Erro explícito e retry local; falha não é mostrada como zero pendências.

![Erro recuperável](screenshots/19-quadro-falha-com-recuperacao-local.png)

### 12. Recorte vazio

Ausência de resultados é distinguida de falha de leitura.

![Recorte vazio](screenshots/20-quadro-recorte-sem-pendencias.png)

A jornada original de criar/encaminhar/aceitar/concluir permanece no [roteiro inicial](ux-walkthrough.md), com capturas atualizadas. Relatório é apropriado para reunião operacional; não deve ser interpretado como avaliação de desempenho individual.
