# NodeAccess

**Datasheet de infraestrutura e operação**

Arquitetura, dependências, dimensionamento e continuidade para planejar a implantação.

**Setembro 2026 · edição 2.**

Revisão de documentação e código em 24/09/2026. Inclui alterações locais ainda não necessariamente publicadas. Recursos efetivos dependem da versão instalada, configuração, dependências e autorização. Não constitui homologação de produção nem SLA.

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


## Arquitetura e opções de implantação

### Componentes

| Camada | Implementação de referência | Papel |
|---|---|---|
| Interface | Vue 3, TypeScript, Naive UI, xterm.js | Navegação, terminal e administração |
| API | Node.js, Fastify | Regras, identidade, inventário, integrações e relatórios |
| Gateway | WebSocket e biblioteca SSH | Transporte de sessões e conectividade |
| Persistência | MySQL 8.0 e Prisma | Dados e histórico estruturado |
| Estado auxiliar | Redis | Estado compartilhado e coordenação conforme módulo |
| Borda | Nginx / ingress configurado | Publicação HTTP(S) e WebSocket |
| Gráfico opcional | guacd | Transporte RDP/VNC |
| IA opcional | Ollama ou endpoint externo | Inferência de modelos |

Fluxo principal: **navegador → HTTPS/WSS → API/gateway → SSH → host**. Conforme o destino, o caminho inclui bastion ou agente. Sessões gráficas utilizam o gateway gráfico e guacd. Banco, Redis e dependências internas devem ficar no perímetro definido pela implantação.

### Formas de entrega

- Docker Compose, imagens de registro e scripts de instalação/atualização.
- Pacote de release, inclusive fluxo com imagens offline quando gerado dessa forma.
- Código-fonte para desenvolvimento e builds controlados.
- Chart Helm para Kubernetes, com API/gateway separados, migrations e drain de gateway.
- HA active/passive opcional, com preparação específica dos nós e do estado.

As imagens do backend revisadas usam Node.js 20 Alpine; o Docker CLI foi incluído no Dockerfile para novas imagens. Não se assume que uma imagem antiga ou já publicada contenha as alterações locais.

O chart Helm configura duas réplicas de API e gateway como padrão do arquivo revisado. Isso não torna MySQL/Redis automaticamente altamente disponíveis. Frontend, guacd e Ollama têm habilitação e recursos próprios; ingress, segredos e persistência devem ser definidos pelo operador.


## Requisitos, rede e dimensionamento

### Pré-requisitos da implantação

| Item | Requisito prático |
|---|---|
| Servidor | Ambiente Linux compatível com o runtime e o método de implantação escolhido |
| Containers | Docker Engine/CLI e Compose para o fluxo Compose; cluster e Helm no fluxo Kubernetes |
| Dados | MySQL, Redis, migrations e persistência configurados |
| Publicação | DNS, URL pública, certificado TLS e suporte a conexões WebSocket duradouras |
| Segurança | Segredos da instalação, chaves de criptografia, ACL e política de acesso |
| Operação | Backup, retenção, monitoramento, atualização e plano de recuperação |
| Cliente | Navegador com JavaScript e WebSocket; homologar versões usadas pela organização |
| Destinos | Serviço remoto e credencial compatíveis, rota e permissão de rede |

### Portas de referência

| Fluxo | Porta padrão no projeto | Observação |
|---|---|---|
| Navegador → borda | HTTPS 443 | Publicação recomendada; HTTP depende do perfil TLS |
| Borda → API / gateway | TCP 3000 / 3001 | Serviços internos de aplicação |
| Gateway → SSH / Telnet | TCP 22 / 23 | Configuráveis por host |
| Guacd → RDP / VNC | TCP 3389 / 5900 | Configuráveis por destino |
| Aplicação → guacd | TCP 4822 | Componente gráfico opcional |
| Aplicação → MySQL / Redis | TCP 3306 / 6379 | Dados internos; não requerem publicação pública |
| Cliente SSH → gateway nativo | TCP 2222 | Quando o serviço opcional estiver habilitado |

Confirmar portas efetivas, políticas de saída e listeners no manifesto e no ambiente. Integrações externas exigem acesso aos endpoints configurados. Não há necessidade de publicar todos os serviços internos na Internet.

### Dimensionamento e desempenho

A documentação estabelece **meta inicial de até 300 usuários** e **objetivo de latência de terminal inferior a 50 ms no p95**. São objetivos de produto, não resultados de teste de carga desta revisão. Usuários cadastrados não equivalem a sessões simultâneas.

Dimensionar CPU, memória, armazenamento e rede com base em sessões concorrentes, volume de saída, RDP/VNC, captura/retenção de auditoria, importações e uso de IA. Requests/limits do Helm são parâmetros iniciais do chart, não sizing homologado. Esta edição não fixa mínimo universal de vCPU/RAM nem matriz completa de navegadores certificados.


## Operação, observabilidade e continuidade

### Instalação e manutenção

Os scripts oferecem preparo do host, instalação por pacote, validação do ambiente, migrations, smoke check, diagnóstico, atualização e rollback. TLS pode ser configurado conforme o perfil de implantação. Backup e restauração precisam ser testados com os dados, chaves e volumes efetivos.

O preparo do host já contempla instalação de Docker quando autorizada. O CLI incluído na nova imagem do backend evita depender do binário instalado no servidor; isso não configura automaticamente acesso da API ao daemon.

### Observabilidade

- Visão local de carga por núcleo, memória, discos, componentes e desempenho de API.
- Histórico disponível no processo e horários de coleta para interpretação dos dados.
- Diagnóstico Docker distinto para comando ausente, permissão, timeout, daemon inacessível ou resposta inválida.
- Falha de atualização preserva a última coleta com aviso de dados desatualizados; perda de autorização elimina o snapshot exibido.
- Backup monitorado por presença/idade de arquivos, sem comprovação automática de integridade ou restauração.

“Carga por núcleo” é derivada do load average, não utilização de CPU. Ausência de métricas Docker não comprova containers parados. O painel não é agregador completo de cluster; acesso ao daemon depende de política e configuração da implantação.

### Continuidade e HA

O perfil HA documentado contempla **dois nós de dados**, PRIMARY e STANDBY, com replicação de MySQL, Redis e arquivos, VIP, witness/fencing, verificação de prontidão, promoção e rejoin. A operação depende de preparação, conectividade e evidência de isolamento para evitar split-brain.

Há mecanismos de drain e controle de ciclo de vida de gateway. Isso não significa transferência transparente de uma sessão SSH entre processos ou preservação garantida de sessões em failover.

**RTO, RPO, disponibilidade e capacidade** devem ser medidos em ensaio do ambiente. Não há SLA numérico, zero perda ou recuperação instantânea declarados neste datasheet. Kubernetes com réplicas e HA active/passive são caminhos de implantação distintos e requerem projetos de estado compatíveis.
