# NodeAccess e aderencia a ISO/IEC 27001

Data: 2026-04-20

## Objetivo

Listar os pontos em que o NodeAccess apoia controles e praticas esperadas em um Sistema de Gestao de Seguranca da Informacao baseado na ISO/IEC 27001:2022.

Este documento nao declara certificacao nem conformidade plena. A ISO 27001 exige tambem politicas, processos, responsabilidades, evidencias, analise de risco, auditoria interna e melhoria continua. O NodeAccess e uma ferramenta que ajuda a implementar e evidenciar controles tecnicos e operacionais.

## Resumo executivo

O NodeAccess contribui especialmente para:

- controle de acesso administrativo e operacional;
- autenticacao forte;
- rastreabilidade de sessoes SSH;
- segregacao por tenant, usuario, grupo e escopo de host;
- gestao segura de credenciais;
- auditoria de comandos e eventos;
- suporte a investigacao e coleta de evidencias;
- reducao de uso de credenciais compartilhadas fora de controle;
- governanca de acessos remotos a servidores;
- monitoramento e logs operacionais.

## Mapeamento por tema

### 1. Controle de acesso

Controles relacionados:

- A.5.15 Access control
- A.5.16 Identity management
- A.5.18 Access rights
- A.8.2 Privileged access rights
- A.8.3 Information access restriction

Como o NodeAccess apoia:

- usuarios autenticados antes de acessar hosts;
- controle por tenant;
- papeis como usuario, admin do tenant e platform admin;
- visibilidade de hosts por escopo:
  - pessoal;
  - grupo/time;
  - global/admin;
- usuario comum so ve grupos dos quais participa;
- admins possuem visao administrativa conforme escopo;
- usuario sem permissao nao pode cadastrar ou editar hosts;
- limites de sessoes por usuario e por tenant;
- entitlements/licenca controlando acesso a modulos.

Evidencias possiveis:

- lista de usuarios ativos/inativos;
- usuarios por grupo;
- hosts por escopo;
- logs administrativos;
- configuracao de licenca/entitlements;
- historico de sessoes por usuario.

Lacunas/processo:

- exigir revisao periodica formal de acessos;
- fluxo de aprovacao de acesso privilegiado;
- matriz RACI e donos de ativos;
- recertificacao de usuarios e grupos.

### 2. Autenticacao forte

Controles relacionados:

- A.5.17 Authentication information
- A.8.5 Secure authentication

Como o NodeAccess apoia:

- login local com JWT;
- TOTP obrigatorio;
- Google SSO opcional;
- refresh token e expiracao de sessao;
- encerramento seguro de acesso quando a sessao web expira;
- redacao defensiva de tokens em logs;
- tokens temporarios para links/fluxos especificos.

Evidencias possiveis:

- politica de MFA/TOTP obrigatorio;
- logs de autenticacao;
- registros de login/logout;
- configuracao de Google SSO quando aplicavel;
- evidencia de expiracao e revogacao de sessao.

Lacunas/processo:

- politica corporativa de senha/MFA;
- revisao de parametros de expiracao;
- integracao completa com IdP corporativo, se exigido;
- alertas formais de tentativas suspeitas.

### 3. Gestao segura de credenciais e segredos

Controles relacionados:

- A.5.17 Authentication information
- A.8.24 Use of cryptography
- A.8.12 Data leakage prevention

Como o NodeAccess apoia:

- PEMs e segredos cifrados em repouso;
- suporte a 1Password por referencia `op://...`;
- segredo do 1Password resolvido apenas em memoria durante a sessao;
- snippets podem referenciar secrets sem armazenar valor sensivel no comando;
- redacao defensiva de segredos no output quando usados via Vault/snippets;
- UI indica uso de secret sem revelar valor;
- alertas para padroes inseguros em snippets, como senha inline.

Evidencias possiveis:

- configuracoes de hosts usando referencia de cofre;
- lista de secrets sem exposicao de valor;
- logs de resolucao/uso sem valor sensivel;
- demonstracao de que secrets nao retornam em API publica.

Lacunas/processo:

- politica formal de rotacao de segredos;
- aprovacao para criacao/uso de secrets;
- integracao com ciclo de vida completo do cofre corporativo;
- revisao periodica de aliases e referencias de secret.

### 4. Auditoria e rastreabilidade de acesso SSH

Controles relacionados:

- A.5.28 Collection of evidence
- A.5.33 Protection of records
- A.8.15 Logging
- A.8.16 Monitoring activities

Como o NodeAccess apoia:

- registro de sessoes SSH;
- auditoria de stdin/stdout/resize/erro/fim de sessao;
- reconstrucao simplificada de comandos executados;
- exportacao/listagem de comandos;
- chunks de auditoria comprimidos com gzip;
- politica de auditoria por tenant, usuario e grupo;
- cache Redis da politica com metricas de hit/miss/error;
- logs administrativos;
- eventos de compartilhamento de sessao;
- registro de rota da sessao, incluindo direto, agente ou bastion;
- registro de IP de origem observado para browser/API e IP WAN do Agent quando usado.

Evidencias possiveis:

- detalhe da sessao auditada;
- lista de comandos reconstruidos;
- download ou leitura dos chunks de auditoria;
- logs admin;
- IP de origem da sessao e IP WAN do Agent;
- metricas Prometheus;
- relatorios de carga/estabilidade.

Lacunas/processo:

- politica de retencao formal por tenant/ambiente;
- protecao WORM/imutabilidade de evidencias, se exigida;
- trilha formal de cadeia de custodia;
- SIEM centralizado;
- alertas de comportamento suspeito em tempo real.

### 5. Segregacao de acesso e isolamento

Controles relacionados:

- A.5.15 Access control
- A.8.3 Information access restriction
- A.8.20 Network security
- A.8.22 Segregation of networks

Como o NodeAccess apoia:

- modelo multi-tenant;
- separacao de hosts por tenant;
- grupos para visibilidade e acesso;
- hosts pessoais, de time e globais;
- bastion por host ou grupo;
- agentes por usuario ou tenant;
- conexao direta, via bastion ou via agente conforme configuracao;
- acesso web/forwarding com escopo controlado.

Evidencias possiveis:

- hosts associados a grupos/tenants;
- bastions vinculados a grupos ou hosts;
- configuracao efetiva de rota;
- logs de acesso a hosts;
- testes de conexao e diagnosticos.

Lacunas/processo:

- diagrama formal de rede;
- classificacao dos ativos acessados;
- politica de segmentacao de rede;
- revisao periodica de bastions e rotas.

### 6. Administracao, governanca e responsabilidades

Controles relacionados:

- A.5.2 Information security roles and responsibilities
- A.5.3 Segregation of duties
- A.5.4 Management responsibilities
- A.5.15 Access control

Como o NodeAccess apoia:

- separacao entre usuario comum, admin do tenant e platform admin;
- administracao de usuarios, grupos, hosts, bastions, integracoes e licencas;
- logs administrativos;
- limites e entitlements por tenant;
- configuracoes visiveis em tela administrativa;
- dashboard administrativo com visao operacional.

Evidencias possiveis:

- lista de admins;
- historico de alteracoes;
- configuracao de tenant/licenca;
- alteracoes em hosts, bastions e integracoes.

Lacunas/processo:

- segregacao formal de funcoes na organizacao;
- aprovacao e revisao de administradores;
- matriz de responsabilidades;
- procedimento de offboarding.

### 7. Gestao de identidades e ciclo de vida de usuario

Controles relacionados:

- A.5.16 Identity management
- A.5.18 Access rights

Como o NodeAccess apoia:

- usuarios ativos/inativos;
- usuarios desativados nao consomem licenca;
- Google SSO para login;
- Google Workspace para refletir desativacao/remocao de usuarios;
- provisionamento basico via Google quando habilitado;
- grupos de acesso;
- limite de usuarios licenciados.

Evidencias possiveis:

- usuarios ativos/inativos;
- origem do login;
- grupos associados;
- configuracao Google;
- logs de autenticacao e administracao.

Lacunas/processo:

- fluxo formal de joiner/mover/leaver;
- aprovacao de acesso baseada em cargo;
- sincronizacao completa de grupos corporativos, se exigida;
- recertificacao periodica.

### 8. Seguranca de rede e acesso remoto

Controles relacionados:

- A.8.20 Network security
- A.8.21 Security of network services
- A.8.22 Segregation of networks

Como o NodeAccess apoia:

- acesso SSH centralizado via navegador;
- reducao da necessidade de clientes locais e configuracoes dispersas;
- suporte a bastion;
- suporte a agentes para ambientes com VPN/rede restrita;
- port forwarding/acessos locais controlados;
- acesso web via proxy controlado;
- registro da rota efetiva usada na sessao.

Evidencias possiveis:

- hosts acessados por bastion/agente/direto;
- configuracoes de forwarding;
- logs de sessoes;
- diagnosticos de agentes.

Lacunas/processo:

- hardening do host onde roda o NodeAccess;
- TLS/WSS em producao;
- regras de firewall;
- segmentacao de rede;
- gestao de certificados.

### 9. Monitoramento, metricas e capacidade

Controles relacionados:

- A.8.15 Logging
- A.8.16 Monitoring activities
- A.5.30 ICT readiness for business continuity

Como o NodeAccess apoia:

- endpoint Prometheus `/metrics`;
- metricas de sessoes SSH ativas;
- metricas de sessoes iniciadas;
- metricas de auditoria;
- metricas de cache;
- testes de carga reproduziveis;
- documentacao de capacidade e hardware;
- baseline validado de 300 sessoes em onda curta.

Evidencias possiveis:

- relatorios em `tools/load-tests/reports/`;
- documento de capacidade;
- snapshots Prometheus;
- logs de gateway/API;
- historico de testes.

Lacunas/processo:

- monitoramento centralizado em producao;
- alertas e thresholds formais;
- testes periodicos de capacidade;
- plano de continuidade e recuperacao.

### 10. Configuracao segura e hardening

Controles relacionados:

- A.8.9 Configuration management
- A.8.32 Change management
- A.8.24 Use of cryptography

Como o NodeAccess apoia:

- deploy via Docker;
- variaveis sensiveis separadas em `.env`;
- documentacao de deploy;
- proposta de hardening MySQL;
- config MySQL Perfil A criada em `docker/mysql/conf.d/nodeaccess.cnf`;
- recomendacao de Redis, MySQL e gateway separados em fase futura;
- logs com redacao de tokens;
- chaves e secrets cifrados.

Evidencias possiveis:

- `docker-compose.yml`;
- `docker/mysql/conf.d/nodeaccess.cnf`;
- `docs/DEPLOY-lite.md`;
- `docs/MYSQL-CONFIG-RECOMMENDATION.md`;
- historico de mudancas versionadas.

Lacunas/processo:

- baseline formal de hardening por ambiente;
- revisao de configuracao antes de producao;
- controle formal de mudanca;
- rotina de patching.

### 11. Colaboracao controlada e compartilhamento de sessao

Controles relacionados:

- A.5.15 Access control
- A.5.18 Access rights
- A.8.2 Privileged access rights
- A.8.15 Logging

Como o NodeAccess apoia:

- compartilhamento de sessao ao vivo;
- token/link controlado para entrada;
- pedido/concessao de controle;
- retomada pelo owner;
- registro auditavel dos eventos;
- isolamento por tenant e sessao.

Evidencias possiveis:

- logs de criacao/entrada/controle/revogacao de sessao compartilhada;
- registros de comandos na sessao;
- usuario owner e participante;
- timestamps dos eventos.

Lacunas/processo:

- politica formal para compartilhamento de sessoes privilegiadas;
- expiracao e aprovacao conforme criticidade;
- revisao de uso por area.

### 12. Resposta a incidentes e investigacao

Controles relacionados:

- A.5.24 Information security incident management planning and preparation
- A.5.25 Assessment and decision on information security events
- A.5.26 Response to information security incidents
- A.5.28 Collection of evidence

Como o NodeAccess apoia:

- logs de autenticacao;
- logs administrativos;
- historico de sessoes SSH;
- comandos reconstruidos;
- auditoria bruta comprimida;
- contexto de host, usuario, tenant e rota;
- integracao com JIRA como contexto operacional;
- possibilidade de sumarizacao/analise de auditoria por IA quando licenciada.

Evidencias possiveis:

- trilha de uma sessao suspeita;
- comandos executados;
- output observado;
- host e usuario envolvidos;
- eventos de erro/conexao;
- logs de administracao.

Lacunas/processo:

- playbook formal de resposta a incidentes;
- classificacao de severidade;
- fluxo de escalonamento;
- integracao com SIEM/SOAR;
- preservacao imutavel de evidencia.

## Itens fortes para apresentacao ISO 27001

1. MFA/TOTP obrigatorio.
2. Controle de acesso por usuario, grupo, tenant e escopo de host.
3. Separacao de funcoes entre usuario, admin do tenant e platform admin.
4. Auditoria de sessoes SSH com comandos e output.
5. Logs administrativos e historico operacional.
6. Credenciais e PEMs cifrados em repouso.
7. Integracao com 1Password sem persistir segredo em claro.
8. Uso de secrets em snippets sem expor valor.
9. Redacao defensiva de tokens e segredos em logs/output.
10. Bastion por host/grupo para controlar rotas de acesso.
11. Agentes para acesso controlado em redes restritas.
12. Politica de auditoria configuravel por tenant, usuario e grupo.
13. Cache Redis com invalidacao clara e metricas.
14. Metricas Prometheus para operacao e capacidade.
15. Testes de carga documentados e baseline de capacidade.
16. Configuracao MySQL endurecida para Perfil A.
17. Deploy via Docker com configuracoes versionadas.
18. Licenciamento/entitlements para controlar modulos disponiveis.
19. Google SSO/Workspace para apoio ao ciclo de vida de usuarios.
20. Sessao compartilhada com controle e trilha auditavel.
21. Registro de IP de origem WAN em API, agente e sessoes SSH auditadas.

## Pontos que ainda precisam de processo ou evolucao

1. Politica formal de controle de acesso.
2. Revisao periodica de acessos.
3. Recertificacao de usuarios privilegiados.
4. Politica de retencao de auditoria.
5. Armazenamento imutavel/WORM para evidencias, se exigido.
6. SIEM centralizado.
7. Alertas de comportamento suspeito.
8. Fluxo formal de aprovacao de acesso privilegiado.
9. Playbook de resposta a incidentes.
10. Teste sustentado de carga em ambiente mais proximo de producao.
11. Hardening completo de host, Docker, Nginx, TLS e sistema operacional.
12. Politica de backup e restore testado.
13. Gestao formal de vulnerabilidades e patching.
14. Registro de riscos e tratamento conforme SGSI.

## Conclusao

O NodeAccess ajuda fortemente na implementacao tecnica de controles ligados a acesso remoto, autenticacao, rastreabilidade, segregacao, monitoramento e gestao segura de credenciais.

Ele nao substitui o SGSI, mas fornece evidencias e mecanismos praticos para sustentar varios controles da ISO/IEC 27001:2022, especialmente nos temas de controle de acesso, autenticacao, logging, monitoramento, protecao de registros, seguranca de rede e coleta de evidencias.
