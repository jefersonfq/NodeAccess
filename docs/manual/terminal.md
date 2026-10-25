## Quando usar
O terminal permite operar uma conexão textual no navegador. As abas organizam os destinos, e os modos de visualização adaptam o espaço de trabalho.

## Antes de começar
Confira o nome do host e o status da conexão antes de digitar. Comandos são executados no destino da aba em foco. Os atalhos de teclado podem variar conforme o sistema do seu computador; use as indicações apresentadas pela interface.

Em um teste, as ferramentas disponíveis dependem do perfil configurado para o teste. Links de acesso temporário JIT ficam indisponíveis. O limite de sessões e o prazo também se aplicam ao terminal.

## Passo a passo
1. Abra uma sessão a partir de Hosts e aguarde a confirmação de conexão.
2. Clique na área do terminal para digitar. A aba ativa identifica o destino do trabalho.
3. Para **reordenar**, arraste uma aba sobre outra. A borda azul indica o lugar em que ela será inserida: metade esquerda para antes, metade direita para depois.
4. Solte para confirmar a posição. Se desistir, cancele o arraste ou solte em uma posição sem alteração. A prévia não muda a ordem por si só.
5. Use o menu da aba para as ações disponíveis, como duplicar ou abrir em outra janela. Duplicar cria outra aba/conexão; reordenar apenas muda sua posição.

Ao aparecer **Ajustes rápidos**, a sugestão corresponde ao sistema do computador que está usando o navegador, não ao sistema do host remoto. **Usar preset** aplica os ajustes e fecha a sugestão; **Agora não** apenas a fecha. A escolha de ocultar fica salva neste navegador.

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

## Snippets e macros
Abra **Snippets** para cadastrar comandos reutilizáveis. No terminal, use o painel **Snippets** ou o seletor rápido pelo atalho exibido nas preferências. Confira a sessão de destino antes de executar.

No teste, o painel permite consultar e executar os snippets disponíveis, inclusive pela fila. Criar, editar, excluir e resolver credenciais externas pelo Vault não estão disponíveis nesse modo.

Para uma macro:
1. Crie um snippet, informe o nome e escolha **Macro**. Um snippet existente pode ser convertido com **Organizar como macro**. Em uma macro vazia, escolha **Modelo: diagnóstico Linux** ou **Modelo: aguardar prompt** para começar; revise os comandos e o prompt para seu shell Unix. Marcadores dos exemplos indicam continuidade, não sucesso de cada comando.
2. Adicione passos de **Enviar comando**, **Aguardar resposta** ou **Pausa**. O envio inclui Enter por padrão; desmarque apenas quando quiser continuar digitando na mesma linha. **Tecla** oferece Enter, Tab e Esc como ações explícitas.
3. Use subir/descer ou arraste para ordenar. É possível duplicar/remover passos ou inserir uma cópia dos passos de outro snippet. Alterar a cópia não altera o original. Use **Recolher/Expandir** para visualizar somente o resumo de cada passo; a prévia identifica Enviar, Aguardar, Pausa e Tecla.
4. Em uma espera, configure o texto esperado e o tempo limite. **Regex avançado** é opcional: abra **Testar espera do passo**, forneça texto sem dados sensíveis e use **Testar com exemplo**. Cada espera mantém sua própria amostra e resultado. O resultado informa se houve correspondência e destaca o trecho encontrado; editar o padrão ou a amostra invalida o resultado anterior. Corrija padrões inválidos ou que excedam o limite antes de salvar.
5. Para segredos, use referências como `{{secret:alias}}`. O Vault resolve valores no envio; não cole senhas nos comandos ou exemplos.
6. Salve. No terminal, execute na sessão desejada. Um controle compacto permite cancelar durante a execução, sem diminuir a área útil. O resultado aparece em uma notificação temporária (confirmação por cerca de 2 segundos; erro por 3 segundos). **Cancelar** impede passos futuros; não desfaz comandos já enviados nem envia Ctrl+C automaticamente.

Uma sessão executa uma macro por vez. Um segundo disparo direto é bloqueado; no painel, **Adicionar à fila desta sessão** agenda uma cópia da macro para depois da atual, até 20 pendentes. A fila mantém o destino original mesmo se você mudar de aba. Cancelamento, falha ou desconexão interrompem a fila; **Limpar fila** remove apenas as pendentes.

**Passos enviados/concluídos** descreve o término da rotina do cliente, não comprova sucesso de comandos remotos. Use uma espera final por uma resposta específica quando precisar verificar continuidade. Pausas apenas atrasam o próximo passo. O resumo de destino/passos não permanece sobre o terminal após a execução. As notificações de macro substituem a anterior para evitar empilhamento. A macro de inicialização do host acompanha o término desse executor.

### Biblioteca e transferência
Na página de snippets, o menu **Mais ações** (⋯) reúne duplicar, editar e excluir; editar/excluir continuam sujeitos à propriedade do snippet.
Marque a estrela para favoritar; filtre por **Favorito** ou **Recentes**. Essas preferências ficam neste navegador, separadas por usuário e tenant, e mostram somente snippets aos quais você ainda tem acesso.

**Exportar** baixa os snippets atualmente filtrados. **Importar** aceita o formato JSON do NodeAccess, apresenta os nomes antes da confirmação e cria cópias pessoais sem grupo. Permissões, grupos e valores resolvidos pelo Vault não são transferidos; referências de secrets precisam existir no destino. Se a importação parar parcialmente, a mensagem informa quantos foram criados e uma nova tentativa importa somente os restantes enquanto a janela permanecer aberta.

**Copiar** preserva o comando e as referências originais ao Vault. Para macros de ações ou esperar/enviar, **Copiar macro** copia a representação da macro para reutilização; ela não deve ser colada diretamente no shell.

### Recuperação e compatibilidade
Se a biblioteca falhar, use **Tentar novamente**. Falhas em grupos/secrets aparecem separadamente e não devem esconder snippets já carregados. Corrija erros de campos e passos antes de salvar. Ao descartar edição não salva pela janela de cadastro, confirme a decisão. O navegador pede confirmação ao recarregar com alterações. Se o painel for desmontado, o rascunho pode ser recuperado ao reabri-lo na mesma sessão, usuário e tenant; o aviso indica a recuperação. Rascunhos ficam somente em memória e não sobrevivem ao recarregamento confirmado ou fechamento do navegador.

Sequência e Esperar/enviar continuam disponíveis em **Formatos anteriores**; Comando e Macro são as primeiras opções para novos cadastros. Clientes antigos que não reconhecem o formato de ações não recebem essas novas macros; atualize a interface para acessá-las. Uma macro antiga com estrutura inválida deve ser corrigida antes de executar.

No relatório administrativo, **Macro (informado pelo cliente)** complementa eventos já registrados pelo gateway com o resultado da rotina. Esse resumo é enviado em melhor esforço, pode não existir se nenhum comando chegou a ser enviado ou se a comunicação falhou, e não substitui a auditoria do servidor nem comprova sucesso remoto. Não inclui texto do terminal ou valores de secrets.


## Consultar comandos com IA
Com a IA habilitada/licenciada e um provedor configurado, digite **@ia** ou **@ai** seguido de espaço no início de uma linha vazia, em uma sessão de servidor conectada. Digite o prefixo: colar um bloco inteiro não aciona essa consulta.

A pergunta recebe foco automaticamente junto ao cursor, dentro da área do terminal, usando o posicionamento do autocomplete. O texto da dúvida permanece local e não é enviado ao SSH.

1. Escreva o que deseja fazer, por exemplo “listar portas em escuta”, e pressione **Enter** ou **Sugerir comando**.
2. Confira os comandos e suas explicações. Use **↑/↓** para escolher entre as alternativas disponíveis (até três). Em pedidos abertos, a IA prioriza uma recomendação e alternativas distintas, indicando quando usar cada opção. Um pedido exato, falta de alternativas adequadas ou restrições da política podem resultar em uma única opção. A consulta usa os dados do host, sem enviar a seleção ou o buffer do terminal.
3. Clique na sugestão ou pressione **Enter** quando ela estiver selecionada para inserir o texto na linha. Não há execução nesse momento.
4. Revise a linha no terminal e pressione **Enter** para executar. **Esc** fecha a consulta sem inserir nada.

Se nenhuma sugestão puder ser inserida, a consulta mostra o conteúdo recebido e distingue bloqueio, aprovação exigida, formato inválido e inserção não autorizada pela resposta. Formato inválido permite repetir o pedido como um único comando em uma linha; isso não exige mudar a política. Blocos Markdown com exatamente uma linha de comando são normalizados antes da avaliação. Erros e timeout preservam a pergunta para tentar novamente. Trocar de sessão, desconectar ou fechar a consulta invalida respostas pendentes. Se a linha do terminal mudar, a inserção é recusada para não concatenar comandos. Scripts, respostas com caracteres de controle e comandos bloqueados ou sujeitos a aprovação não são inseridos por esse fluxo.

Para investigar um problema usando a saída do terminal, digite **@ia-ass** (ou **@ai-ass**) seguido de espaço na linha vazia, ou use **Analisar contexto do terminal**, o botão de IA ou **Ctrl/Cmd+Shift+I**. Esse assistente contextual mantém explicações, comandos e scripts para revisão. A inserção de um comando continua vinculada à sessão em que foi solicitado e não envia Enter automaticamente.


### Recuperar erros e controlar o contexto da IA
Enquanto digita o prefixo, uma dica local apresenta os atalhos de consulta e contexto. A pergunta da consulta fica apenas em memória na sessão atual: fechar e reabrir permite retomá-la; inserir o comando ou trocar de sessão limpa esse rascunho.

Falhas de conexão, demora, resposta inválida e limite de uso preservam a pergunta e oferecem **Tentar novamente**. Falta de licença, permissão ou configuração exige verificar o acesso/administrador; não há repetição automática. **Cancelar consulta** interrompe a espera e propaga o cancelamento até a chamada ao provedor. Fechar ou mudar de sessão também invalida respostas antigas. A interrupção local não garante estorno de uso já processado por um serviço externo.

No **@ia-ass**, escolha **Texto do terminal enviado à IA** antes de enviar: **Nenhum texto**, **Somente seleção**, **Saída recente** ou **Seleção e saída recente**. O padrão é saída recente. O envio é limitado a até 8.000 caracteres de texto, sem duplicar o buffer; a sanitização pode reduzir esse total. Os dados cadastrais do host continuam disponíveis mesmo com Nenhum texto. Editar a pergunta ou mudar a opção durante uma consulta cancela a resposta anterior.

O sistema operacional usado como referência é o cadastrado no **host remoto**, nunca o sistema do navegador. Se estiver desconhecido, informe a plataforma na pergunta. O modelo pode errar: confira comando, explicação e destino.

Além da política do tenant, a inserção rápida aceita apenas consultas simples reconhecidas. Comandos compostos, substituições, redirecionamentos, ferramentas desconhecidas, opções que alteram estado e incompatibilidades com o sistema cadastrado exigem revisão. Isso também se aplica ao botão de inserir do assistente contextual; scripts continuam disponíveis somente para revisão. Essa verificação não substitui a revisão humana nem executa comandos.
