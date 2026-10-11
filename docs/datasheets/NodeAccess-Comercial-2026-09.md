# NodeAccess

**Datasheet comercial**

Acesso centralizado para equipes técnicas, com governança e rastreabilidade.

**Setembro 2026 · edição 2.**

Revisão de documentação e código em 24/09/2026. Inclui alterações locais ainda não necessariamente publicadas. Recursos efetivos dependem da versão instalada, configuração, dependências e autorização. Não constitui homologação de produção nem SLA.

## Visão executiva e proposta de valor

O NodeAccess oferece um ponto central para localizar ativos, autorizar acessos, utilizar credenciais e acompanhar atividades. O terminal SSH funciona no navegador, sem instalar cliente SSH no dispositivo do operador. Agentes e gateway nativo atendem cenários que exigem conectividade privada ou ferramentas locais.

### Valor por público

| Público | Capacidade | Benefício esperado |
|---|---|---|
| Operador e suporte | Busca, favoritos, recentes, abas, SFTP e snippets | Menos etapas para acessar e trabalhar nos hosts |
| Infraestrutura e SRE | Bastions, agentes, diagnósticos e contexto por host | Operação centralizada em ambientes distribuídos |
| Segurança | MFA, ACL, credenciais cifradas, revogação e auditoria | Maior controle e rastreabilidade do acesso |
| Gestores | Relatórios, adoção e indicadores de uso por tenant | Visibilidade sobre uso e administração |
| Prestadores e equipes de clientes | Separação por tenant e concessões por usuário/grupo | Organização de acessos em contextos distintos |

### Casos de uso

- Administração SSH de servidores pelo navegador, com autorização antes da conexão.
- Suporte colaborativo em sessão ao vivo, com visualização e controle concedido pelo proprietário.
- Acesso a redes privadas por bastion ou agente com escopo autorizado.
- Migração de inventário e padronização de atalhos, credenciais e pastas.
- Atendimento vinculado a ticket Jira, com evidências da sessão quando configurado.
- Investigação operacional a partir de auditorias, diagnósticos e relatórios.

### Como interpretar a disponibilidade

**Implementado** significa que existe caminho funcional no código revisado; não garante que esteja habilitado em toda instalação. **Opcional** exige habilitação, configuração, política e/ou serviço dependente. **Piloto** exige avaliação controlada e não implica homologação geral. **Planejado/modelado** não deve ser tratado como funcionalidade entregue.

Os benefícios acima são objetivos de uso. Esta edição não apresenta ROI medido, certificações de conformidade, garantia de disponibilidade ou comparação de superioridade com outros produtos.


## Solução e jornada de adoção

O NodeAccess reúne o trabalho diário no navegador e a administração dos acessos. A proposta pode ser organizada conforme o cenário e os módulos contratados.

| Frente | O que demonstrar | Condição de adoção |
|---|---|---|
| Produtividade | Terminal SSH, abas, SFTP, snippets, favoritos e recentes | Destinos e permissões configurados |
| Governança | MFA, ACL corporativa, credenciais e logs | Política de identidade e inventário |
| Colaboração | Sessão ao vivo e acesso temporário JIT | Expiração, controle e revogação definidos |
| Redes privadas | Bastion, agente pessoal/compartilhado ou conector | Rota de rede e escopo autorizado |
| Atendimento | Jira relacionado a host, ticket e sessão | Integração, permissões e política do tenant |
| Diagnóstico | Playbooks, evidências e assistência por IA | Módulos, modelo e revisão humana |
| Continuidade | Operação, backup e HA opcional | Projeto de implantação e ensaio de recuperação |

### Implantação e contratação

Implantação gerenciada pela organização com Docker Compose ou Kubernetes/Helm, conforme projeto. O fluxo SSH web dispensa cliente local; agentes e gateway SSH nativo são opções para necessidades específicas. HA active/passive exige configuração adicional.

O onboarding deve incluir inventário piloto, grupos e ACL, identidade, conexões autorizadas e testes de negação. A expansão depende de medir uso e de homologar integrações e recuperação no ambiente real.

### O que não prometer sem evidência

Não há preço, prazo de implantação, SLA, ROI ou capacidade simultânea garantidos nesta ficha. Os controles de segurança apoiam governança, mas não constituem certificação de conformidade. Serial e AWS Secrets Manager não são entregues como conexão/integração operacional; TACACS+ permanece piloto.


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

