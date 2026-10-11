## Quando usar
O gerenciamento delegado permite ao administrador da plataforma atuar em outro tenant. A interface mostra um aviso para deixar esse contexto explícito.

## Antes de começar
O acesso ao gerenciamento de tenants é restrito ao perfil autorizado. Confirme a organização selecionada antes de modificar usuários, equipamentos ou configurações.

## Passo a passo
1. No contexto original, confira suas sessões abertas em Hosts.
2. Acesse a lista de empresas/tenants na administração da plataforma e selecione **Gerenciar** na organização desejada.
3. Confira o aviso de **Modo delegado ativo** e o nome da organização.
4. Ao consultar Hosts nesse tenant, não espere ver as sessões pertencentes ao contexto original. A ausência nessa lista não significa que elas foram encerradas.
5. Para retornar, use a ação de sair do gerenciamento ou selecione **Gerenciar** no tenant da sessão original.
6. Confira que o aviso de modo delegado desapareceu. Volte a Hosts para retomar suas sessões originais ainda ativas.

## Exemplo de uso
Você abriu uma sessão no tenant original e precisa conferir o inventário de um cliente. Entre no gerenciamento do cliente, faça a consulta e retorne à origem. As sessões da origem devem reaparecer no contexto correspondente, sem exigir uma nova conexão apenas pela troca de tenant.

## Se algo não funcionar
**Modo delegado no próprio tenant:** use a ação de sair do gerenciamento. Em versões com o retorno corrigido, selecionar a origem também restaura a sessão original.

**Acesso ao tenant negado:** confirme seu perfil e a disponibilidade do tenant. Uma falha de entrada não deve ser interpretada como troca de contexto concluída.

**Sessão original não reapareceu:** verifique o tenant e o estado da conexão. Expiração, encerramento remoto ou perda de comunicação são condições independentes da navegação.

## Habilitar este manual no tenant
Um administrador do tenant pode acessar **Configurações do tenant → Manual e ajuda**. O piloto começa desativado. Ao habilitar, o menu Manual e os acessos contextuais passam a ficar disponíveis nesse tenant. Alterações em um tenant não habilitam o manual em outro.

## Resultado esperado
O aviso corresponde ao contexto delegado real. Voltar ao tenant da identidade original encerra a delegação; não cria uma nova delegação para a própria organização.
