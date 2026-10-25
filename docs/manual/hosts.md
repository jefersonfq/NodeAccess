## Quando usar
Use Hosts para localizar equipamentos, iniciar um acesso autorizado ou voltar a uma conexão que já está aberta. Favoritos e recentes ajudam a reduzir a busca; as pastas organizam o inventário.

O cadastro e a edição usam quatro abas: **Conexão**, **Acesso**, **Organização** e **Recursos**. Conexão abre primeiro, com os dados necessários para alcançar o equipamento.

## Antes de começar
Você precisa estar no tenant correto e ter permissão para visualizar e conectar ao host. Ver um equipamento não significa ter autorização para editar seu cadastro ou abrir todas as formas de acesso.

Para cadastrar ou editar, é necessária a permissão correspondente no inventário corporativo. A pasta pessoal organiza sua navegação; a pasta de acesso corporativo define o contexto das permissões do host. A opção de habilitar um host SSH como bastion é administrativa e aparece na edição.

Em um teste, as máquinas de demonstração iniciais já vêm cadastradas. No painel **Seu laboratório de teste**, confira a quantidade disponível e escolha a quantidade total desejada em **Solicitar máquinas**, dentro do limite configurado. A preparação aparece no painel e mantém os acessos existentes. Use **Atualizar laboratório** para consultar novamente; máquinas preparadas entram na lista de hosts. Confira o prazo no menu **Teste**.

Quando o perfil permitir, **Cadastrar meu host** registra um equipamento próprio por IPv4 público, porta SSH, usuário e senha ou chave PEM. Redes privadas, DNS, agentes e bastions não são aceitos nesse cadastro. A quota de hosts próprios é compartilhada pelos participantes e também respeita o limite total do teste. Cada participante só edita ou remove seus próprios cadastros. Na edição, deixar a credencial vazia mantém a atual; nenhuma credencial salva é exibida. A remoção pede confirmação e remove apenas o cadastro, sem alterar o equipamento externo. Encerre sessões ativas antes de editar ou remover. As máquinas de demonstração não podem ser alteradas por esse formulário.

## Passo a passo
1. Abra **Hosts** e confira o contexto da organização. Na navegação lateral, selecione uma pasta ou use a busca.
2. Confira **nome, protocolo, endereço e pasta** do equipamento. Favoritos e recentes usam informações semelhantes; a estrela indica um favorito.
3. Use **Conectar** no host desejado. Se a política exigir confirmação ou autorização adicional, conclua essa etapa antes de iniciar o acesso.
4. Para retomar uma conexão, selecione o cartão em **Sessões abertas**. A sessão existente volta a ser exibida no terminal.

### Acesso rápido no dashboard
O dashboard do usuário usa os mesmos cards de favoritos e recentes de Hosts: confira protocolo, endereço, pasta e data antes de conectar. A dica da pasta apresenta o caminho disponível e o relógio mostra a data completa. O botão ao lado do favorito remove somente esse atalho; não exclui o host. Cards sem permissão de conexão ficam indisponíveis.

### Importar conexões do Royal TS
É necessário poder gerenciar hosts e criar na pasta de destino. No Royal TS, selecione o documento ou a pasta e use **Data → Export → Comma Separated File (.csv)**. Escolha o tipo de objeto e habilite **Export Headers** e **Include Subfolders**. Senhas são opcionais.

1. Em **Hosts → Importar Hosts**, carregue o CSV na área de arquivos ou na aba **Royal TS**. Use UTF-8 ou UTF-16 com BOM, até 5 MB e 5.000 conexões.
2. Mantenha os cabeçalhos **Name** e **URI**. Se o arquivo não informar o protocolo, escolha o tipo exportado no campo correspondente. São aceitos SSH, RDP, VNC e Telnet; tipos desconhecidos são informados como ignorados.
3. Revise nome, endereço, porta e usuário. Corrija linhas inválidas ou desmarque-as. Confira a pasta de destino e a hierarquia: caminhos são preservados quando o CSV contém **FolderPath** ou **ParentPath**.
4. Senhas presentes no arquivo só são enviadas com consentimento explícito de um administrador. Credenciais vinculadas, chaves, gateways, tarefas, descrições e opções avançadas não são convertidos; configure esses recursos no destino.
5. Use **Validar importação**, confira criação/duplicatas/erros e então **Confirmar e importar**. Em caso de prévia expirada, valide novamente; as correções são preservadas. Se houver reversão incompleta, confira os recursos indicados antes de repetir.

Documentos **.rtsz**, **.rtsx** e **.rts** não são importados diretamente: exporte como CSV. Se houver erro de cabeçalhos ou aspas, exporte novamente com cabeçalhos, mantendo a quantidade de colunas. Trocar para um arquivo inválido bloqueia a confirmação da prévia anterior.

### Duplicar um host
Use **Duplicar host** pelo botão direito ou pelo menu de três pontos. A ação exige permissão de gerenciamento de hosts e acesso de leitura à origem; criar na pasta de destino continua sujeito às permissões do inventário.

1. Aguarde o carregamento e revise o novo cadastro. O nome recebe “(cópia)”, a porta é mantida e o endereço fica vazio para você informar o novo destino.
2. Confira as abas: pastas corporativa/pessoal, descrição, tags, protocolo, perfil, usuário e rota são reaproveitados. A pasta permanece a mesma; não é criada outra árvore.
3. A macro de inicialização mantém o vínculo e o modo: editar essa macro continua afetando todos os hosts que a usam. Links associados viram cópias manuais independentes. Templates como {{HOST.IP}} usam o novo host; URLs fixas precisam ser revisadas.
4. Referências a Secret, chave PEM ou 1Password são reaproveitadas conforme seu acesso. Senha local não é copiada: informe uma nova quando necessária. Histórico, sessões, confiança da chave SSH, permissões específicas e links de compartilhamento não são duplicados. Permissões herdadas da pasta de destino continuam aplicáveis.
5. Clique em **Criar** para salvar um novo host. **Cancelar** não cria nada, e o host original permanece intacto.

Se a origem não carregar, tente novamente. Se uma pasta, rota ou credencial copiada não estiver disponível, revise essa referência antes de salvar. Uma recusa ao salvar mantém o rascunho aberto; confira a mensagem e ajuste o destino/permissões.

### Cadastrar ou editar um host
1. Abra **Novo host** ou a ação de edição de um host autorizado. A aba **Conexão** mostra nome, protocolo, endereço e porta. Em SSH, configure também usuário, autenticação e rota conforme o destino. As opções disponíveis acompanham o protocolo escolhido.
2. Confira o resumo de **Acesso** no cabeçalho. Clique nele ou na aba **Acesso** para selecionar a pasta corporativa. Na edição de SSH, essa aba também apresenta a chave do servidor e seu histórico de confiança.
3. Em **Organização**, ajuste perfil do equipamento quando disponível, sistema operacional, pasta pessoal, descrição e tags. Esses dados ajudam a localizar e identificar o host.
4. Em **Recursos**, configure macros e links associados quando necessários. Túneis SSH e outros recursos de edição aparecem apenas quando aplicáveis ao host e às suas permissões.
5. Use o teste disponível no rodapé para conferir o destino. Em RDP/VNC, **Testar porta** verifica a disponibilidade TCP; não valida uma sessão gráfica nem habilita acesso gráfico pelo navegador.
6. Confira o resultado e selecione **Criar** no novo cadastro ou **Salvar** na edição. Trocar de aba preserva os dados preenchidos, mas não salva o cadastro. **Cancelar** fecha o formulário sem salvar suas alterações de cadastro. Ações próprias de recursos, como habilitar bastion, têm efeito independente do salvamento do formulário.

As abas e ações permanecem acessíveis enquanto o conteúdo da aba rola. Pelo teclado, use **Tab** para alcançar a aba ativa, **←/→** para alternar entre abas e **Home/End** para ir à primeira ou à última. Use **Tab** novamente para navegar pelos campos e ações.

## Entenda os indicadores
- No **Acesso rápido**, a pasta aparece junto ao endereço quando há espaço, seguida do relógio e da data do último acesso em **dia/mês**; a dica mostra a data por extenso e o horário. **Raiz** indica que o host está no diretório raiz do inventário. A dica da pasta mostra o caminho disponível, como **Raiz → Banco de dados → Dbs**. Se um ancestral não estiver disponível, o caminho pode aparecer parcial; a interface não presume pastas que você não pode consultar. O ícone no canto superior direito do card identifica o protocolo: terminal com cadeado para SSH, monitor para RDP, terminal com T para Telnet e monitor com V para VNC. Passe o mouse ou toque no ícone para consultar seu protocolo sem conectar. Passe o mouse ou toque no relógio para consultar o último acesso sem conectar. Pelo teclado, focar o card mostra o protocolo e o último acesso; **Esc** fecha a dica. **Sessão ativa** continua visível no card.
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
