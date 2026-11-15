# Plantão e notificações

## Quando usar
Use **Plantão** para manter o contexto de uma pendência relacionada a um host e encaminhá-la a outro operador. A **Central de notificações** reúne atualizações destinadas a você. Abrir uma notificação ou marcá-la como lida não transfere responsabilidade.

## Antes de começar
Entre no tenant correto e confira seu acesso ao host. O destinatário precisa estar ativo e autorizado a receber o contexto. Uma referência de auditoria também exige a permissão correspondente; não copie conteúdo restrito para contornar essa regra. Não registre senhas, chaves ou transcrições completas.

## Passo a passo
1. Abra **Plantão** e selecione **Nova pendência**, ou use a ação de pendência no painel de um host autorizado.
2. Informe host, título curto, situação atual, próximo passo e prioridade. Se houver um horário de revisão, preencha **Revisar até**. A data e hora usam o fuso do navegador; prazo vencido não significa SLA violado. Referências são opcionais. Um link de chamado abre o sistema externo; não cria nem sincroniza um chamado.
3. Salve. Na pendência, escolha o destinatário autorizado e encaminhe. Você continua responsável até o aceite.
4. O destinatário abre a **Central de notificações** pelo sino e consulta a pendência. Ele pode marcar a notificação como lida sem assumir o trabalho.
5. Após conferir o contexto, o destinatário escolhe **Aceitar responsabilidade** ou devolve com motivo. Na devolução, o responsável pode corrigir as informações e encaminhar novamente. Para editar durante uma passagem pendente, cancele essa passagem antes.
6. Quem assumiu executa o trabalho usando o fluxo normal de acesso ao host. Ao finalizar, conclui a pendência com o resultado. O histórico identifica as ações e seus autores.

Se um responsável ficar indisponível, o administrador pode reatribuir a pendência com justificativa. O histórico diferencia reatribuição administrativa de aceite pelo operador.

## Exemplo de uso
Carlos registra que o link do POP Norte está estável após mitigação e pede nova verificação às19h. Marina recebe a notificação, lê as informações e aceita continuar. Depois da verificação, registra o resultado e conclui. Carlos pode acompanhar as atualizações sem manter uma sessão SSH aberta.

## Se algo não funcionar
- **Não há destinatários:** confira a disponibilidade e as permissões. Encaminhar não concede acesso ao host ou à auditoria.
- **O contexto mudou:** atualize a pendência e confira o responsável antes de tentar uma ação novamente. A aplicação evita aplicar ações sobre versões antigas.
- **Falha ao salvar ou encaminhar:** confira o erro local. O formulário mantém os dados enquanto permanece aberto; não há promessa de rascunho persistido após fechar ou recarregar a página.
- **Host ou evidência indisponível:** não presuma que foi concluído. Acesso revogado pode ocultar tanto o assunto quanto sua notificação. Solicite revisão ao administrador autorizado.
- **Falta de resposta:** uma passagem pendente continua identificada como aguardando aceite. Não há escalonamento externo automático neste corte.

## Resultado esperado
A pendência mantém estado, responsável, próximo passo e histórico. Notificações orientam a navegação; o aceite é uma ação separada e explícita. O fluxo não executa comandos, transfere terminais, cria chat ou envia dados ao Jira automaticamente.

## Encontrar o que exige ação

Na lista, escolha **Minha responsabilidade**, **Aguardando meu aceite** ou **Encaminhadas por mim**. Combine host, prioridade e situação para reduzir o recorte. A prioridade expressa atenção; **Revisar até** expressa quando conferir novamente. O histórico de novas revisões permite expandir o contexto registrado naquele evento. Eventos antigos sem snapshot continuam identificados; o sistema não inventa versões anteriores.

Na central de notificações, **Aguardando resposta** agrupa encaminhamentos antigos destinados a você ou enviados por você. Nas configurações do bloco, ajuste o intervalo em horas e aplique; é possível desativar sua exibição. A preferência é local ao navegador, usuário e tenant. O resumo é consultado ao abrir/atualizar a interface; não há entrega externa automática e o limite não é um SLA. Ler o resumo não altera responsável, revisão nem situação.

## Acompanhar a equipe no quadro

1. Abra **Plantão** e use **Quadro de plantão**, quando disponível.
2. Confira os indicadores de abertas, aguardando aceite e prazo vencido, além de pessoas e hosts envolvidos.
3. Filtre por grupo de usuários, pessoa, host, prioridade ou situação. Um grupo inclui assuntos de seus responsáveis atuais ou destinatários que aguardam aceite; não é a pasta do host.
4. Expanda os agrupamentos por pessoa/host quando precisar investigar e abra a pendência para consultar o contexto. Concessão de leitura não permite assumir, concluir ou editar por outra pessoa.
5. Se precisar apresentar o recorte em uma reunião, use **Exportar CSV**. O arquivo informa horário/filtros e exporta a seleção consultada, não apenas a página visível. Não inclui contexto livre nem snapshots. Se houver aviso de limite, refine os filtros antes de interpretar como total geral.

O administrador do tenant pode abrir **Acesso ao quadro**, escolher usuário e conceder leitura do tenant ou de um grupo. Acesso do host e da auditoria continuam obrigatórios. Revogar uma concessão retira o acesso na próxima requisição. Mudança de responsável ou associação ao grupo também pode remover o assunto desse recorte. Concessões não transformam o usuário em administrador.

## Resumos nos dashboards

O dashboard de usuário e o dashboard do host mostram um bloco compacto de plantão, com contadores, poucos assuntos e acesso às pendências/histórico. O texto informa que são os assuntos visíveis no escopo autorizado. No host, gestores usam o recorte de gestão autorizado; operadores veem suas participações. **Histórico** abre assuntos concluídos do recorte, sem prometer uma reconstrução de equipes antigas.

## Recuperação do quadro

- **Sem acesso ao quadro:** peça ao administrador uma concessão adequada; pertencer a um grupo não concede leitura de gestão automaticamente.
- **Consulta falhou:** use tentar novamente. Erro não equivale a nenhuma pendência.
- **Recorte limitado:** refine grupo, pessoa, host ou situação. Indicadores e relatório representam apenas a seleção informada.
- **Item deixou de aparecer:** confira concessão, grupo, responsável atual e acesso ao host/auditoria. Não suponha que foi concluído.
- **Relatório diferente de uma captura anterior:** o CSV consulta o estado atual; mudanças concorrentes podem alterar o resultado. Confira o horário registrado no arquivo.

## Consulta rápida no terminal

No terminal do host, o ícone de prancheta abre a consulta das pendências autorizadas. Expanda contexto/próximo passo, navegue pelas páginas ou abra o detalhe em nova aba. X/Escape fecham somente a janela, sem concluir pendências ou interromper a sessão. O indicador é um recorte recente; notas privadas não são anunciadas. Procedimento completo em [Terminal](/manual/terminal).
