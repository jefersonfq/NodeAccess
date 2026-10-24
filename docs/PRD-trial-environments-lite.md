# Degustação com cadastro e ambientes efêmeros

Data: 2026-10-08.
Estado: proposta para planejamento; não implementada nem habilitada em produção.
Origem: avaliação solicitada pelo responsável pelo produto, registrada a seu pedido.

## 1. Objetivo

Permitir que visitantes do site solicitem uma degustação do NodeAccess e recebam
um tenant com hosts prontos para testar. O ambiente tem duração configurável,
expira e é destruído automaticamente. Viabilizar relacionamento comercial e
feedback com finalidades, bases legais e retenção de dados definidas.

Resultado esperado: reduzir o esforço para experimentar SSH, SFTP, colaboração
e auditoria, gerando oportunidades comerciais qualificadas sem expor a produção.

## 2. Escopo solicitado e recomendações

Escopo solicitado: cadastro pelo site, coleta de dados para relacionamento e
feedback, tenant provisionado a partir de template, hosts previamente cadastrados
e exclusão após um prazo configurável. A solicitação deste PRD não autoriza, por
si, implementação, contratação de infraestrutura ou abertura pública do trial.

Parâmetros abaixo são recomendações iniciais, sujeitos à decisão de produto:

| Item | Proposta inicial |
| --- | --- |
| Prazo | 7 dias, configurável, contados a partir da disponibilidade do ambiente |
| Participantes | Até 2 usuários por trial para experimentar colaboração |
| Hosts | 2 hosts Linux exclusivos de cada trial |
| Conteúdo | Dados fictícios, arquivos de exemplo, pastas e snippets seguros |
| Recursos | Terminal SSH web, SFTP, compartilhamento e auditoria |
| Endereço | `demo.nodeaccess.com.br`, em instalação dedicada |
| Entrada inicial | Piloto supervisionado, com provisionamento automatizado |
| Evolução | Liberação automática após validação de segurança, custo e limpeza |

Fora do MVP: cobrança automática, migração automática do laboratório para
produção, máquinas reais do visitante, destinos arbitrários, integrações externas,
agentes, túneis/port forwarding, automações de IA, acesso SSH nativo público e
laboratórios RDP/VNC/Windows. Essas capacidades exigem avaliação posterior.

## 3. Base existente e lacunas

Inspeção do repositório realizada em 2026-10-07; não comprova paridade com a versão
instalada na VPS. Conferir versão e migrações antes de implementar.

- `apps/backend/src/modules/tenants/tenant.routes.ts`: criação e administração de
  tenants protegidas por `requirePlatformAdmin`; não expor essas rotas ao cadastro público.
- `apps/backend/src/modules/tenants/tenant.service.ts`: criação de tenant,
  administrador inicial e limite de usuários; retorno de senha temporária no
  fluxo administrativo. O onboarding público precisa de ativação segura própria.
- `apps/backend/src/modules/tenants/tenant.repository.ts`: bootstrap transacional
  de tenant, inventário, licença e administrador. O administrador inicial possui
  poderes de gestão de hosts; não reutilizar esse perfil sem restrições no trial.
- A exclusão atual bloqueia tenants com dados vinculados. Exclusão de hosts por
  soft delete também não equivale à eliminação completa de dados de uma degustação.
- A criação atual verifica e-mail já existente. Definir tratamento de usuários
  existentes e convites; não criar duplicatas nem remover identidades de outros contextos.
- Preservar TOTP obrigatório, isolamento de tenant, ACL, quotas e políticas de sessão
  descritos em `PRD-lite.md`.

Lacunas a implementar: cadastro verificado, preferências de contato, orquestração
do laboratório, template versionado, validade do trial, painel de operação,
revogação ativa, destruição completa e reconciliação de recursos órfãos.

## 4. Jornada e experiência

1. Visitante aciona **Experimente o NodeAccess** no site institucional.
2. Formulário apresenta dados necessários, prazo, limites e aviso de privacidade.
3. Visitante confirma o e-mail por link de uso único, com expiração e reenvio limitado.
4. No piloto, pedido aguarda aprovação. Na fase pública, passa por controles de
   abuso e disponibilidade de capacidade antes de provisionar.
5. Sistema cria tenant, permissões, laboratório e conteúdo do template. A tela
   informa preparação, indisponibilidade ou falha com opção segura de retomada.
6. Após verificar a prontidão, sistema ativa o trial e registra início/vencimento.
   Usuário define senha por fluxo seguro e configura MFA; não recebe senha em claro por e-mail.
7. Primeiro acesso apresenta roteiro curto: conectar por SSH, transferir um arquivo,
   convidar colega, compartilhar sessão e consultar evidências do próprio tenant.
8. Interface mantém prazo de expiração visível e opções de feedback e contato comercial.
9. Antes do vencimento, sistema envia aviso operacional conforme antecedência configurada.
10. Ao expirar, encerra acessos e informa conclusão do teste e caminho para contato.

Convites consomem a quota do trial e exigem verificação, termos e preferências do
próprio convidado. O solicitante não autoriza marketing em nome de outra pessoa.
Ninguém deve inserir dados, chaves ou credenciais reais no laboratório; informar
isso no onboarding e explicar quais evidências das sessões serão registradas.

Estados de interface: cadastro, e-mail pendente, aprovação pendente, fila,
provisionando, pronto, falha, ativo, expirado e encerrado. Formulários com labels,
erros acessíveis, prevenção de envio duplicado e navegação por teclado/mobile.

## 5. Arquitetura e isolamento

Fluxo proposto: site → serviço de cadastro → confirmação/aprovação → fila de
provisionamento → instalação demo do NodeAccess + laboratório exclusivo → acesso.

- Hospedar a demonstração fora da VPS de produção atual, com credenciais e redes
  próprias. Nome DNS diferente ou tenant lógico, isoladamente, não separa infraestrutura.
- Cada trial recebe máquinas de teste e credenciais exclusivas; não compartilhar
  um mesmo sistema operacional/conta entre visitantes de tenants diferentes.
- Preferir VMs ou microVMs para execução de comandos por visitantes não confiáveis.
  Containers convencionais no mesmo kernel da produção não são a fronteira proposta.
- Separar também a camada de controle dos hosts em que visitantes executam comandos.
  O laboratório não pode acessar banco, Redis, Docker, orquestrador ou credenciais de controle.
- Permitir conexões somente aos hosts daquele trial. Negar acesso lateral entre
  trials, produção, interfaces administrativas e endpoints de metadados do provedor.
- Restringir saída de rede ao necessário para os exercícios; sem SMTP, varredura
  ou acesso irrestrito à internet. Enforcement no gateway e na rede, não apenas na UI.
- Sem volumes do host, socket Docker, credenciais de produção ou privilégios de
  administração do hipervisor nos ambientes de teste.
- Perfil de demonstração limitado: usuário nunca administra a plataforma nem
  aumenta quotas, habilita recursos fora do escopo ou escolhe destinos arbitrários.
- Provisionador acessa capacidades administrativas por canal interno com escopo
  mínimo; nenhuma chave de infraestrutura ou token administrativo chega ao navegador.

Template versionado contém imagem aprovada, inventário, pastas, permissões,
arquivos fictícios, exercícios e recursos habilitados. Gerar segredos e registrar
fingerprints de hosts novos em cada execução; não clonar segredos do template.

## 6. Ciclo de vida e falhas

Modelo conceitual, sem fixar ainda nomes de tabelas ou arquitetura da fila:

`e-mail pendente → aprovação/fila → provisionando → ativo → expirado → removendo → removido`

Falhas de provisionamento ou limpeza possuem estado próprio, motivo operacional
sanitizado e possibilidade de repetição controlada. Cancelamento percorre a mesma
revogação/limpeza; não ignora recursos parcialmente criados.

Requisitos:

- Registrar identificador do trial, tenant associado, versão do template,
  estado, início, vencimento e recursos provisionados.
- Operações idempotentes: reenvio de cadastro, callback, aprovação ou repetição de
  job não cria tenants/hosts duplicados nem reinicia o prazo indevidamente.
- Validar propriedade dos recursos por identificadores e metadados gerados pelo
  sistema. Exclusão nunca se baseia apenas em nome ou entrada enviada pelo visitante.
- Liberar acesso apenas depois da prontidão de tenant e hosts; falha parcial deve
  compensar os recursos criados e liberar capacidade de forma reconciliável.
- Aplicar vencimento no backend e gateways, inclusive em sessões em andamento;
  não depender só do cron, da interface ou da expiração natural do JWT.
- No vencimento: impedir novas operações, revogar tokens, convites e links,
  encerrar SSH/WebSocket/SFTP e bloquear o laboratório antes da limpeza assíncrona.
- Limpar máquinas, discos/volumes, segredos, inventário, arquivos e dados vinculados
  conforme política aprovada, sem atingir registros de outros tenants.
- Repetir falhas com limites e alertas; reconciliar recursos reais com o cadastro
  após quedas do worker/provedor e reinícios. Registrar conclusão verificável.
- Prorrogação exige permissão administrativa, limite e auditoria. Serializar com
  expiração/remoção; recurso já destruído não pode ser reativado por alterar uma data.
- Desligar novas inscrições não interrompe revogação, limpeza nem direitos de titulares.

## 7. Dados pessoais, contato e retenção

Requisitos de produto sujeitos à revisão jurídica; não constituem certificação
de conformidade. Definir base legal por finalidade, sem consentimento genérico
para “contatos e etc.” nem presumir que todos os tratamentos exigem a mesma base.

| Finalidade | Diretriz proposta |
| --- | --- |
| Cadastro e operação do trial | Nome/e-mail necessários; base legal e avisos próprios para fornecer o serviço solicitado |
| Qualificação | Empresa opcional; evitar CPF/CNPJ/cargo/endereço sem necessidade demonstrada |
| Contato comercial | Opt-in específico, desmarcado e revogável; telefone opcional e canal informado |
| Pesquisas de feedback | Preferência separada para convites; feedback voluntário não condiciona o trial |
| Segurança e auditoria | Coleta mínima, acesso restrito e finalidade informada; não usar comandos como perfil comercial |
| Métricas de produto | Eventos mínimos de adoção; sem gravação de teclas, conteúdo de arquivos ou segredos para analytics |

O cadastro deve apresentar termos da degustação e aviso de privacidade acessível.
Identificar controlador, finalidades, compartilhamentos/fornecedores, retenção,
canal de atendimento e meios para exercício de direitos. Aceite contratual e
ciência do aviso não substituem consentimentos específicos quando utilizados.

Registrar finalidade, versão do texto, data e origem dos consentimentos, inclusive
revogação. Não exigir autorização de marketing para conceder acesso ao teste.
Avaliar necessidade antes de reter IP ou outros identificadores como evidência.
Avaliar também fornecedores de e-mail, antiautomação e infraestrutura e eventuais
transferências internacionais. Não incluir rastreamento comercial por padrão.

A destruição do laboratório não equivale à eliminação de todos os dados pessoais:

- Laboratório: prazo operacional do trial e limpeza definida.
- Leads/contatos: prazo próprio justificado por finalidade/base legal, com revisão
  de inatividade e revogação; não manter indefinidamente só porque houve cadastro.
- Evidências de consentimento, segurança e obrigações aplicáveis: retenção mínima
  justificada, acesso restrito e separação do uso comercial.
- Auditoria, gravações, exports e backups: inventariar cópias, estabelecer prazos
  e impedir que restaurações reativem acessos ou recuperem dados já eliminados sem tratamento.
- Anonimização, quando escolhida, deve impedir reidentificação razoável; remover
  apenas o e-mail ou substituir por ID não basta.

Não prometer exclusão integral em sete dias se logs/backups/contatos persistirem.
Prazos concretos e processo de atendimento a solicitações são pendências pré-lançamento.

## 8. Administração, capacidade e observabilidade

Painel restrito à plataforma: pedidos, verificações, preferências de contato,
aprovação, estado, versão do template, prazo, consumo e falhas. Permitir prorrogar,
encerrar e repetir jobs autorizados com auditoria. Segregar acesso comercial de
administração da infraestrutura e de conteúdos das sessões.

- Limites por trial: usuários, CPU, memória, disco, processos e sessões simultâneas.
- Limites globais: trials ativos, jobs concorrentes e orçamento; fila quando não há capacidade.
- Confirmação de e-mail, proteção contra automação e limites de cadastros/reenvios;
  prever tratamento de falsos positivos e de visitantes atrás do mesmo NAT.
- Definir política de repetição de trial e abuso sem coleta excessiva de identificadores.
- Observar provisionamento, falhas, consumo, vencimentos e recursos órfãos.
- Medir conversão cadastro→verificação→primeira conexão, uso dos exercícios,
  feedback voluntário e custo por trial; metas numéricas após o piloto.
- Logs não incluem senha temporária, token de ativação, chave privada ou conteúdo
  pessoal desnecessário. Falhas públicas não expõem infraestrutura ou existência de contas.

## 9. Critérios de aceite

1. Visitante sem e-mail verificado não recebe acesso; links vencidos/reutilizados
   são rejeitados. Sem opt-in comercial, o trial continua disponível.
2. Repetir o mesmo pedido/job não duplica infraestrutura, cobranças ou tenant.
3. Dois trials simultâneos não acessam hosts, arquivos, evidências ou sessões um do outro.
4. Visitante não alcança produção, camada de controle, metadados do provedor ou
   destinos fora do laboratório, mesmo usando comandos, SFTP ou APIs diretamente.
5. Quotas e recursos proibidos são bloqueados no servidor, inclusive para o
   administrador restrito da demonstração. Visitante não aumenta seus limites.
6. SSH, transferência de arquivo, colaboração e auditoria funcionam no template,
   com dados fictícios e MFA preservado.
7. Prazo começa na prontidão; conta/sessão ativa é bloqueada no vencimento mesmo
   quando o worker de limpeza está indisponível.
8. Falha parcial/reinício do provisionador não deixa recursos acessíveis sem dono;
   repetição/reconciliação conclui ou alerta sem afetar produção.
9. Exclusão verifica todos os recursos do trial; prorrogação concorrente com
   expiração/remoção tem resultado determinístico e auditado.
10. Preferências podem ser revogadas; solicitações de titulares e retenção de
    contatos/logs/backups seguem a política aprovada e têm evidência de execução.
11. Formulário/onboarding funcionam em mobile e por teclado, com feedback de
    preparação, fila, falha e expiração. E-mails não revelam segredos.
12. Há evidência de isolamento, encerramento e limpeza antes da liberação pública.

Validação de implementação: testes de integração dos ciclos e falhas,
autorização cruzada entre tenants e laboratório descartável. Ao tocar área útil
do terminal, executar `npm run test:terminal-experience:web`; ao alterar resize,
WebSocket ou transporte SSH, também `npm run test:terminal-pty:real`. Testes
opt-in, sem sondagens no caminho normal. Revalidar manual se fluxos mapeados mudarem.

## 10. Fases e decisões pendentes

1. Definir política de trial, bases legais/retenção, infraestrutura e template.
2. Implementar provisionamento, quotas, revogação e destruição em laboratório.
3. Piloto supervisionado com poucos pedidos e cadastro/verificação reais.
4. Avaliar custo, isolamento, entrega de e-mails, experiência e falhas de limpeza.
5. Abrir cadastro automático com limites, observabilidade e opção de suspender novas entradas.

Pendências: confirmar prazo/limites propostos; orçamento/provedor e isolamento;
perfil de permissões; exercícios; serviço remetente de e-mails; campos do cadastro;
canal de privacidade e responsáveis; bases legais e retenção por categoria;
antecedência dos avisos; prazo máximo de limpeza e alertas; regras de repetição,
prorrogação e eventual conversão comercial. Não estimar capacidade da VPS atual
nem prometer disponibilidade sem medição.

Ao implementar, atualizar PRD-lite, contexto funcional, proposta de valor,
README, mapa e manual conforme regras do repositório. Até lá, manter esta frente
explicitamente como proposta, sem anunciar a degustação como funcionalidade entregue.

## Decisão de implementação — 2026-10-24

A autorização posterior substitui a exigência inicial de instalação exclusivamente demo:
produção e degustação podem coexistir no mesmo plano de controle. A flag
`TRIAL_REGISTRATION_ENABLED` abre somente o onboarding público. Contas/tenants
existentes e criação administrativa normal permanecem normais. O cadastro público
cria tenant classificado explicitamente como trial; sua política persiste quando
a flag é desligada. Laboratórios continuam exclusivos e isolados por rede, sem
acesso lateral a outros trials, produção ou controle. Instalação dedicada continua
uma opção operacional. Não converter nem eliminar tenants existentes por flag.

Entrega em andamento na NA-0068; ainda não habilitada em produção. Backup consistente
de banco, imagens e configuração e validação de restauração precedem implantação.
Histórico de recomendações abaixo preservado; prevalece esta decisão onde houver
conflito com a exigência de instalação dedicada. Testes reais e simulações devem
ser diferenciados nas evidências; não se presume homologação por testes unitários.

## 11. Revisão de produto e arquitetura — 2026-10-24

Esta seção detalha a proposta; não representa implementação ou aprovação jurídica.

### 11.1 Situação verificada no código

Busca por trial/degustação/demo mode no backend, frontend, shared e Prisma não
localizou controle específico. O modelo `Tenant` não contém modalidade ou ciclo
de vida de trial. O modelo `License` já possui `maxUsers`, `maxHosts`, limites de
sessões, entitlements e `expiresAt`. O serviço `LicenseEntitlementService` exige
habilitação explícita de recursos. Isso oferece base reutilizável, mas não comprova
revogação de sessões em andamento, provisionamento ou destruição de laboratórios.
A configuração `.env.example` também não documenta flag de trial. Inspeção local,
sem verificar variáveis privadas, infraestrutura instalada ou paridade de produção.

### 11.2 Mesmo produto, instalação dedicada

- Distribuir o mesmo código e artefato versionado para operação normal e degustação;
  evitar fork, branch permanente ou cópia independente das telas.
- Propor um perfil de instalação `standard|trial` (nome ainda conceitual), definido
  pelo operador no servidor. A instalação de trial tem banco, Redis, filas,
  credenciais, rede e laboratório separados da produção.
- Propor controle separado `trialRegistrationEnabled`, desligado por padrão, para
  abrir/suspender inscrições. Desligá-lo preserva atendimento aos trials ativos,
  expiração, limpeza e solicitações de privacidade. Não é fronteira de isolamento.
- Persistir cada trial com tenant, perfil/template versionados, estado e validade.
  Backend, gateways e workers aplicam a política; o frontend apenas a representa.
- Recursos efetivos são a interseção de disponibilidade técnica, licença, perfil
  do trial e permissões. Restrições de rede e destinos continuam obrigatórias.
- Toda release deve ser compatível com ambos os perfis. Publicar a mesma versão
  estável no ambiente demo após verificar migrações, isolamento, expiração e limpeza.
  Novos recursos ficam indisponíveis no trial até inclusão explícita em seu perfil.
- Atualização do aplicativo não recria laboratório, não reinicia prazo e não altera
  consentimentos. Templates têm versão própria; novos trials usam a versão aprovada,
  enquanto ambientes existentes preservam seu contrato. Atualizações de segurança
  e migrações obrigatórias exigem tratamento explícito e auditado.
- Pipeline deve testar modo normal e trial, incluindo sessões ativas e rollback
  compatível com banco. Não prometer interrupção zero; usar janela informada quando
  o upgrade exigir encerramento de sessões. Correção de segurança pode suspender
  recurso ou novas inscrições até nova validação.

### 11.3 Perfis e templates configuráveis

Configuração administrada pela Plataforma, com auditoria e validação no servidor;
o visitante pode escolher somente ofertas publicadas, nunca quotas ou imagens livres.

| Configuração | Regra proposta |
| --- | --- |
| Prazo | Dias de uso desde a prontidão; antecedência do aviso e limite de prorrogação |
| Usuários | Máximo de participantes, convites permitidos e papéis restritos |
| Hosts | Limite de entradas do inventário, permissões e destinos permitidos |
| Máquinas | Quantidade, imagens aprovadas, CPU, RAM, disco e política de rede |
| Conteúdo inicial | Pastas, hosts, arquivos fictícios, snippets e exercícios |
| Recursos | Lista explícita de funcionalidades disponíveis no trial |
| Operação | Limite global de trials, orçamento, fila e capacidade reservada |
| Limpeza | Prazo operacional, tentativas, alertas e reconciliação |

Host cadastrado é um registro de conexão; máquina é infraestrutura provisionada.
Modelar separadamente, vinculando o inventário aos recursos efetivamente criados.
Validar que o template cabe nas quotas e que nenhum destino escapa do laboratório.
Contas reais são ativadas individualmente após verificação; exemplos fictícios
podem existir como dados, sem contas de login compartilhadas. Senhas, chaves e
fingerprints são gerados por ambiente, nunca copiados do template.

Cada trial recebe um snapshot da configuração, evitando que mudar o perfil padrão
altere contratos ativos. Ajustes individuais exigem autorização, auditoria e
checagem de consumo; não podem ultrapassar os limites de segurança da instalação.

### 11.4 Propostas comerciais e inteligência de marketing

A finalidade deve ser específica; “marketing e etc.” não define escopo suficiente.
Bases candidatas devem ser validadas para o tratamento concreto antes de ativá-lo.
O art. 7º, V, da LGPD pode amparar proposta solicitada quando atendidos seus
requisitos; não autoriza automaticamente campanhas futuras, inclusive em contatos
B2B nos quais o titular representa outra pessoa jurídica.

Legítimo interesse não é autorização genérica: exige avaliação documentada de
finalidade, necessidade, expectativas, balanceamento e salvaguardas; não se aplica
a dados sensíveis. O MVP prefere opt-in para campanhas e personalização comercial.

| Uso desejado | Implementação proposta |
| --- | --- |
| Operar o teste | Nome/e-mail e comunicações de ativação, prazo e suporte |
| Elaborar proposta solicitada | Ação explícita “Quero uma proposta”; perguntar empresa, faixa de usuários/hosts, recursos de interesse e canal preferido; coletar só o necessário |
| Campanhas futuras | Opção desmarcada para ofertas/novidades, com canais claros e descadastro simples; acesso ao trial independente da escolha |
| Pesquisa | Convites opcionais, separados de campanhas; respostas voluntárias |
| Inteligência de mercado | Preferir estatísticas agregadas de interesses declarados e conversão; evitar grupos pequenos que permitam reidentificação |
| Personalização por uso | Finalidade e preferência próprias para relacionar eventos de uso ao contato comercial; recusa mantém o teste disponível |

Exemplos de dados opcionais úteis: segmento, faixa de tamanho da equipe, faixa de
hosts e funcionalidades desejadas. Solicitar progressivamente, preferencialmente
quando o visitante pedir proposta. Não coletar CPF, credenciais, inventário real,
conteúdo do terminal, gravações ou arquivos para qualificação comercial.

Como requisito de produto, eventos de adoção usam lista fechada, como
`trial_ready`, `first_connection_succeeded`, `sftp_exercise_completed` e
`proposal_requested`, sem texto livre, comandos, caminhos ou destinos. Associação
com pessoa/tenant continua sendo dado pessoal e precisa de finalidade/base própria;
agregação posterior não dispensa justificar a coleta original. Relatórios comerciais
não recebem conteúdo de auditoria. Dados fictícios do laboratório não tornam
automaticamente anônima a atividade do visitante.

Cookies/pixels de publicidade ficam bloqueados até escolha específica; consentir
em e-mails não habilita rastreamento. Oferecer recusa e gerenciamento acessíveis.
Para analytics, documentar finalidade e base; não pressupor isenção por usar
ferramenta própria ou identificador pseudônimo. No MVP, evitar remarketing externo.

CRM recebe apenas campos aprovados e finalidade, origem, versão do aviso,
preferências e prazo de retenção. Antes de enviar campanhas, revalidar permissão,
inclusive em filas e exportações. Revogação deve alcançar os fornecedores; eventual
registro mínimo de supressão exige justificativa e não serve a novas campanhas.

Definir tabela de retenção por categoria, responsável e evento inicial do prazo;
não há prazo comercial universal adotado nesta proposta. Vencimento do trial não
renova marketing nem exige apagar imediatamente registros cuja conservação tenha
fundamento válido. Disponibilizar canal para acesso, correção e demais direitos.
Avaliar operadores, segurança e transferências internacionais antes de integrar CRM
ou IA. IA comercial, se adotada, deve usar dados aprovados e revisão humana; não
enviar sessões ou segredos a modelos. Avaliar art. 20 para decisões exclusivamente
automatizadas que afetem interesses, inclusive perfis comerciais.

Fontes consultadas em 2026-10-24:

- [LGPD, texto compilado](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm), especialmente arts. 6–10, 15–20, 33 e 46.
- [ANPD, guia de legítimo interesse](https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/guia_orientativo_hipoteses_legais_tratamento_de_dados_pessoais_legitimo_interesse).
- [ANPD, guia de cookies](https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/guia-orientativo-cookies-e-protecao-de-dados-pessoais.pdf/@@display-file/file).

### 11.5 Validações adicionais antes de liberar

- Recusar marketing/personalização não impede ativação ou uso do teste.
- Solicitar proposta sem assinar campanhas permite somente o atendimento pertinente.
- Revogar preferência bloqueia próximos envios, inclusive os já enfileirados.
- Trocar o perfil padrão não muda trials ativos nem excede quotas globais.
- Usuário/administrador do tenant não altera modalidade, limites ou template.
- Cada release mantém modo normal, isolamento, prazo original, preferências e
  revogação de sessões; recursos novos exigem habilitação explícita.

## Referências

- [PRD Lite](./PRD-lite.md)
- [Licenciamento e entitlements](./PRD-license-entitlements-lite.md)
- [Políticas de sessão](./PRD-session-policy-lite.md)
- [Auditoria de sessão](./PRD-session-audit-lite.md)
- [LGPD — Lei nº 13.709/2018](https://planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm)
- [ANPD — orientação sobre legítimo interesse](https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/guia_orientativo_hipoteses_legais_tratamento_de_dados_pessoais_legitimo_interesse)

Referências legais consultadas na avaliação de 2026-10-07; revisar sua aplicação
ao fluxo concreto antes do lançamento.
