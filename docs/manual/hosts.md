## Quando usar
Use Hosts para localizar equipamentos, iniciar um acesso autorizado ou voltar a uma conexão que já está aberta. Favoritos e recentes ajudam a reduzir a busca; as pastas organizam o inventário.

O cadastro e a edição usam quatro abas: **Conexão**, **Acesso**, **Organização** e **Recursos**. Conexão abre primeiro, com os dados necessários para alcançar o equipamento.

## Antes de começar
Você precisa estar no tenant correto e ter permissão para visualizar e conectar ao host. Ver um equipamento não significa ter autorização para editar seu cadastro ou abrir todas as formas de acesso.

Para cadastrar ou editar, é necessária a permissão correspondente no inventário corporativo. A pasta pessoal organiza sua navegação; a pasta de acesso corporativo define o contexto das permissões do host. A opção de habilitar um host SSH como bastion é administrativa e aparece na edição.

## Passo a passo
1. Abra **Hosts** e confira o contexto da organização. Na navegação lateral, selecione uma pasta ou use a busca.
2. Confira **nome, protocolo, endereço e pasta** do equipamento. Favoritos e recentes usam informações semelhantes; a estrela indica um favorito.
3. Use **Conectar** no host desejado. Se a política exigir confirmação ou autorização adicional, conclua essa etapa antes de iniciar o acesso.
4. Para retomar uma conexão, selecione o cartão em **Sessões abertas**. A sessão existente volta a ser exibida no terminal.

### Cadastrar ou editar um host
1. Abra **Novo host** ou a ação de edição de um host autorizado. A aba **Conexão** mostra nome, protocolo, endereço e porta. Em SSH, configure também usuário, autenticação e rota conforme o destino. As opções disponíveis acompanham o protocolo escolhido.
2. Confira o resumo de **Acesso** no cabeçalho. Clique nele ou na aba **Acesso** para selecionar a pasta corporativa. Na edição de SSH, essa aba também apresenta a chave do servidor e seu histórico de confiança.
3. Em **Organização**, ajuste perfil do equipamento quando disponível, sistema operacional, pasta pessoal, descrição e tags. Esses dados ajudam a localizar e identificar o host.
4. Em **Recursos**, configure macros e links associados quando necessários. Túneis SSH e outros recursos de edição aparecem apenas quando aplicáveis ao host e às suas permissões.
5. Use o teste disponível no rodapé para conferir o destino. Em RDP/VNC, **Testar porta** verifica a disponibilidade TCP; não valida uma sessão gráfica nem habilita acesso gráfico pelo navegador.
6. Confira o resultado e selecione **Criar** no novo cadastro ou **Salvar** na edição. Trocar de aba preserva os dados preenchidos, mas não salva o cadastro. **Cancelar** fecha o formulário sem salvar suas alterações de cadastro. Ações próprias de recursos, como habilitar bastion, têm efeito independente do salvamento do formulário.

As abas e ações permanecem acessíveis enquanto o conteúdo da aba rola. Pelo teclado, use **Tab** para alcançar a aba ativa, **←/→** para alternar entre abas e **Home/End** para ir à primeira ou à última. Use **Tab** novamente para navegar pelos campos e ações.

## Entenda os indicadores
- **Sessões abertas** reúne suas conexões visíveis no contexto atual. Trocar de página não é uma ação de encerramento.
- O número laranja de uma aba indica **atualizações de saída ainda não vistas**. Vários blocos podem formar uma atualização; o número não representa comandos, pessoas ou sessões. Ao visualizar a aba, a contagem é zerada.
- Indicadores de presença e quantidade de sessões no host têm outra finalidade: mostram atividade associada ao equipamento, conforme sua permissão.

## Exemplo de uso
Você iniciou uma manutenção, voltou a Hosts para consultar outro equipamento e quer continuar o trabalho anterior. Escolha o cartão em Sessões abertas em vez de iniciar uma segunda conexão.

## Se algo não funcionar
**A pasta não mostra os hosts:** aguarde o carregamento e use a ação de tentar novamente quando disponível. Confira o filtro e o tenant selecionado.

**Conectar indisponível ou acesso negado:** confirme a permissão com o administrador. Alterar filtros ou favoritar o host não concede acesso.

**Uma sessão desapareceu ao trocar de tenant:** volte ao contexto original antes de concluir que ela foi encerrada. Consulte [Troca de tenant](/manual/tenants) para entender o retorno.

**O cadastro indica um campo inválido:** confira a mensagem. Nas validações locais de campos obrigatórios, o formulário abre a aba correspondente e leva o foco ao campo para correção. Se houver falha ao salvar, os dados permanecem no formulário para revisar e tentar novamente.

**Um recurso não aparece:** confira o protocolo, o perfil do equipamento, suas permissões e se o host já foi salvo. Nem todos os protocolos oferecem autenticação SSH, bastion, túneis ou macros.

## Resultado esperado
O host escolhido corresponde ao destino desejado e a conexão é iniciada ou retomada conforme a ação selecionada. Não há necessidade de duplicar uma sessão para voltar a ela.

Ao cadastrar ou editar, os dados são salvos no destino e na pasta corporativa selecionados. O resultado do teste de conexão não substitui a confirmação de salvamento.
