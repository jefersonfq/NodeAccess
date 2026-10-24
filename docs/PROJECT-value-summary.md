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
- Migracao assistida de sessoes SSH do MobaXterm, preservando pastas pessoais
  e explicando conflitos que existem no tenant, mas estão fora da ACL do operador.
- Revisao em lote, deduplicacao controlada, diagnostico de conectividade, relatorio portavel e reversao auditada reduzem risco e tempo de onboarding do inventario
- Deteccao automatica de formato, traducao de PEM/segredo no lote corrente,
  reconhecimento/criacao assistida de jumpserver e suporte a `Include` reduzem
  decisoes manuais sem esconder o resultado final da migracao. A reversao
  imediata e auditada reduz o custo de corrigir uma importacao equivocada.
- Hosts de IP privado exigem uma politica explicita: agente do tenant
  (recomendado), selecao automatica ou conexao direta. O preview mostra o
  impacto dessa escolha antes do commit.
- Separacao clara entre Minhas pastas, que organizam a visualizacao individual,
  e Inventario corporativo, que governa permissao e heranca de acesso.
- Diagnostico por acao e consulta do proprio acesso reduzem duvidas do usuario;
  previa de concessoes restantes evita confundir revogar uma regra com bloquear acesso.
- Administracao centralizada de permissoes por pasta, sem depender de editar
  host por host para conceder acesso a um conjunto grande.
- Movimentacao governada de lotes de hosts entre pastas de ACL, com preview,
  historico e rollback.
- Suporte a senha, PEM e `PEM + senha`.
- Bastion/jump host por host ou grupo, com visibilidade de impacto e reaproveitamento de PEM cadastrada.
- Sessoes multiplas no terminal web, com PTY sincronizado para aplicações de tela cheia e temas próprios de operação, baixa luminosidade e alto contraste.
- Autocomplete do terminal para reduzir digitacao e erros em comandos e caminhos,
  com controle por tenant/usuario, falha segura e nenhuma execucao automatica.
- Fullscreen real do terminal, alternador rapido de hosts e busca por abas para localizar sessoes abertas por nome, IP ou porta. Reordenação sem reconexão, gestão do compartilhamento existente e motivos de encerramento reduzem interrupções e facilitam o diagnóstico operacional.
- SFTP e acesso a arquivos, com cópia entre sessões próprias e editor local Windows pelo agente pessoal; arquivos grandes usam comando direto revisado pelo operador.
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
- Separacao clara entre configuracao global, politica do tenant e contrato
  comercial, com quotas de usuarios/hosts, modulos e providers administrados
  centralmente sem permitir autoelevacao pelo cliente.
- Catalogo de licenca traduz chaves tecnicas em capacidades e casos praticos,
  tornando o impacto comercial e as dependencias compreensiveis antes de aplicar.
- Entitlements por modulo e limites comerciais para hosts, snippets, acessos locais, integracoes, agentes, secrets e feedback.
- Vault de secrets com criptografia, ACL, auditoria sem valor sensivel e uso seguro em snippets.
- Snippets com referencias `{{secret:alias}}`, validacao visual e mascaramento defensivo de stdout.
- Playbooks de diagnostico com execucao controlada via SSH, detalhe por comando e resumo por IA.
- MCP inicial para expor contexto e tools governadas a assistentes de IA.
- Assistente NodeAccess preparado para combinar IA local ou externa sem mudar
  as regras de seguranca, com evolucao para diagnosticos, evidencias, relatorios
  e operacoes governadas por tools tipadas.
- Diagnostico assistido com comandos, timeout e risco visiveis antes da criacao
  de um ActionRun, reduzindo a execucao de sugestoes opacas do modelo.
- Relatorio de diagnostico exportavel e verificavel por checksum, preservando
  evidencias sanitizadas para suporte, auditoria e futura anexacao ao ticket.
- Rastreabilidade explicita entre diagnostico, sessao, ticket e ActionRun, sem
  depender de correlacao manual ou associacoes inferidas pelo modelo.
- Evidencias e checksum do diagnostico publicaveis no Jira sem duplicacao e sem
  bloquear o operador durante indisponibilidade temporaria do provider.
- Comparacao antes/depois no mesmo host para evidenciar melhora, regressao ou
  resultado misto sem atribuir causalidade automaticamente.
- Historico de diagnosticos por host para identificar falhas e achados
  recorrentes sem depender de leitura manual de cada execucao.
- Copilot contextual no terminal que explica evidencias e sugere comandos ou
  scripts para revisao, sem transformar resposta do modelo em execucao direta.
- Validacao pos-execucao de ActionRuns com resultado verificavel e independente
  da interpretacao do modelo.

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

- manutencao previsivel de agentes com drenagem, failover e visao de impacto,
  reduzindo indisponibilidade e erro operacional em redes privadas
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

## Evolução de operação — feedback Lucien (2026-09-10)

Preservação de contexto em Hosts, edição de tags e identificação de consumidores de secrets reduzem trabalho repetido e ambiguidade. Falhas SFTP deixam de provocar recuperação global da interface. Túneis podem chegar ao localhost do agente pessoal e sessões SSH web podem ser supervisionadas com permissão específica e rastreabilidade. Esses recursos exigem validação no ambiente do cliente; não constituem certificação de segurança ou superioridade comprovada sobre concorrentes.

Guia: `docs/OPERATIONS-lucien-feedback-2026-09-10.md`.

## Expansão para operação de rede — piloto

Perfis adaptam o acesso ao equipamento sem reconfigurar hosts antigos. A integração preserva servidores AAA existentes, e o listener TACACS+ próprio pode ser iniciado separadamente para um piloto com identidade individual, ACL e comandos explicitamente permitidos. O módulo não acrescenta chamadas AAA ao transporte SSH comum. Ainda não representa homologação multivendor ou substituição certificada de um AAA de produção; limites em `docs/PRD-network-access-lite.md`.
# Leitura operacional assistida

- Destaques configuráveis reduzem o tempo para localizar erros e avisos durante uma sessão SSH.
- Templates por grupo padronizam a leitura sem impor regras globais por padrão.
- Prévia, diagnóstico de custo e histórico reduzem risco de configuração e ajudam a adoção.

A regressão de sessões cobre falhas parciais de SFTP, eventos atrasados/duplicados e isolamento entre tenants. Pedidos de controle são recusados quando o compartilhamento já terminou, preservando a previsibilidade para dono e participantes.

Avisos de atualização e limpeza explícita de filtros evitam confundir pastas ocultas ou consultas indisponíveis com inventário vazio. O tooltip de último acesso fornece o horário preciso sem ocupar mais espaço no Início.

A observabilidade distingue indisponibilidade de coleta de falha dos serviços, identifica dados desatualizados e esclarece o alcance das métricas, reduzindo interpretações equivocadas na operação. Cobertura e limites em `docs/OPERATIONS-observability-review-2026-09-24.md`.

## Datasheet e uso comercial — 24/09/2026

O [datasheet técnico-comercial](./DATASHEET-NodeAccess.md) consolida o escopo conferido no código. OIDC, SCIM e LDAP ampliam as opções de identidade, condicionadas à configuração e à compatibilidade do ambiente. SSH/Telnet e RDP/VNC têm caminhos distintos; serial não deve ser ofertado como conexão operacional. AWS Secrets Manager permanece futuro e TACACS+ é piloto.

Benefícios são objetivos de adoção, governança e produtividade, não resultados financeiros quantificados. Não apresentar 300 usuários como concorrência certificada, p95 de 50 ms como SLA, checksum como assinatura digital ou testes simulados como homologação de fornecedor. A matriz de fontes está em `docs/reviews/2026-09-24-datasheet-review.md`.

## Posicionamento ISO/IEC 27000 e governança

O NodeAccess oferece controles de acesso, gestão de credenciais e rastreabilidade que apoiam a implementação de controles de segurança em um SGSI baseado na ISO/IEC 27001. Não há declaração de certificação ou percentual de conformidade nesta revisão. O [parecer atualizado](./ISO27001-gap-analysis.md) registra as lacunas e diferencia capacidade técnica de efetividade comprovada; as evoluções do PRD permanecem propostas.

Ajustes de compartilhamento e atividade de abas preservam a leitura da última linha e esclarecem o contador de saída não vista, reduzindo confusão com quantidade de usuários/sessões. Validação e limites em `docs/OPERATIONS-shared-viewer-unread-2026-09-24.md`.

## Gestão de HTTPS — 25/09/2026

Gestão opcional por administrador da plataforma: certificado próprio com prévia/validação, Let’s Encrypt via webroot e observação de proxy externo. Serviço independente agenda renovação e aplica certificados com verificação e recuperação, reduzindo intervenção manual. Escopo inicial Docker em instalação única; HA e DNS-01 não incluídos. Implantação, limites e evidências em [OPERATIONS-tls-management.md](OPERATIONS-tls-management.md).

A gestão de certificados inclui alertas internos fora da tela, diagnóstico por etapa, recuperação de operações por identificador, persistência sincronizada com o disco e auditoria central com entrega após indisponibilidade. A renovação mantém independência da API e respeita falhas transitórias e limites da CA. Procedimentos e testes: [gestão TLS](OPERATIONS-tls-management.md).

## Degustação configurável (NA-0068)

A instalação pode habilitar onboarding público por `TRIAL_REGISTRATION_ENABLED`,
sem converter contas existentes ou criadas pela administração normal. Cada trial
recebe tenant próprio, perfil/template versionado, quotas e prazo; desativar novos
cadastros não desativa expiração e limpeza. Cadastro verificado, MFA, preferências
individuais e convites preservam a separação entre operação e marketing. O mesmo
artefato atende os dois modos. Laboratórios exigem provisionador externo com
isolamento de rede validado; a flag não implementa isolamento físico.

Procedimentos, pré-requisitos e recuperação: [operação da degustação](OPERATIONS-trial-environments.md).
Escopo e evidências: [NA-0068](changes/2026/10/NA-0068-trial-review/plan.md).

### Contato e apresentação da degustação (NA-0072)

O cadastro oferece telefone opcional para contato solicitado sobre a avaliação, sem autorização implícita para marketing. O dado é cifrado, não é exposto nos endpoints públicos e segue a retenção da degustação. A página reutiliza a identidade visual do produto e o site apresenta “Faça uma degustação”, com orientação sobre a confirmação do e-mail. Limites continuam parametrizados; tenants normais não são convertidos.
