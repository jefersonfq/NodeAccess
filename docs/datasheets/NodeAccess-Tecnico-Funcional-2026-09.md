# NodeAccess

**Datasheet técnico e funcional**

Capacidades, fluxos, controles e integrações para avaliação técnica.

**Setembro 2026 · edição 2.**

Revisão de documentação e código em 24/09/2026. Inclui alterações locais ainda não necessariamente publicadas. Recursos efetivos dependem da versão instalada, configuração, dependências e autorização. Não constitui homologação de produção nem SLA.

## Acesso remoto e experiência do operador

| Recurso | Escopo conferido | Condição ou limite |
|---|---|---|
| SSH web | Terminal xterm.js sobre WebSocket e SSH | Rota de rede e credencial válidas |
| Telnet web | Transporte textual próprio | Não oferece criptografia SSH no trecho remoto |
| RDP e VNC | Sessão gráfica no navegador | Gateway guacd e conectividade configurados |
| Serial | Tipo presente no cadastro/modelo | Sem transporte operacional no terminal atual |
| SSH nativo | Gateway para clientes SSH externos | Serviço opcional, habilitação e política próprias |
| SFTP | Listar, transferir, criar, renomear, remover e editar arquivos | SSH/SFTP e permissões do destino; não é função de todos os protocolos |

### Terminal e navegação

Múltiplas abas, busca de sessões, alternância de hosts, fullscreen, janela dedicada e reordenação de abas compõem a experiência do operador. Limpar o terminal não encerra a conexão. Após o encerramento, a interface apresenta contexto e permite reconexão manual; o usuário controla a tentativa.

O terminal sincroniza dimensões com o PTY remoto. Autocomplete é opcional e controlado por tenant/usuário. Destaques de terminal permitem regras pessoais e atribuições administrativas, com prévia e gestão própria; o realce visual não altera a saída original nem a auditoria.

### Colaboração e acesso temporário

- Compartilhamento ao vivo com participantes identificados, visualização, pedido de controle, concessão temporária e retomada pelo proprietário.
- Reabrir o compartilhamento ativo oferece a gestão e o link existente; encerrar esse compartilhamento preserva a conexão SSH do proprietário.
- Links autenticados para acesso e links JIT temporários, conforme política, com expiração, revogação, uso único e PIN opcional.
- Supervisão de sessões com permissão específica e rastreabilidade.

Expiração de autenticação web não implica preservação transparente do SSH: a política segura atual encerra as sessões do navegador ao retornar ao login. Mudança de nó/gateway também não constitui promessa de migração de conexões ativas.


## Inventário, organização e produtividade

| Área | Capacidades |
|---|---|
| Cadastro | Hosts, protocolos, credenciais, bastions, tags, links e parâmetros de conectividade |
| Localização | Busca, filtros, paginação, favoritos, recentes e contexto operacional por host |
| Pastas pessoais | Organização individual da visualização; não concedem acesso |
| Pastas corporativas | Árvore de inventário com ACL herdada e administração por pasta |
| ACL | Ações distintas de visualizar, conectar, editar e administrar; diagnóstico da origem da permissão |
| Operações em lote | Prévia, importação, movimentação, resultado e reversão quando suportada |
| Histórico | Exclusão lógica de hosts para preservar referências e auditoria |

### Migração assistida

O importador reconhece CSV, OpenSSH config, Apache Guacamole e sessões SSH do MobaXterm. Oferece prévia, correções, tratamento explícito de duplicados, identificação de jumpservers, escolha de conectividade para IPs privados e relatório do resultado. A importação aplica a autorização do inventário; conhecer o endereço de um host não concede acesso.

Arquivos proprietários cifrados não são descriptografados como um cofre universal. Material sensível e formatos exigem as regras do importador. Reversões podem ser parciais conforme referências e estado posteriores; o resultado deve ser conferido.

### Ferramentas da rotina

Favoritos e recentes usam apresentação consistente de nome, endereço, protocolo, último acesso e pasta disponível. O dashboard pessoal reúne atalhos e atividade; o dashboard do host concentra contexto, links e diagnósticos.

Snippets reutilizam comandos e podem referenciar secrets sem gravar seus valores no texto do comando. Túneis e acessos locais permitem encaminhamento de portas; web access abre serviços HTTP/HTTPS através do caminho configurado. Políticas e disponibilidade desses recursos dependem do módulo e das permissões.

**Regra de governança:** editar um host não equivale a poder conectar. A autorização efetiva combina o contexto do tenant, usuário, grupos, escopos e concessões aplicáveis. A árvore corporativa e as pastas pessoais têm funções diferentes.


## Identidade, autorização e credenciais

### Controle de identidade

- Login local com tokens de acesso/renovação e MFA/TOTP obrigatório na política atual.
- Google SSO, LDAP/Active Directory e OIDC como caminhos configuráveis de identidade.
- Política de autenticação por tenant, incluindo restrição de login local/SSO, bloqueio e duração de tokens dentro dos limites da instalação.
- Provisionamento e associação de identidades dependem de configuração e política; não são permissões implícitas para novos usuários.
- Separação entre usuário, administrador do tenant e administrador de plataforma.

### Credenciais e segredos

O backend utiliza AES-256-GCM para material sensível protegido pelo serviço de criptografia. Chaves PEM e credenciais armazenadas são resolvidas no servidor para uso autorizado. O Vault permite referências reutilizáveis; a integração 1Password resolve referências `op://...` conforme configuração.

A arquitetura reduz a necessidade de distribuir senhas e chaves privadas aos operadores. Isso não significa cifragem integral de banco, disco, gravações ou backups: esses controles também dependem da implantação e das políticas de armazenamento. A proteção das chaves de criptografia e a recuperação de backups são responsabilidades operacionais essenciais.

### Autorização e controles operacionais

| Controle | Aplicação |
|---|---|
| Tenant e ACL | Limitação de recursos e operações ao contexto autorizado |
| Host key SSH | Detecção de mudança, confiança explícita e registro |
| Políticas de comando | Avaliação e bloqueio conforme mecanismo/fluxo configurado |
| Tokens e links | Escopo, expiração e revogação conforme o recurso |
| Administração | Configurações de plataforma separadas da administração do tenant |
| Auditoria | Registro de ações administrativas e operacionais |

Políticas de comandos e reconstrução de terminal não substituem a autorização no sistema remoto. Shells, editores e aplicações interativas exigem avaliação própria. Permissões do sistema operacional e do equipamento continuam válidas.


## Integrações e interoperabilidade

| Integração | Finalidade e estado | Dependências e limites |
|---|---|---|
| Google SSO | Login com conta Google | Aplicação/configuração Google e política do tenant |
| Google Workspace | Ciclo de vida básico e desativação/provisionamento conforme fluxo | Credenciais e permissões de diretório; não é sincronização irrestrita de atributos |
| LDAP / Active Directory | Autenticação e provisionamento no login implementados | Diretório, filtros e TLS; sincronização completa não implícita |
| OIDC | Login federado, identidades externas e mapeamento de grupos | Issuer, client, claims e políticas compatíveis |
| SCIM v2 | Usuários e grupos via API | Subconjunto implementado; sem bulk, troca de senha, sort ou ETag |
| 1Password | Referências de credenciais e secrets | Configuração e acesso ao provedor |
| Jira | Ticket no atendimento SSH e publicação de evidências | OAuth/API token, escopos e política de envio |
| Webhooks de saída | Eventos, assinatura, tentativas e entregas | Endpoint externo disponível e segredo configurado |
| Webhooks de entrada | Recepção, autenticação e idempotência | Contrato de eventos e configuração do endpoint |
| E-mail | Fluxos de comunicação e segurança | Serviço de e-mail configurado |
| Ollama / OpenAI-compatible | Assistência por IA | Módulo habilitado, modelo e endpoint adequados |
| MCP | Contexto e ferramentas para clientes de IA | Habilitação e token com escopo |
| AWS Secrets Manager | Indicado como “em breve” | Não entregue como integração operacional |

### Jira no fluxo operacional

O tenant pode exigir ticket antes da conexão, globalmente ou por escopo de usuários, grupos e pastas. O atendimento relaciona ticket, host e sessões. Comentários, anexos, transições e relatórios dependem das permissões do provedor e da configuração; a outbox permite repetição controlada sem bloquear toda a operação durante falhas temporárias.

### Compatibilidade de identidade

Há implementação e testes de perfis OIDC, incluindo cenários Entra e Okta. Testes locais e validação de metadados não certificam login interativo, MFA, Conditional Access ou todas as políticas do tenant do cliente. A adoção exige homologar o IdP real, claims, grupos, desativação e recuperação de acesso.


## Auditoria, evidências e supervisão

### O que pode ser acompanhado

Sessões, usuários, hosts, horários, encerramentos e eventos formam o contexto operacional. Logs administrativos registram mudanças de recursos e políticas. Relatórios organizam sessões, adoção, uso e informações como host keys, respeitando permissões.

A auditoria textual oferece captura, prévia, artefatos e comandos reconstruídos quando possível. O replay utiliza os dados disponíveis da sessão. Captura, retenção, processamento e enriquecimento dependem de habilitação e da configuração operacional.

| Evidência | Utilidade | Limite de interpretação |
|---|---|---|
| Metadados e eventos | Saber quem acessou, quando e em qual contexto | Dependem do fluxo e dos registros disponíveis |
| Comandos reconstruídos | Pesquisa e análise de atividade textual | Inferência sujeita a edição, autocomplete e programas interativos |
| Artefatos e replay textual | Revisão da sequência capturada | Não equivale a vídeo forense universal |
| Relatório de diagnóstico/ActionRun | Resultado, evidências e avaliação da execução | Escopo da execução e do host consultado |
| Checksum SHA-256 | Verificação de integridade do relatório exportado | Não é assinatura digital nem prova de imutabilidade |
| Resumo por IA | Apoio à investigação e interpretação | Deve ser conferido nas evidências originais |

### Colaboração rastreável

Participantes e eventos de controle de uma sessão compartilhada permitem entender o contexto da colaboração. Supervisão exige a autorização correspondente. O proprietário pode encerrar o compartilhamento e retomar o controle conforme o fluxo.

### Retenção e privacidade

Auditorias podem conter dados sensíveis produzidos pelo próprio destino remoto. Políticas de acesso, retenção, descarte, armazenamento e backup devem ser definidas na implantação. Recursos de sanitização reduzem exposição nos fluxos contemplados, sem garantir remoção universal de toda informação sensível.

Não se declara nesta edição armazenamento WORM, assinatura qualificada, certificação LGPD/ISO/SOC ou gravação gráfica completa obrigatória de RDP/VNC.


## Conectividade privada, agentes e equipamentos de rede

### Caminhos de conexão

| Caminho | Uso típico | Pré-requisito |
|---|---|---|
| Direto | Gateway alcança o host | Rota, firewall e porta do serviço |
| Bastion SSH | Salto autorizado para rede privada | Bastion e credencial, definidos por host/grupo |
| Agente pessoal | Acesso pela rede disponível ao usuário | Agente registrado e conectado |
| Agente compartilhado | Ponte de conectividade do tenant | Agente e permissões do tenant |
| Conector privado | Acesso restrito a destinos de uma rede | Escopos, CIDRs, portas e políticas configurados |

Agentes usam conexão de saída por WebSocket e oferecem status, heartbeat e diagnóstico. Operações de drenagem, rotação de credencial, revogação e seleção por prioridade auxiliam a manutenção. A reconexão do agente não garante recuperação transparente de toda sessão transportada.

O acesso SSH web convencional dispensa cliente local; cenários que usam agente, serviço local ou SSH nativo possuem componentes adicionais. A solução não deve ser descrita como substituta universal de VPN ou como acesso irrestrito à rede.

### Equipamentos de rede e TACACS+ — piloto opcional

Perfis distinguem servidor SSH, rede genérica e perfis de fabricantes em piloto. O perfil orienta capacidades, mas não concede acesso nem comprova compatibilidade com todos os modelos ou firmwares. Perfis de rede restringem SFTP e automações concebidas para shells de servidor.

O equipamento pode continuar consultando seu AAA existente enquanto o NodeAccess atua como cliente SSH. Há também um processo TACACS+ próprio, separado e opt-in, com identidade individual, autorização de comandos exatos e accounting.

**Limites do piloto:** subconjunto PAP/ASCII e shell; sem homologação multivendor, conformidade integral, CHAP/MSCHAP ou TACACS+ sobre TLS. A autorização depende de o equipamento consultar o AAA nos pontos necessários. Não há garantia de HA ou capacidade de produção do serviço TACACS+ nesta edição.


## Assistência por IA, diagnósticos e automação

### Capacidades disponíveis mediante configuração

- Assistente com contexto operacional e provedor local Ollama ou externo compatível com OpenAI.
- Copilot no terminal para explicar ou sugerir comandos/scripts; sugestão não equivale a execução automática.
- Playbooks de diagnóstico com execução controlada, resultados e evidências por comando.
- Planos em linguagem natural com prévia e avaliação de políticas antes da execução governada.
- ActionRuns para acompanhar execução, avaliação e relatório verificável.
- Comparação antes/depois no mesmo host e histórico de diagnósticos.
- Resumos de auditoria para apoiar investigação, com referência às evidências disponíveis.

### Integração MCP

O servidor MCP expõe contexto e ferramentas da plataforma a clientes autorizados. Tokens possuem escopo de capabilities, hosts permitidos, expiração, revogação e controles operacionais. Os serviços aplicam o contexto do tenant, autorização e políticas; ativar o MCP não deve abrir acesso geral ao inventário ou aos segredos.

### Escolha do provedor

| Opção | Implicação operacional |
|---|---|
| Modelo local | Mantém o processamento no endpoint local configurado; requer recursos computacionais, modelo e operação do serviço |
| Provedor externo | Exige endpoint, credencial, disponibilidade e política para envio dos dados necessários |
| Sem IA | O terminal e o acesso operacional principal não dependem de habilitar assistência por IA |

A configuração determina quais dados saem do ambiente. “IA local” não comprova que todos os demais serviços e integrações sejam offline. Tempo de resposta, qualidade e custo variam com modelo, infraestrutura e provedor.

**Controle humano:** propostas, resumos e classificação de risco podem falhar. Conferir evidências, permissões e impacto antes de executar mudanças. Resultados de comparação não demonstram causalidade por si só.

