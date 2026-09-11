# Agentes gerenciados pelas ACLs do usuário

## Comportamento entregue

O fluxo padrão volta a ser **instalar o MSI → informar URL e token → conectar**. Não exige lista de redes, portas ou arquivo JSON. O handshake informa `managed_acl`; o agente recusa um gateway que não anuncie esse contrato. Não envia token na URL e mantém validação TLS.

O token identifica agente, proprietário e tenant; não substitui a autenticação do usuário solicitante. Cada ponte usa `AgentAccessService` antes de abrir TCP e novamente após o estabelecimento:

- Usuário e tenant precisam continuar ativos. O papel é relido do banco, não congelado no JWT.
- Agente pessoal só atende seu proprietário, no mesmo tenant.
- Agente institucional usa a ACL de quem solicita o acesso; o criador não empresta suas permissões.
- O token registrado precisa corresponder ao hash atual da identidade do agente.
- Host, IP e porta devem corresponder ao cadastro autorizado; permissão `connect` é reavaliada no repositório de ACL existente.
- Revogação ou erro de autorização não pode disparar fallback para conexão direta no modo AUTO.
- Diagnóstico de destino ainda não cadastrado exige permissão de gerenciar hosts ou papel administrador. Teste de endereço alterado em host existente exige `edit`. Isso é separado de uma sessão normal, que sempre exige host cadastrado e ACL de conexão.

Pontes em andamento revalidam essas condições a cada 5 segundos, com prazo de 3 segundos para a consulta. Falha/timeout fecha a ponte (prazo nominal de até 8 segundos, sujeito ao escalonamento). Os eventos existentes de ACL continuam encerrando sessões/túneis afetados via controle distribuído. A revalidação cobre também eventos perdidos, alteração de papel e desativação. Outras pontes autorizadas e o agente permanecem online. Conceder acesso permite uma nova conexão sem trocar token, reiniciar ou reinstalar.

## Restrição local opcional

`--policy` continua disponível para o cliente impor limites independentes e adicionais. Ausência de arquivo significa gerenciamento central, não ausência de ACL. Um arquivo explicitamente fornecido e inválido bloqueia a inicialização; arquivo com regras vazias bloqueia destinos. Não há fallback silencioso para modo gerenciado após erro de política.

O desktop não cria mais uma política vazia automaticamente. Se já houver `policy.json` em `%LOCALAPPDATA%\NodeAccess\Agent`, ele continua sendo respeitado, evitando remover uma restrição deliberada. Arquivos vazios criados durante testes da implementação anterior devem ser revisados/removidos pelo administrador para aderir ao padrão gerenciado. Os instaladores Unix também tornam `--policy` opcional e preservam restrições existentes. Assinatura de distribuição e TLS continuam obrigatórios fora de laboratório.

## Auditoria

Já existiam eventos de criação, emissão de token, revogação, exclusão e algumas edições. Os eventos administrativos deixaram de ser best-effort: alteração e auditoria agora usam **a mesma transação**. Se o log falhar, a alteração não é confirmada, inclusive emissão/rotação de token. Invalidação dos sockets ocorre após o commit.

Eventos: `agent_created`, `agent_token_issued`, `agent_reactivated`, `agent_revoked`, `agent_deleted`, `agent_default_updated`, `agent_drain_started`, `agent_maintenance_ended`, `agent_token_rotated`, `agent_pool_updated`. Pool/prioridade, pausa e agente padrão registram antes/depois. Os snapshots incluem tenant, agente, proprietário e modo de autorização, sem token ou hash. Ator e horário ficam no registro de auditoria. Revogação de ponte registra `agent_connection_access_revoked` com solicitante, host e conexão; falha desse log operacional não impede fechar a ponte e é registrada no logger.

`GET /agents/:id/history` inclui ator/detalhes e continua funcionando após exclusão lógica, com validação de tenant e proprietário/administrador. Histórico também permanece no repositório geral de auditoria. Não foi criada uma nova tela de edição: foram cobertas as operações existentes de configuração, pool, prioridade, pausa e padrão.

## Evidências e reprodução

- Typecheck backend aprovado.
- Suíte de agentes + revogação de inventário + ACL SSH: 79 testes aprovados, incluindo sucesso, negação, token girado, tenant/proprietário incorretos, usuário inativo, destino alterado, falha/timeout do banco, alteração durante abertura, preservação de outro usuário em agente compartilhado e histórico após exclusão.
- Runtime/criptografia: 15 testes aprovados nos modos gerenciado e restrição local, incluindo token inválido, gateway incompatível, reconexão e erro TCP.
- 14 testes de concorrência/túneis aprovados validam que AUTO não contorna negação de ACL. Testes opt-in antigos de túneis que exigem configuração própria não foram contabilizados como executados.
- `tools/agents/security-live.mjs`: WSS com CA de laboratório, MySQL e Redis reais, SSH descartável e binário Linux recompilado. Sem `--policy`: nega ACL ausente, concede, abre SSH, revoga/fecha, concede novamente, gira token, audita alterações e consulta histórico após exclusão. Injeta falha no log dentro de transação MySQL e comprova rollback da revogação. Cria e remove seus próprios dados.
- `HOST_ID=<host-descartavel> FRONTEND_BASE=<frontend-isolado> npm run test:terminal-pty:real`: `top`/`htop` aprovados via host `AGENT_USER`, gateway isolado com código novo e agente compilado, sem política local. Relatórios em `/tmp/nodeaccess-acl-pty/`.
- Assistente Windows: testes de configuração e ACL de arquivos aprovados. EXE Windows recompilado em laboratório e executado nativamente: URL/token sem criação de política, registro, preservação da configuração após token inválido, troca de token e encerramento do processo aprovados. O servidor local desse teste usa `--development`; não altera a validação TLS do instalador. Publicação do MSI assinado continua dependendo da identidade oficial de assinatura, conforme revisão anterior.

A atualização do gateway deve preceder a do agente. Não houve publicação de release nem atualização de instalações de clientes.
