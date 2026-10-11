## Quando usar
O terminal permite operar uma conexão textual no navegador. As abas organizam os destinos, e os modos de visualização adaptam o espaço de trabalho.

## Antes de começar
Confira o nome do host e o status da conexão antes de digitar. Comandos são executados no destino da aba em foco. Os atalhos de teclado podem variar conforme o sistema do seu computador; use as indicações apresentadas pela interface.

## Passo a passo
1. Abra uma sessão a partir de Hosts e aguarde a confirmação de conexão.
2. Clique na área do terminal para digitar. A aba ativa identifica o destino do trabalho.
3. Para **reordenar**, arraste uma aba sobre outra. A borda azul indica o lugar em que ela será inserida: metade esquerda para antes, metade direita para depois.
4. Solte para confirmar a posição. Se desistir, cancele o arraste ou solte em uma posição sem alteração. A prévia não muda a ordem por si só.
5. Use o menu da aba para as ações disponíveis, como duplicar ou abrir em outra janela. Duplicar cria outra aba/conexão; reordenar apenas muda sua posição.

## Espaço de trabalho
Os modos de exibição ajudam a organizar abas, ferramentas e painéis. A ação de ajuda leva a este capítulo; o manual abre em outra aba do navegador para manter seu trabalho atual visível.

Ao usar um painel de arquivos, confirme que ele pertence à sessão desejada. No painel **Arquivos**, o menu **Utilitários** facilita cópia entre suas sessões e edição no aplicativo local com agente pessoal Windows. O caminho selecionado e a conexão autenticada são reaproveitados; o comando direto é preparado para revisão e não executado automaticamente. O procedimento de edição e transferência está em [Arquivos e SFTP](/manual/sftp).

## Destaques de mensagens
Quando houver regras ativas, abra **Destaques** na barra superior do terminal. Se a barra estiver oculta, use **Mostrar barra de ferramentas**. Selecione uma regra para focar seus destaques ou **Mostrar todos** para remover esse foco. **Buscar próxima** localiza a próxima ocorrência da primeira regra da lista.

**Somente ocorrências** mostra novas linhas correspondentes recebidas após ativar o filtro, até 200 registros. Use **Voltar ao terminal** para retornar à sessão. O painel de controles abre sobre a tela, sem reservar outra faixa de espaço. Feche com Escape ou clicando fora; ocultar a barra também oculta os controles, mantendo as cores das regras ativas no terminal.

Se o botão não aparecer mesmo com a barra visível, confira se há regras habilitadas em **Destaques do terminal** no perfil ou atribuídas pelo administrador. Abrir os controles não cria outra conexão nem envia comandos ao host.

## Exemplo de uso
Você mantém uma sessão de diagnóstico e outra de aplicação. Coloque a sessão de diagnóstico ao lado da aplicação com o marcador de arraste. A conexão ativa e seus dados não precisam ser recriados para mudar a ordem das abas.

## Se algo não funcionar
**Não aparece marcador:** a posição pode equivaler à atual ou o cursor estar fora de uma aba válida. Mova-o até uma das metades da aba de destino.

**A conexão terminou:** leia o motivo apresentado pelo terminal. Use a opção de reconexão oferecida pela interface quando apropriado; uma reconexão não garante recuperar processos do shell anterior.

**A janela separada não abriu:** verifique o bloqueio de pop-ups do navegador e o aviso exibido. Não feche a origem antes de confirmar a abertura e o estado da nova janela.

**A sessão fica sem resposta:** diferencie falta de saída do comando, perda de rede e encerramento remoto. Evite repetir comandos que possam ter sido executados antes da falha.

## Resultado esperado
A ordem final corresponde ao marcador exibido durante o arraste. Abrir ajuda, consultar outra página e organizar abas não são comandos de encerramento da conexão.

## Entender uma falha de acesso
Em uma falha, o painel **Diagnóstico do acesso** apresenta a etapa conhecida, o que foi informado e a ação recomendada. Uma falha de bastion exige revisar o intermediário; ela não confirma problema na credencial do destino. Quando o evento não identifica a causa, o painel informa **Etapa não informada**.

Abra **Referência para o suporte** e use **Copiar referência**. Se o navegador negar a cópia, selecione o texto e copie manualmente. A referência contém o host, a sessão quando disponível, o código e o horário observado pelo navegador. Não envie senhas, chaves ou a saída completa do terminal ao suporte.

Use **Recolher diagnóstico** para consultar a saída e **Ver diagnóstico do acesso** para reabrir. Após corrigir a causa, use a reconexão manual existente. Uma tentativa bem-sucedida remove o diagnóstico anterior; saída normal por `exit`/`logout` mantém a mensagem de encerramento sem apresentar falha de acesso.

**Falha no painel de arquivos:** use **Tentar novamente** no próprio painel. A recuperação reinicia apenas o gerenciador de arquivos e mantém a sessão SSH.
