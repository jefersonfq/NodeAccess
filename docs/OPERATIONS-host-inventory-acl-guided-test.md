# Teste Guiado - Inventario Corporativo e ACL

## Objetivo

Validar o fluxo operacional de ACL do ponto de vista de:

- admin que cria pastas, move hosts e concede permissoes;
- usuario que consome o acesso concedido;
- suporte que diagnostica por que um host aparece, some ou bloqueia conexao.

Use este roteiro em ambiente de teste com dois navegadores ou janelas anonimas:

- sessao A: usuario admin;
- sessao B: usuario comum.

## Dados sugeridos

Preencha antes de iniciar:

| Campo | Valor |
| --- | --- |
| Admin |  |
| Usuario comum |  |
| Grupo de teste |  |
| Pasta corporativa |  |
| Host de teste |  |
| Protocolo | SSH / RDP / SFTP / outro |

## Conceitos que o validador deve confirmar

- ACL define quem ve, conecta, edita e administra permissoes.
- Configuracao tecnica do host define como conectar.
- Grupo define conjunto de pessoas, nao conjunto de hosts.
- Pasta pessoal organiza a visao individual e nao concede acesso.
- Pasta corporativa define governanca e heranca de acesso.
- Sem `Visualizar`, o host nao deve aparecer.
- Com `Visualizar` e sem `Conectar`, o host aparece, mas nao abre sessao.
- Com `Conectar`, a sessao abre se o host estiver tecnicamente configurado.
- Com `Editar`, o usuario pode alterar configuracao do host.
- Com `Administrar ACL`, o usuario pode gerenciar permissoes daquele item.

## Fluxo 1 - Criar estrutura corporativa

Executor: admin.

1. Acesse `/admin/acl`.
2. Crie uma pasta corporativa de teste.
3. Selecione a pasta criada na arvore.
4. Confirme que o painel de permissoes mostra a pasta selecionada.
5. Conceda ACL para o grupo de teste com:
   - `Visualizar`;
   - `Conectar`;
   - sem `Editar`;
   - sem `Administrar ACL`.
6. Confirme se a permissao aparece como ACL local da pasta.

Resultado esperado:

- A pasta existe na arvore corporativa.
- A permissao do grupo aparece na pasta.
- A permissao herda para itens abaixo.

Checklist:

- [ ] Pasta criada.
- [ ] Grupo adicionado.
- [ ] Visualizar concedido.
- [ ] Conectar concedido.
- [ ] Editar nao concedido.
- [ ] Administrar ACL nao concedido.

## Fluxo 2 - Criar ou mover host para a pasta corporativa

Executor: admin.

1. Acesse a tela de hosts.
2. Crie um host novo ou edite um host de teste existente.
3. No campo de inventario corporativo, selecione a pasta criada no Fluxo 1.
4. Salve.
5. Volte para `/admin/acl`.
6. Use o diagnostico "Por que este usuario acessa este host?".
7. Selecione o host e o usuario comum.
8. Clique em diagnosticar.

Resultado esperado:

- O diagnostico mostra acesso final com `Visualizar` e `Conectar`.
- A fonte indica o grupo de teste.
- A origem indica a pasta corporativa.
- O botao "Ver na arvore" abre a pasta correta.

Checklist:

- [ ] Host vinculado a pasta corporativa correta.
- [ ] Diagnostico encontra o host por nome, IP ou ID.
- [ ] Diagnostico mostra grupo correto.
- [ ] Diagnostico mostra permissao herdada da pasta.
- [ ] "Ver na arvore" seleciona a pasta correta.

## Fluxo 3 - Usuario consome acesso concedido

Executor: usuario comum.

1. Na sessao B, acesse a tela de hosts.
2. Confirme que a pasta corporativa aparece no sidebar.
3. Abra a pasta corporativa.
4. Confirme que o host aparece.
5. Clique em `Conectar`.

Resultado esperado:

- O host aparece para o usuario comum.
- O botao `Conectar` fica habilitado.
- A sessao abre se a configuracao tecnica do host estiver correta.

Checklist:

- [ ] Pasta corporativa visivel.
- [ ] Host visivel.
- [ ] Conectar habilitado.
- [ ] Sessao abriu ou falhou apenas por configuracao tecnica do host.

## Fluxo 4 - Visualizar sem conectar

Executor: admin e usuario comum.

1. Na sessao A, volte para `/admin/acl`.
2. Na ACL do grupo de teste, remova `Conectar` e mantenha `Visualizar`.
3. Salve.
4. Na sessao B, aguarde o refresh ou observe o aviso de atualizacao de acessos.
5. Confirme o host na lista.
6. Tente conectar.

Resultado esperado:

- O host continua aparecendo.
- O botao/acao de conectar fica bloqueado.
- O usuario recebe feedback de que precisa da permissao `Conectar`.

Checklist:

- [ ] Host continuou visivel.
- [ ] Conectar ficou bloqueado.
- [ ] Mensagem de bloqueio ficou clara.
- [ ] Diagnostico mostra acesso final `Visualizar`.

## Fluxo 5 - Remover visualizacao

Executor: admin e usuario comum.

1. Na sessao A, remova a ACL do grupo de teste ou remova `Visualizar`.
2. Salve.
3. Na sessao B, aguarde o refresh de ACL.
4. Verifique a tela de hosts.
5. Use `/admin/acl` para diagnosticar o mesmo usuario e host.

Resultado esperado:

- O host some da lista do usuario comum.
- O diagnostico mostra que nao ha ACL aplicavel.
- A visao "O que este usuario acessa?" deixa de listar essa fonte, se ela era a unica.

Checklist:

- [ ] Host sumiu para o usuario comum.
- [ ] Diagnostico mostra sem acesso.
- [ ] Lista "O que este usuario acessa?" foi atualizada.

## Fluxo 6 - Revogacao com sessao aberta

Executor: admin e usuario comum.

1. Na sessao A, conceda novamente `Visualizar` e `Conectar`.
2. Na sessao B, abra uma sessao no host.
3. Na sessao A, remova `Conectar`.
4. Aguarde o evento de ACL.
5. Observe a sessao aberta na sessao B.

Resultado esperado:

- Novas conexoes ficam bloqueadas.
- Sessao aberta deve ser encerrada quando o usuario perde `Conectar`.
- A mensagem de encerramento deve indicar revogacao por ACL ou permissao removida.

Checklist:

- [ ] Sessao estava aberta antes da revogacao.
- [ ] Remocao de `Conectar` foi salva.
- [ ] Sessao aberta foi encerrada.
- [ ] Mensagem de encerramento ficou compreensivel.
- [ ] Nova tentativa de conectar ficou bloqueada.

## Fluxo 7 - Visao inversa por usuario

Executor: admin.

1. Acesse `/admin/acl`.
2. Na secao "O que este usuario acessa?", selecione o usuario comum.
3. Clique em listar acessos.
4. Valide as fontes exibidas.
5. Clique em "Ver na arvore" em cada fonte relevante.

Resultado esperado:

- A lista mostra fontes por usuario, grupo ou papel.
- Cada item mostra permissoes e impacto em hosts.
- "Ver na arvore" seleciona a pasta ou host correto.

Checklist:

- [ ] Fontes diretas aparecem quando existem.
- [ ] Fontes via grupo aparecem quando existem.
- [ ] Fontes via papel aparecem quando existem.
- [ ] Quantidade de hosts impactados faz sentido.
- [ ] Botao "Ver na arvore" funciona.

## Fluxo 8 - Importacao ou movimentacao em massa

Executor: admin.

1. Importe ou mova um conjunto pequeno de hosts para uma pasta corporativa.
2. Confirme que a pasta destino exige ACL clara.
3. Valide se os hosts herdam a ACL da pasta destino.
4. Use o diagnostico para um host importado.
5. Acesse com o usuario comum.

Resultado esperado:

- Hosts ficam vinculados a pasta corporativa.
- Permissoes efetivas vem da pasta destino.
- Usuario comum ve/conecta apenas conforme ACL da pasta.

Checklist:

- [ ] Hosts foram para a pasta correta.
- [ ] ACL herdada foi aplicada.
- [ ] Diagnostico mostra fonte correta.
- [ ] Usuario comum ve apenas o que deve.

## Registro de resultado

| Fluxo | Status | Observacoes |
| --- | --- | --- |
| 1 - Criar estrutura |  |  |
| 2 - Vincular host |  |  |
| 3 - Usuario consome |  |  |
| 4 - Visualizar sem conectar |  |  |
| 5 - Remover visualizacao |  |  |
| 6 - Revogacao com sessao aberta |  |  |
| 7 - Visao inversa |  |  |
| 8 - Massa/importacao |  |  |

## Criterio de aceite

A ACL esta operacionalmente validada quando:

- usuario sem `Visualizar` nao ve o host;
- usuario com `Visualizar` e sem `Conectar` ve o host, mas nao conecta;
- usuario com `Conectar` consegue abrir sessao quando a configuracao tecnica esta correta;
- remocao de grupo ou ACL atualiza a tela do usuario;
- remocao de `Conectar` encerra sessoes abertas;
- diagnostico explica origem do acesso;
- visao inversa lista o que o usuario acessa;
- importacao/movimentacao em massa mantem heranca correta.
