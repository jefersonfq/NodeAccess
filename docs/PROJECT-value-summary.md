# NodeAccess: resumo de valor

## Manutencao documental obrigatoria
Este resumo deve permanecer alinhado ao inventario funcional em
`docs/PROJECT-functional-context-nodeaccess.md`.

Sempre que uma funcionalidade, facilidade, integracao, agente, permissao,
relatorio, modulo ou recurso de seguranca alterar a proposta de valor, os
beneficios, a prova comercial ou a narrativa de produto, atualizar este arquivo
junto com:

- `docs/PROJECT-functional-context-nodeaccess.md`
- `docs/PRD-lite.md`
- `docs/PRD-map-lite.md`, quando houver novo PRD ou mudanca de status
- `README.md`, quando a mudanca afetar apresentacao, instalacao ou operacao
- PRD/guia operacional do dominio afetado

## Proposta de valor
O NodeAccess centraliza o acesso SSH corporativo em uma camada web segura, auditavel e orientada a operacao. A plataforma reduz dependencia de clientes locais, configuracoes manuais, credenciais espalhadas e conhecimento informal, preservando a velocidade que times tecnicos precisam para acessar muitos hosts no dia a dia.

O produto nao se limita a um terminal no navegador. Ele tambem oferece um SSH Gateway auditavel: o usuario pode continuar usando um cliente SSH nativo, enquanto autenticacao, MFA, permissao, resolucao do host, credencial protegida e auditoria continuam passando pelo NodeAccess.

Para uma visao funcional detalhada de recursos, menus, agentes, integracoes,
casos de uso e capacidades operacionais, use
`docs/PROJECT-functional-context-nodeaccess.md`.

## Publico alvo
- Times de infraestrutura, cloud, redes, DevOps, SRE, NOC e suporte tecnico.
- Empresas com muitos servidores Linux, ambientes privados ou ativos acessados via SSH.
- Operacoes que precisam de controle de acesso, rastreabilidade, segregacao por times e suporte assistido.
- Organizacoes que querem reduzir senhas e chaves locais sem prejudicar a produtividade tecnica.

## Problemas de negocio
- Acesso SSH fragmentado entre ferramentas, maquinas e padroes individuais.
- Senhas, PEMs, bastions e atalhos locais dificeis de controlar ou revogar.
- Baixa visibilidade sobre quem acessou qual host, quando e com qual contexto operacional.
- Onboarding lento para novos usuarios que precisam localizar hosts, credenciais e padroes.
- Suporte remoto dependente de compartilhamento informal de tela, senha ou comandos.
- Risco elevado em offboarding, permissao indevida, troca de host key e acesso fora de politica.

## O que ja entregamos
- Acesso SSH centralizado via navegador.
- SSH Gateway para conexao por cliente SSH nativo passando pelo NodeAccess.
- MFA/TOTP obrigatorio e controle de autenticacao.
- Hosts com escopo pessoal, equipe e global.
- Inventario corporativo com ACL herdada por pasta e importacao em lote que
  mostra o acesso resultante antes de criar os hosts.
- Separacao clara entre Minhas pastas, que organizam a visualizacao individual,
  e Inventario corporativo, que governa permissao e heranca de acesso.
- Administracao centralizada de permissoes por pasta, sem depender de editar
  host por host para conceder acesso a um conjunto grande.
- Movimentacao governada de lotes de hosts entre pastas de ACL, com preview,
  historico e rollback.
- Suporte a senha, PEM e `PEM + senha`.
- Bastion/jump host por host ou grupo, com visibilidade de impacto e reaproveitamento de PEM cadastrada.
- Sessoes multiplas no terminal web.
- Fullscreen real do terminal, alternador rapido de hosts e busca por abas para localizar sessoes abertas por nome, IP ou porta.
- SFTP e acesso a arquivos.
- Acessos locais (`port forwarding`) integrados ao host, com fallback de porta ativa, linguagem orientada a tarefa e entrada direta pelo host.
- Links JIT de acesso temporario, com uso unico, expiracao, PIN opcional, revogacao e auditoria.
- Integracao com 1Password por referencia.
- Google SSO e base para integracao com Google Workspace.
- Jira integrado ao acesso SSH, com ticket opcional ou obrigatorio e
  rastreabilidade preservada entre reconexoes e abas duplicadas.
- Automacao Jira desacoplada por outbox, com encerramento explicito, link
  autenticado da auditoria e break-glass administrativo auditado.
- Administracao de usuarios, grupos, integracoes, sessoes e logs.
- Favoritos, recentes e preferencias por usuario para reduzir atrito de uso recorrente.
- Dashboard pessoal e dashboard administrativo de adocao com metricas operacionais.
- Feedback do usuario com inbox administrativo, status e resposta curta.
- Multi-tenant inicial com `platform admin`, gestao de empresas e licenciamento por tenant.
- Entitlements por modulo e limites comerciais para hosts, snippets, acessos locais, integracoes, agentes, secrets e feedback.
- Vault de secrets com criptografia, ACL, auditoria sem valor sensivel e uso seguro em snippets.
- Snippets com referencias `{{secret:alias}}`, validacao visual e mascaramento defensivo de stdout.
- Playbooks de diagnostico com execucao controlada via SSH, detalhe por comando e resumo por IA.
- MCP inicial para expor contexto e tools governadas a assistentes de IA.

## Diferenciais do projeto
- Governanca aplicada antes da conexao SSH, nao apenas registro posterior.
- Credenciais do host protegidas no servidor, sem necessidade de entregar senha ou PEM ao usuario final.
- Auditoria de sessao SSH com reconstrucao de comandos e contexto operacional.
- Tratamento seguro de mudanca de host key, com aceite explicito, historico e bloqueio seguro.
- SSH Gateway com autenticacao no NodeAccess, MFA, rate limit, logs e resolucao de host cadastrado.
- Comandos diretos pelo gateway, incluindo formatos como:
  - `ssh -p 2222 'usuario_nodeaccess@host'@gateway`
  - `ssh -p 2222 'usuario_nodeaccess@usuario_host@host'@gateway`
- Compartilhamento de acesso em dois formatos:
  - link autenticado para abrir sessao propria no host
  - link JIT temporario para acesso pontual de convidado, quando permitido pela politica
  - sessao ao vivo para acompanhamento colaborativo
- Sessao ao vivo com pedido de controle, concessao temporaria, retomada pelo owner e trilha auditavel.
- Dashboard e logs administrativos com visao operacional e filtros uteis.
- Direcao de HA administravel com readiness, visibilidade da topologia e
  failover completo protegido contra split-brain, sem aumentar a complexidade
  da instalacao single-node.
- Operações HA explicáveis, com heartbeat relativo, transferência de VIP,
  etapas, erros e journal visíveis para reduzir decisões no escuro.
- Experiencia proxima de uma ferramenta operacional real, com governanca centralizada.
- Acoes em massa de hosts com preview, aplicacao controlada, relatorio, historico e rollback.
- Diagnosticos operacionais padronizados, com execucao de baixo risco, mascaramento de dados sensiveis e analise assistida por IA.
- Base de integracao para automacao governada via MCP e `ActionRun`, preservando auditoria e politicas.

## Beneficios para a empresa
- Reduz risco de credenciais espalhadas em notebooks, scripts e configuracoes locais.
- Facilita offboarding, revisao de acesso e aplicacao de politicas.
- Aumenta rastreabilidade sobre acessos sensiveis, troubleshooting e suporte.
- Reduz tempo ate a primeira conexao de novos usuarios.
- Permite colaboracao entre suporte e infraestrutura sem compartilhar senha.
- Permite acesso temporario e rastreavel para cenarios pontuais sem criar conta permanente.
- Organiza hosts, bastions, credenciais e acessos em uma camada unica.
- Cria base para compliance, governanca, auditoria e automacao controlada.
- Ajuda administradores a acompanhar adocao, uso de recursos e limites de licenca por tenant.
- Padroniza diagnosticos recorrentes sem liberar comandos arbitrarios como primeiro caminho.

## Beneficios para o usuario tecnico
- Acessa hosts pelo navegador ou pelo cliente SSH que ja usa.
- Encontra hosts por busca, favoritos, recentes e comandos como `sshs`, `hosts` e `connect`.
- Localiza rapidamente sessoes abertas pela busca de abas do terminal.
- Evita configurar manualmente credenciais, bastions e atalhos em cada maquina.
- Usa SFTP, acessos locais e sessoes multiplas no mesmo ambiente operacional.
- Colabora em sessoes ao vivo com controle temporario e rastreavel.
- Executa playbooks de diagnostico guiados e recebe resumo de achados, risco e proximos passos.
- Envia feedback de produto dentro do fluxo, sem sair do contexto operacional.
- Mantem produtividade sem depender de arquivos locais e combinados informais sempre que o ambiente permitir.

## Mensagem para analise comercial
O NodeAccess deve ser apresentado como uma camada de seguranca, governanca e produtividade para acesso SSH corporativo. O valor nao esta apenas em abrir terminal no browser, mas em padronizar uma rotina critica que normalmente fica distribuida em maquinas individuais, sem obrigar o time tecnico a abandonar seus fluxos de trabalho.

## Prova de valor sugerida
- Mostrar criacao ou selecao de um host.
- Conectar pelo terminal web com MFA e permissao aplicada.
- Demonstrar busca, favoritos/recentes e SFTP.
- Alternar rapidamente entre hosts no terminal.
- Localizar uma sessao aberta pela busca de abas.
- Criar ou acionar um acesso local a partir do host.
- Gerar um link JIT com expiracao curta e, se configurado, PIN.
- Abrir sessao compartilhada com pedido de controle.
- Executar um playbook de diagnostico e abrir o resumo por IA.
- Mostrar logs/auditoria do acesso.
- Mostrar dashboard pessoal, dashboard admin e limites de licenca/entitlements.
- Demonstrar comando via SSH Gateway usando cliente nativo:
  - `ssh -p 2222 'usuario_nodeaccess@host'@gateway`

## Resumo executivo
O NodeAccess e uma plataforma de acesso operacional seguro para SSH. Ele combina produtividade para o usuario tecnico com controle para a empresa: acesso centralizado, credenciais protegidas, MFA, auditoria, colaboracao e base para governanca. O ganho comercial e reduzir risco e atrito em uma rotina critica sem travar a operacao.
