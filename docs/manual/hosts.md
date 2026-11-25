## Quando usar
Use Hosts para localizar equipamentos, iniciar um acesso autorizado ou voltar a uma conexão que já está aberta. Favoritos e recentes ajudam a reduzir a busca; as pastas organizam o inventário.

O cadastro e a edição usam quatro abas: **Conexão**, **Acesso**, **Organização** e **Recursos**. Conexão abre primeiro, com os dados necessários para alcançar o equipamento.

## Antes de começar
Você precisa estar no tenant correto e ter permissão para visualizar e conectar ao host. Ver um equipamento não significa ter autorização para editar seu cadastro ou abrir todas as formas de acesso.

Para cadastrar ou editar, é necessária a permissão correspondente no inventário corporativo. A pasta pessoal organiza sua navegação; a pasta de acesso corporativo define o contexto das permissões do host. A opção de habilitar um host SSH como bastion é administrativa e aparece na edição.

Em um teste, as máquinas de demonstração iniciais já vêm cadastradas. Abra **Recursos e limites do teste** para conferir a quantidade disponível e escolha a quantidade total desejada em **Solicitar máquinas**, dentro do limite configurado. A preparação aparece no painel e mantém os acessos existentes. Use **Atualizar laboratório** para consultar novamente; máquinas preparadas entram na lista de hosts. O painel fica recolhido para preservar a área de trabalho; a preparação e falhas de consulta aparecem no resumo. Confira o prazo no menu **Teste**, destacado quando entrar na janela de aviso configurada.

No perfil completo, use o cadastro normal de hosts e os mesmos menus do tenant, conforme suas permissões, recursos habilitados e cotas. A configuração padrão de um novo perfil completo prepara uma máquina inicial; os demais equipamentos são cadastrados pelo usuário. As máquinas de demonstração são gerenciadas pelo sistema e não permitem edição, remoção ou duplicação. Integrações exigem configuração própria; habilitá-las no perfil não conecta serviços externos.

Nos perfis guiados anteriores, quando o perfil permitir, **Cadastrar meu host** registra um equipamento próprio por IPv4 público, porta SSH, usuário e senha ou chave PEM. Redes privadas, DNS, agentes e bastions não são aceitos nesse cadastro. A quota de hosts próprios é compartilhada pelos participantes e também respeita o limite total do teste. Cada participante só edita ou remove seus próprios cadastros. Na edição, deixar a credencial vazia mantém a atual; nenhuma credencial salva é exibida. A remoção pede confirmação e remove apenas o cadastro, sem alterar o equipamento externo. Encerre sessões ativas antes de editar ou remover. As máquinas de demonstração não podem ser alteradas por esse formulário.

## Passo a passo
1. Abra **Hosts** e confira o contexto da organização. Na navegação lateral, selecione uma pasta ou use a busca.
2. Confira **nome, protocolo, endereço e pasta** do equipamento. Favoritos e recentes usam informações semelhantes; a estrela indica um favorito.
3. Use **Conectar** no host desejado. Se a política exigir confirmação ou autorização adicional, conclua essa etapa antes de iniciar o acesso.
4. Para retomar uma conexão, selecione o cartão em **Sessões abertas**. A sessão existente volta a ser exibida no terminal.

### Acesso rápido no dashboard
O dashboard do usuário usa os mesmos cards de favoritos e recentes de Hosts: confira protocolo, endereço, pasta e data antes de conectar. A dica da pasta apresenta o caminho disponível e o relógio mostra a data completa. O botão ao lado do favorito remove somente esse atalho; não exclui o host. Cards sem permissão de conexão ficam indisponíveis.

### Consultar o dashboard de um host
Abra o dashboard do equipamento para conferir sua atividade no período selecionado. **Conectar** abre o acesso desse host. **Auditoria**, quando permitida, fica junto às ações superiores e leva às sessões do equipamento no mesmo período.

Em **Requer atenção**, confira os motivos e as contagens antes de decidir uma ação. Use os atalhos disponíveis para consultar as sessões ou auditorias correspondentes. O indicador resume critérios operacionais; não significa, sozinho, que o equipamento esteja indisponível.

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
   Para IPv6, informe o endereço completo; se usar CIDR, informe também a máscara de 0 a 128. Durante a digitação, um prefixo parcial mostra orientação. Ao sair do campo ou tentar salvar, um endereço incompleto ou inválido exige correção e o cadastro não é enviado.
2. Confira o resumo de **Acesso** no cabeçalho. Clique nele ou na aba **Acesso** para selecionar a pasta corporativa. Na edição de SSH, essa aba também apresenta a chave do servidor e seu histórico de confiança.
3. Em **Organização**, ajuste perfil do equipamento quando disponível, sistema operacional, pasta pessoal, descrição e tags. Esses dados ajudam a localizar e identificar o host.
4. Em **Recursos**, configure macros e links associados quando necessários. Túneis SSH e outros recursos de edição aparecem apenas quando aplicáveis ao host e às suas permissões.
5. Use o teste disponível no rodapé para conferir o destino. Em RDP/VNC, **Testar porta** verifica a disponibilidade TCP; não valida uma sessão gráfica nem habilita acesso gráfico pelo navegador.
6. Confira o resultado e selecione **Criar** no novo cadastro ou **Salvar** na edição. Trocar de aba preserva os dados preenchidos, mas não salva o cadastro. **Cancelar** fecha o formulário sem salvar suas alterações de cadastro. Ações próprias de recursos, como habilitar bastion, têm efeito independente do salvamento do formulário.

As abas e ações permanecem acessíveis enquanto o conteúdo da aba rola. Pelo teclado, use **Tab** para alcançar a aba ativa, **←/→** para alternar entre abas e **Home/End** para ir à primeira ou à última. Use **Tab** novamente para navegar pelos campos e ações.

### Gerenciar credenciais no VaultNAccess
Abra **VaultNAccess** no menu lateral para localizar Secrets e chaves PEM. Use a busca e o filtro de tipo; a lista mostra metadados, sem revelar os valores salvos. A disponibilidade acompanha a licença e as permissões do seu acesso.

Use **Novo secret** ou **Importar chave PEM** para cadastrar. Em **Ações**, Secrets permitem consultar **Usos**, editar metadados, rotacionar, revogar e excluir; chaves PEM permitem atualizar a senha da chave e excluir. As ações de gerenciamento respeitam propriedade e administração. Antes de revogar ou excluir um Secret, consulte os usos em hosts e snippets e revise o aviso: referências existentes podem deixar de funcionar.

Se uma origem falhar, os registros da outra continuam disponíveis. Use **Tentar novamente** para recarregar. Trocar o contexto ou atualizar o catálogo fecha os formulários abertos; alterações ainda não salvas precisam ser informadas novamente. Abrir o cofre não encerra a sessão do terminal.


Na coluna **Acesso** das chaves PEM, o cofre mostra o nome cadastrado do proprietário junto ao ID. Se esse nome não estiver disponível na resposta, mantém a identificação pelo ID. Isso não altera permissões sobre a chave.

### Revelar ou copiar uma senha
Este piloto exige HTTPS, autenticador TOTP do NodeAccess, licença Secrets e habilitação explícita pelos gestores do cofre. Por padrão, só contas com login local destravam o cofre; quando o administrador habilita a confirmação para outros métodos, contas LDAP, OIDC e Google também podem usar, conforme a política de login do tenant. Acesso de emergência (break-glass) nunca destrava o cofre. Em acesso HTTP, inclusive no ambiente de desenvolvimento, um aviso informa a exigência de HTTPS e os botões de revelar/copiar ficam desabilitados. Durante uma operação, os botões também ficam indisponíveis para evitar solicitações simultâneas. Permissão de administrar ou ser proprietário de um Secret não concede permissão de revelar ou copiar. Cada ação tem sua própria autorização, e o item precisa estar habilitado para entrega. Os botões não indicam que você já tem essa permissão. Chaves PEM não participam desse fluxo.

1. Na linha de um Secret ativo, selecione **Revelar senha** ou **Copiar senha**.
2. Se solicitado, confirme sua identidade. A tela mostra o formulário certo para o seu tipo de login:
   - **Login local ou LDAP:** informe sua senha (no LDAP, a senha do diretório) e o **Código do autenticador (6 dígitos)**. Selecione **Desbloquear e continuar**.
   - **Login OIDC ou Google:** selecione **Confirmar no provedor de login**. No OIDC, uma janela do provedor pede seu login de novo; no Google, escolha a conta no botão do Google. Depois, se solicitado, informe o **Código do autenticador** (no Google ele é sempre pedido). Permita janelas pop-up do portal.

   A senha do Windows não é utilizada neste piloto.
3. Ao revelar, confira o valor na janela e use **Ocultar senha** quando terminar. O valor é descartado em até 15 segundos, podendo expirar antes conforme a autorização.
4. Ao copiar, selecione **Confirmar cópia** em até 15 segundos. Essa ação não exibe a senha e exige autorização própria. Confira a confirmação; se o navegador negar acesso à área de transferência, o valor é descartado e uma nova tentativa exige nova operação.
5. Use **Bloquear cofre** para encerrar a sessão local do cofre. Sair da tela, ocultar a aba, perder o foco da janela ou mudar o contexto também descarta os valores. Enquanto você confirma no provedor de login, a janela do provedor pode tirar o foco sem cancelar a confirmação; nenhum valor é exibido nessa etapa, que expira em cinco minutos. Isso não faz logout do portal nem encerra as conexões do terminal.

Por padrão, a prova de identidade para revelar e copiar precisa ser renovada após aproximadamente um minuto; os gestores do cofre podem ampliar esse tempo no tenant para até 15 minutos (veja **Tempo de confirmação** abaixo). Sem atividade, o backend limita a sessão a cinco minutos, com duração absoluta de até trinta minutos; a interface pode bloquear antes por privacidade. Novos registros de cliente são limitados a dez por hora por usuário: alternar frequentemente entre o cofre e outras telas pode atingir esse limite. Aguarde se isso ocorrer.

**Não foi possível confirmar sua identidade:** a senha ou o código do autenticador não conferiram para a conta conectada (a mensagem não diz qual); confira e tente de novo — vale também na página de conexão da extensão. **Acesso negado:** consulte os gestores do cofre; ser administrador não contorna a política. **Autorização expirada ou resposta perdida:** não há repetição automática da entrega; feche a janela e solicite uma nova operação. **Autenticação do portal precisa ser renovada:** renove sua sessão do portal antes de tentar novamente. **Janela do provedor não abriu:** permita pop-ups do portal e selecione **Confirmar no provedor de login** de novo. **Confirmação não concluída:** feche a janela do provedor e tente novamente; cada tentativa vale uma vez. Falhas do cofre não iniciam recuperação global do terminal.

A área de transferência pertence ao dispositivo e pode ser acessada por outros aplicativos. O cofre não garante apagamento posterior nem revogação de uma senha já entregue. Gerencie a área de transferência e rotacione a senha no destino quando necessário.

### Conectar a extensão do navegador (piloto)
A extensão VaultNAccess para Chrome e Edge busca os nomes e tipos dos itens que você já pode ver no portal e abre o item no NodeAccess. Revelar e copiar dependem das permissões e da liberação do item. O recurso fica desligado por padrão: o operador da instalação precisa habilitá-lo e informar o identificador da extensão permitida, e dois gestores do cofre precisam conceder a você a permissão **Usar extensão** (quem concede não pode ser você nem o mesmo gestor que aprova). Valem os mesmos requisitos do cofre: HTTPS, autenticador TOTP e confirmação de identidade do seu tipo de login.

**Instalar:** quando a instalação publicou o pacote oficial, o VaultNAccess mostra **Instalar a extensão VaultNAccess**, com a versão, o ID, o SHA-256 e **Baixar pacote**. Siga **Como instalar no Chrome ou Edge** (descompactar, ativar o Modo do desenvolvedor, **Carregar sem compactação**). Em empresas com navegador gerenciado, o administrador vê o valor da política **ExtensionInstallForcelist**, que instala e atualiza a extensão automaticamente.

1. Na extensão, selecione **Conectar ao NodeAccess**. O navegador abre a página **Conectar a extensão VaultNAccess** do portal; se pedido, entre no portal primeiro.
2. Confira a extensão, o dispositivo e a conta exibidos. O código do dispositivo precisa ser igual ao que a extensão mostra enquanto aguarda a confirmação. Prossiga somente se foi você quem iniciou a conexão e os códigos coincidem; caso contrário, selecione **Negar**.
3. Confirme sua identidade como no cofre (senha e código do autenticador, ou **Confirmar no provedor e permitir**). A janela volta sozinha para a extensão.
4. Na extensão, digite parte do nome (a busca acontece enquanto você digita), filtre por tipo e selecione um item para abri-lo no portal. O portal mostra só esse item; use **Mostrar todos** para voltar à lista completa.

**Revelar e copiar senha na extensão:** quando você tem a permissão (concedida por dois gestores) e o item está liberado, os Secrets mostram os botões de revelar e copiar. Na primeira vez (e depois que o tempo de confirmação do tenant acabar), a extensão pede o **Código do autenticador**. O valor aparece por 15 segundos (ou até **Ocultar**); para copiar, selecione **Confirmar cópia** e depois gerencie a área de transferência do seu dispositivo. Se o item não estiver liberado, a extensão avisa; fale com os gestores do cofre. Em vez do código, você pode selecionar **Confirmar no portal (Windows Hello)**: o portal abre numa aba mostrando o **Dispositivo** (confira se é o mesmo do rodapé da extensão); confirme sua identidade com o Windows Hello ou com a senha e o código. Se o popup continuou aberto, ele segue sozinho; se fechou, reabra a extensão: por até dois minutos, a ação e o item podem ser retomados pelo botão com o nome do item, após nova consulta às permissões. Selecione esse botão para revelar ou copiar; nada é entregue automaticamente ao reabrir. Se a consulta falhar temporariamente, use **Verificar**. Cancelar a confirmação descarta a retomada; se o prazo ou o acesso terminar, selecione novamente um item autorizado.

Atalhos: **Alt+Shift+V** abre a extensão (troque em `chrome://extensions/shortcuts` se conflitar); **/** vai para a busca; **↑/↓** escolhem um item e **Enter** abre; **Esc** limpa a busca. A extensão usa o idioma do portal no momento da conexão (antes de conectar, o do navegador).

**Hosts associados:** selecione essa opção na linha de um Secret ou PEM para consultar onde ele está associado. A lista mostra somente nomes de hosts que você já pode visualizar no portal; não concede acesso adicional. **Conectar pelo NodeAccess** abre o portal e inicia o mesmo fluxo do botão **Conectar** do host, com nova verificação de acesso, disponibilidade e limites de sessões. O marcador de conexão é consumido uma vez: atualizar a página não repete a ação. **Mostrar mais** carrega outra página; **Tentar novamente** repete uma consulta que falhou. A mensagem **Nenhum host disponível para você** não informa se existem hosts ocultos. Buscar outro item ou fechar a lista descarta os resultados locais.

Cada conexão vale por até 30 minutos. Depois da primeira autorização pelo portal, o navegador fica confiável por 7 dias: ao reabrir a extensão (por exemplo, depois de **Atualizar** ou de reiniciar o navegador), ela reconecta sozinha enquanto o seu login no portal estiver ativo; se você saiu do portal, ela pede só o **Código do autenticador** e **Reconectar**. **Autorizar pelo portal** abre a autorização completa a qualquer momento. Cinco códigos errados, **Desconectar** na extensão, revogar o dispositivo, retirar a permissão ou **Desconectar todas** nas sessões de login encerram essa confiança: a próxima conexão volta a ser pelo portal, com senha e código. **Negar** devolve a extensão sem conexão.

Em **VaultNAccess**, o botão **Dispositivos conectados**, ao lado de **Importar chave PEM**, abre a lista dos seus dispositivos com a identificação de cada um (por exemplo, `uMdX-wfAz-cgAS-KMPk`); use **Revogar** para cortar o acesso de um deles imediatamente. O botão não aparece quando o recurso está desligado na instalação.

**Acesso negado:** peça aos gestores do cofre a permissão **Usar extensão**. **Pedido de conexão inválido:** inicie a conexão de novo pela extensão. **A conexão expirou:** conecte novamente. **Atualize a extensão:** a instalação exige uma versão mais nova.

### Criar e editar itens pessoais na extensão

Com a extensão conectada e o servidor atualizado, **Novo Secret** abre o cadastro pessoal. Preencha o alias (letras, números, ponto, sublinhado, dois-pontos ou hífen), a descrição opcional e a senha/valor. **Gerar senha** preenche uma senha aleatória; selecione **Salvar** para cadastrá-la. O item aparece na lista, respeitando o filtro de busca atual.

Nos seus Secrets pessoais, **Editar dados** altera alias e descrição sem carregar ou substituir a senha atual. **Trocar senha** é uma ação separada: informe o novo valor e salve. Essa operação troca o valor guardado no cofre; não muda automaticamente a senha no equipamento ou serviço de destino. Para itens compartilhados, os gestores concedem **Escrever Secrets compartilhados na extensão** uma vez pelo fluxo de dois gestores. Depois, a extensão oferece apenas os grupos e ações permitidos pelas regras do portal; ser membro não autoriza editar Secrets de outro criador. O cadastro continua pessoal por padrão. Essa concessão não modifica as permissões de escrita já existentes no portal.

**Importar PEM** cadastra uma chave pessoal: informe um nome, selecione um arquivo ou cole o conteúdo e, quando necessário, informe a senha da chave. Aguarde a leitura do arquivo e selecione **Salvar**. O servidor valida a chave como no portal; não há exportação do material privado pela extensão.

**Cancelar**, **Esc** ou fechar o popup descarta os campos ainda não enviados. Durante o envio, aguarde o resultado. Se fechar após enviar, confira a lista ao reabrir antes de tentar cadastrar novamente. Valores, chaves e senhas de chave não são guardados no armazenamento persistente da extensão. Campos inválidos detectados antes do envio mantêm os dados na janela e levam o foco ao campo para correção. Em caso de falha após o envio, os campos sensíveis são limpos: corrija os dados e preencha-os de novo. Nome já utilizado pede outro nome; sessão expirada pede reconexão. Se houver erro de rede após salvar, confira a lista antes de reenviar.

### Sites, logins e terminal pela extensão

Em **VaultNAccess → Sites** no portal, ou em **Sites** na extensão, use **Novo item** e escolha **Login** ou **Link**. Um login guarda nome, usuário, senha e os sites HTTPS onde pode ser usado; um link guarda somente a URL. Na extensão, o site atual preenche o endereço inicial. **Gerar senha** cria um valor novo; salvá-lo no cofre não altera a senha no site. Na edição, deixe a senha em branco para manter o valor existente. O cadastro começa pessoal; equipes e organização aparecem conforme seu acesso. Nome, usuário e sites também respeitam as permissões de leitura do item.

**Neste site** mostra os itens da origem HTTPS exata da aba; subdomínios e portas diferentes precisam de cadastro explícito. **Todos os sites** permite buscar os demais itens autorizados. O campo **Host vinculado** associa um host que você pode visualizar. A extensão também reconhece links HTTPS ativos já cadastrados nos hosts do portal, sem exigir cadastrar um login ou repetir esse vínculo. **Hosts deste site** e **Abrir terminal no NodeAccess** oferecem a conexão pelo fluxo normal do portal. Apenas visitar a página não conecta nem preenche nada; se houver vários hosts, escolha o destino.

**Preenchimento — piloto:** fica desligado por padrão na instalação e não deve ser usado com senhas reais antes do pentest. Quando liberado para homologação com dados descartáveis, exige a concessão independente **Preencher login de site na extensão**, aprovada por dois gestores, e **Permitir preenchimento neste login** no item. Abra a extensão pela barra do navegador ou pelo atalho enquanto estiver no site e selecione **Preencher**. Se necessário, confirme a identidade no portal e volte à extensão: confira o login e selecione **Confirmar preenchimento**. A confirmação não preenche sozinha; se a retomada expirar, selecione novamente o login. A extensão preenche usuário/senha no formulário visível, mas não envia o formulário: confira e entre. Mudar de aba/documento, expirar a confirmação, retirar acesso ou encontrar formulário ambíguo cancela a operação. Iframes, formulários de troca/cadastro de senha e preenchimento sem clique não fazem parte deste piloto.

Os campos são verificados antes de solicitar a senha. Em logins divididos em etapas, preencha primeiro o usuário e avance pelo próprio site. Na página da senha, abra a extensão e selecione novamente **Preencher**: cada etapa exige um gesto separado e uma nova verificação do formulário. Formulários ambíguos não são preenchidos. Se sair da extensão ou trocar a identidade durante a espera, uma resposta atrasada é descartada antes de enviar os valores à página. Fechar o popup depois de selecionar **Preencher** pode deixar a operação já iniciada terminar no mesmo documento; reabrir não repete o preenchimento. Reiniciar o serviço pode cancelar uma operação pendente: selecione o login novamente, sem recadastrar os dados.

**Sugestões no formulário:** na extensão aberta sobre o site HTTPS, selecione **Ativar sugestões neste site**. A assistência é opcional, vale por até dois minutos no documento atual e mostra somente logins autorizados para essa origem. Escolher uma sugestão exige sua ação; não envia o formulário. Ao navegar, ocultar a página ou expirar o prazo, ative novamente se necessário.

**Revisar um login capturado:** antes de ativar as sugestões, marque **Também oferecer salvar o login deste formulário** se quiser essa assistência. Após sua ação de envio no site, a extensão pode oferecer uma revisão do usuário e da senha, inclusive de uma troca de senha reconhecida. Essa oferta não confirma que o site aceitou o login ou a alteração. Abra a revisão, confira os dados e, em **Salvar como**, escolha um novo login pessoal ou um login autorizado e editável desse site. Se a captura não trouxe usuário, a atualização mantém o usuário do item escolhido. Só **Salvar** grava no cofre; o formulário existente não é substituído sem sua escolha. Use **Descartar** ou **Cancelar** para abandonar a proposta. O rascunho expira em até dois minutos.

**Gerar uma senha:** abra **Opções da senha**, escolha de 8 a 128 caracteres e pelo menos um tipo entre maiúsculas, minúsculas, números e símbolos. Selecione **Gerar senha**, revise e salve. A geração usa a aleatoriedade criptográfica do navegador. Salvar no cofre não troca a senha no site: conclua a mudança no serviço e confirme o resultado antes de depender do novo valor.

**Favoritos e recentes:** marque **Favorito** nos sites ou hosts disponíveis para você. Em Sites, **Favoritos** e **Recentes** filtram e ordenam os itens já carregados; use a busca e a paginação para localizar outros itens autorizados. O navegador guarda apenas identificadores e datas de uso, separados pelo contexto da conta, tenant e dispositivo; não guarda nomes ou senhas nessas preferências. Há limite de 100 favoritos e 30 recentes; recentes com mais de 90 dias são descartados. Um recente indica uma ação solicitada, não garante conexão ou login bem-sucedido. Favoritar não concede acesso e não torna visível um item que deixou de ser autorizado.

**Continuar uma edição após Windows Hello:** se **Salvar** pedir confirmação de identidade, confirme no portal e reabra a extensão se o popup fechou. O rascunho fica somente em memória por até dois minutos, sem armazenamento local ou de sessão; confirme os campos e selecione **Salvar** novamente. A confirmação não grava automaticamente. Cancelar, expirar ou mudar de identidade descarta a retomada. Se o item mudou ou o acesso foi retirado, a gravação será recusada; consulte a lista antes de tentar novamente. Em falha de gravação com resultado incerto, a senha é apagada e não há repetição automática.

Na busca, **Mostrar mais** preserva os resultados anteriores; se a próxima página falhar, **Tentar novamente** repete somente essa página. Criar ou editar leva o foco ao nome; cancelar ou salvar devolve o foco a **Novo item**, permitindo continuar pelo teclado.

### Diagnosticar acesso a valores (gestores)

Depois de abrir **Permissões do cofre (gestores)** e confirmar a identidade, **Configuração de acesso** permite escolher um usuário e o ID de um Secret que você pode identificar. O resultado explica política, concessões, liberação/revogação do item e acesso ao recurso. A confirmação existente é reutilizada; não há nova senha só para consultar. O diagnóstico não mostra valores e não garante que a sessão ou o dispositivo estejam aptos naquele momento. Ao expirar, use os controles de confirmação da própria seção.

### Conceder permissões do cofre (gestores)
Gestores do cofre veem, em **VaultNAccess**, a seção **Permissões do cofre (gestores)**. Também podem abrir as permissões de uma pessoa direto em **Administração › Usuários**: no menu de ações do usuário, selecione **Permissões do cofre**. A janela mostra só aquele usuário e as propostas dele, com as mesmas regras e os mesmos passos abaixo. Ela concede ou retira, por usuário, **Revelar**, **Copiar**, **Usar extensão** e **Gestor do cofre**. Cada mudança é proposta por um gestor e aprovada por outro gestor dentro da validade da proposta (padrão de 2 minutos; veja **Validade das propostas** abaixo); a pessoa afetada nunca participa, e você não altera as suas próprias permissões nem a sua própria gestão.

1. Selecione **Administrar permissões** e confirme sua identidade (senha e código do autenticador, ou **Confirmar no provedor**). A confirmação vale por 1 minuto; depois disso, confirme de novo.
2. Na linha do usuário, selecione **Propor ativar** ou **Propor retirar** na permissão desejada. A proposta aparece em **Propostas aguardando aprovação**, com o tempo restante.
3. Peça a outro gestor para entrar com a própria conta, confirmar a identidade e selecionar **Aprovar** na proposta. Não pode ser quem propôs nem quem é afetado. Nas suas propostas aparece **aguardando outro gestor aprovar**; numa proposta sobre você, aparece que outro gestor precisa aprovar.

**Avisos de pendência:** quando há propostas que você pode aprovar, **Administração › Usuários** mostra **N alterações do cofre aguardam sua aprovação** com o botão **Revisar**, que abre só a lista de propostas; a seção do VaultNAccess mostra o mesmo aviso antes de confirmar a identidade. Na lista de usuários, a etiqueta **Gestor do cofre** identifica os gestores (visível só para gestores). O aviso é atualizado a cada minuto e ao fechar a janela.

**Gestores do cofre:** a ativação do cofre do tenant define os dois primeiros gestores. Depois, a coluna **Gestor do cofre** inclui ou retira gestores pela mesma regra de dois gestores. Ser administrador ou superadministrador do NodeAccess não torna ninguém gestor nem permite promover alguém sozinho, porque o administrador pode criar contas e redefinir senha e autenticador. Um administrador que não é gestor vê uma explicação no VaultNAccess, e a ação **Permissões do cofre (só gestores do cofre)** aparece desabilitada em **Usuários**.

Em **Administração › Configurações › Cofre (VaultNAccess)**, um administrador que ainda não é gestor consulta os valores e vê a orientação para solicitar sua indicação a um gestor e aprovação a outro. Se o tenant ainda não tem gestores, o responsável pela instalação precisa configurar os dois primeiros; essa ativação inicial não é feita nessa tela. Para disponibilizar revelar/copiar, os gestores precisam habilitar a política do tenant, conceder a ação ao usuário e liberar o item. Habilitar apenas a política não concede acesso automaticamente.

**Quando o botão fica desabilitado:** uma mudança para outro gestor precisa de um terceiro gestor para aprovar. Com apenas dois gestores, os botões na linha do outro gestor ficam desabilitados e a seção explica o motivo; torne mais um usuário gestor para liberar. Pelo mesmo motivo, retirar um gestor só é possível com pelo menos três, e o cofre sempre mantém pelo menos dois.

Cada aprovação bloqueia o cofre para todos, inclusive para os gestores: quem estava com o cofre aberto precisa confirmar a identidade de novo. Retirar **Usar extensão** desconecta na hora todos os dispositivos daquela pessoa. Mudanças de política do cofre e de itens aparecem na lista sem o botão **Aprovar**: são revisadas e aprovadas pela administração da instalação.

Retirar um gestor apaga as propostas abertas dele, e reduzir a validade encurta as propostas já abertas. Propostas que não podem mais ser aprovadas (por exemplo, de quem deixou de ser gestor ou para uma conta desativada) somem da lista. Desativar ou excluir a conta de um gestor na guia **Usuários** também o retira da contagem: mantenha pelo menos dois gestores ativos.

**Nenhum outro gestor poderia aprovar:** a proposta foi recusada porque só restariam quem propõe e quem é afetado; torne mais um usuário gestor e tente de novo. O cofre continua aberto.

### Tempo de confirmação (gestores)
Em **Configurações → Cofre (VaultNAccess)** (ou, para gestores que não são administradores, em **Permissões do cofre (gestores)** do VaultNAccess), **Tempo de confirmação para revelar e copiar** mostra por quantos minutos, depois de confirmar a identidade, revelar e copiar ficam liberados sem pedir a confirmação de novo. O padrão é 1 minuto, e o máximo é 15. Para mudar, informe os **Minutos** e selecione **Propor novo tempo**; outro gestor aprova na lista de propostas, como numa permissão. Ao aprovar, o cofre é bloqueado para todos.

O tempo vale só enquanto o cofre estiver aberto: sem atividade por 5 minutos, ou após 30 minutos, o cofre bloqueia de qualquer forma. Administrar permissões e conectar a extensão continuam pedindo confirmação de 1 minuto.

### Windows Hello / chave de acesso no cofre
Em **VaultNAccess**, o botão **Windows Hello** abre **Windows Hello e chaves de acesso**. Para cadastrar este dispositivo, informe um nome, selecione **Cadastrar este dispositivo**, confirme sua identidade (senha e código do autenticador) e siga o pedido do Windows Hello (rosto, digital ou PIN). Depois disso, as confirmações do cofre (revelar, copiar e permissões dos gestores) mostram **Usar Windows Hello / chave de acesso**; a senha e o código continuam disponíveis logo abaixo. Para tirar um dispositivo, selecione **Remover** e confirme. O botão só aparece quando o portal é acessado por um nome (por exemplo, o domínio da empresa), não por endereço IP, e o navegador suporta chaves de acesso.

### Entrega de senhas no tenant e itens liberados (gestores)
Para que alguém revele ou copie uma senha, três coisas precisam estar ligadas, cada uma aprovada por dois gestores: a **Entrega de senhas no tenant** (revelar e copiar), a permissão **Revelar** ou **Copiar** da pessoa e a liberação do item.

1. Em **Configurações → Cofre (VaultNAccess)** (`/admin/settings`), os administradores veem os valores atuais do cofre sem desbloqueá-lo. Gestores do cofre selecionam **Alterar configurações do cofre**, confirmam a identidade, marcam **Permitir revelar** e/ou **Permitir copiar** em **Entrega de senhas no tenant** e selecionam **Propor mudança**. **Entregas por minuto no tenant** limita quantas entregas o tenant faz por minuto. O tempo de confirmação e a validade das propostas também ficam nessa seção. Um gestor do cofre que não é administrador do tenant encontra esses blocos em **Permissões do cofre (gestores)**, na própria página do cofre.
2. Para liberar um item, na lista do cofre selecione **Ações → Entrega do item…** na linha do Secret e depois **Propor liberação**. A seção dos gestores lista os **Itens liberados para revelar e copiar**, com **Retirar liberação**.
3. Outro gestor aprova em **Propostas aguardando aprovação**, vendo o conteúdo (valores da política ou nome do item). Enquanto uma proposta igual espera aprovação, a tela mostra **Aguardando aprovação** no lugar do botão.

Quem não pode revelar ou copiar vê o motivo antes de qualquer senha: um aviso no topo do cofre quando a entrega está desligada no tenant ou a pessoa não tem permissão, e **Item não liberado** na coluna **Valores protegidos** do item. No celular, o motivo aparece junto ao nome do item. Gestores veem **Abrir permissões do cofre** no aviso.

### Validade das propostas (gestores)
Em **Configurações → Cofre (VaultNAccess)**, **Validade das propostas** é onde os gestores definem por quanto tempo uma proposta fica aberta esperando outro gestor aprovar: de 2 minutos (padrão) a 24 horas. Escolha a **Validade** e selecione **Propor nova validade**; outro gestor aprova na lista de propostas. A nova validade vale para as propostas criadas depois da aprovação. Propostas mais longas facilitam a aprovação por gestores em outros horários, mas ficam abertas por mais tempo; a aprovação continua exigindo a confirmação de identidade do segundo gestor.

### Sessões de login dos usuários (administradores)
Em **Administração › Usuários**, a etiqueta **Online** ao lado do nome mostra quem usou o NodeAccess nos últimos 15 minutos e quantas sessões de login estão ativas. No menu de ações do usuário, **Sessões de login** lista cada login com o IP do último uso (e o IP do login, quando mudou), navegador, método de login, início e último uso. A sua própria sessão aparece como **Esta sessão** e não pode ser desconectada por aqui; use **Sair**.

1. Para encerrar um login desconhecido, selecione **Desconectar** na linha do IP e confirme. A sessão perde o acesso na próxima ação, e a pessoa precisa entrar de novo naquele dispositivo. As outras sessões continuam.
2. Para encerrar tudo, selecione **Desconectar todas** e confirme. Todas as sessões da pessoa terminam, inclusive terminais e acessos gráficos abertos.

Desconectar uma única sessão não fecha terminais que ela já tinha aberto; para isso, use **Desconectar todas** ou encerre o terminal em **Sessões**. Logins feitos antes desta versão aparecem na lista depois do primeiro uso (em até 15 minutos).

## Entenda os indicadores
- Cards e listas reutilizam os ícones de protocolo do acesso rápido. O ícone da rota informa acesso direto, automático ou por Agent/conector. Passe o mouse, toque ou use **Tab** para consultar a descrição e a disponibilidade; **Esc** fecha a dica. O botão **Conectar** informa o motivo quando uma rota obrigatória não está disponível.
- No **Acesso rápido**, a pasta aparece junto ao endereço quando há espaço, seguida do relógio e da data do último acesso em **dia/mês**; a dica mostra a data por extenso e o horário. **Raiz** indica que o host está no diretório raiz do inventário. A dica da pasta mostra o caminho disponível, como **Raiz → Banco de dados → Dbs**. Se um ancestral não estiver disponível, o caminho pode aparecer parcial; a interface não presume pastas que você não pode consultar. O ícone no canto superior direito do card identifica o protocolo: terminal com cadeado para SSH, monitor para RDP, terminal com T para Telnet e monitor com V para VNC. Passe o mouse ou toque no ícone para consultar seu protocolo sem conectar. Passe o mouse ou toque no relógio para consultar o último acesso sem conectar. Pelo teclado, focar o card mostra o protocolo e o último acesso; **Esc** fecha a dica. **Sessão ativa** continua visível no card.
- **Sessões abertas** reúne suas conexões visíveis no contexto atual. Trocar de página não é uma ação de encerramento.
- O número laranja de uma aba indica **atualizações de saída ainda não vistas**. Vários blocos podem formar uma atualização; o número não representa comandos, pessoas ou sessões. Ao visualizar a aba, a contagem é zerada.
- Indicadores de presença e quantidade de sessões no host têm outra finalidade: mostram atividade associada ao equipamento, conforme sua permissão.

## Exemplo de uso
Você iniciou uma manutenção, voltou a Hosts para consultar outro equipamento e quer continuar o trabalho anterior. Escolha o cartão em Sessões abertas em vez de iniciar uma segunda conexão.

## Se algo não funcionar
**Windows Hello não aparece ou foi recusado:** confira se o dispositivo está cadastrado em **Windows Hello** e se o portal foi aberto pelo nome (não por IP). Se a confirmação foi cancelada ou não reconheceu a chave, tente de novo ou use a senha e o código.

**Revelar ou copiar não aparece em um Secret:** leia o aviso no topo do cofre ou o motivo na coluna **Valores protegidos** (**Desligado no tenant**, **Sem permissão** ou **Item não liberado**) e peça aos gestores do cofre o que falta.

**A pasta não mostra os hosts:** aguarde o carregamento e use a ação de tentar novamente quando disponível. Confira o filtro e o tenant selecionado.

**Conectar indisponível ou acesso negado:** consulte a dica da ação. Uma rota que exige Agent ou conector depende da disponibilidade desse recurso; confira a conexão do Agent e o conector configurado para o host. O modo automático pode usar o acesso direto quando permitido. Se a causa for permissão, confirme o acesso com o administrador. Alterar filtros ou favoritar o host não concede acesso.

**Uma sessão desapareceu ao trocar de tenant:** volte ao contexto original antes de concluir que ela foi encerrada. Consulte [Troca de tenant](/manual/tenants) para entender o retorno.

**O cadastro indica um campo inválido:** confira a mensagem. Nas validações locais de campos obrigatórios, o formulário abre a aba correspondente e leva o foco ao campo para correção. Se houver falha ao salvar, os dados permanecem no formulário para revisar e tentar novamente.

**Um recurso não aparece:** confira o protocolo, o perfil do equipamento, suas permissões e se o host já foi salvo. Nem todos os protocolos oferecem autenticação SSH, bastion, túneis ou macros.

## Resultado esperado
O host escolhido corresponde ao destino desejado e a conexão é iniciada ou retomada conforme a ação selecionada. Não há necessidade de duplicar uma sessão para voltar a ela.

Ao cadastrar ou editar, os dados são salvos no destino e na pasta corporativa selecionados. O resultado do teste de conexão não substitui a confirmação de salvamento.


### Chave do servidor e bastion
Antes de aceitar uma chave SSH nova ou alterada, confirme a fingerprint com o responsável
pelo servidor por um canal confiável. A senha correta não substitui essa verificação.

Se a conexão usar um bastion, confira também o Host que lhe deu origem. Abra esse Host pelo
fluxo normal e valide sua chave antes de conectar ao destino. Uma falha de identidade do
bastion não deve ser resolvida aceitando sua chave no cadastro do destino. Bastions antigos
sem Host de origem precisam ser regularizados por um administrador, vinculando a rota a
um Host com chave verificada; a conexão permanece bloqueada até essa correção.
