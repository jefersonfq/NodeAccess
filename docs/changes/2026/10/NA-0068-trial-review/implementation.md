# NA-0068 — Registro da implementação

## Pedido e objetivo
Verificar se existe resumo de degustação com cadastro pelo site e prazo configurável, considerando LGPD.

## Implementação
Revisado o PRD de degustação e seu índice. Criados plano e registro desta revisão e entrada no índice. Base SHA: `66444a9dd4c167453004bb6089278548bdd2c0d9`. Aplicação e alterações preexistentes preservadas; sem commit ou publicação.

## Validação
Manual: leitura do PRD e busca no mapa confirmam proposta documentada. Skipped: testes de aplicação, sem alteração funcional. Na primeira interação não foram auditados código, produção ou conformidade jurídica; a revisão complementar abaixo inspeciona controles específicos no código e fontes oficiais, sem certificar conformidade.

## Recuperação
Remover documentos desta revisão e sua entrada no índice. Sem mudanças de banco ou configuração. Base registrada acima.

## Pendências
Implementação local em andamento; laboratório definitivo, assinatura dos artefatos, SMTP real, conteúdo de privacidade/termos, backup/restore e release/deploy ainda pendentes. Perfil parametriza prazo, recursos e retenção.

## Diário de interações

### 2026-10-24T10:19:19-03:00 — Revisão documental
Solicitada verificação de resumo de degustação. Encontrado PRD de 2026-10-08 com cadastro verificado, laboratório isolado, sete dias configuráveis, expiração e requisitos de privacidade. O documento declara proposta não entregue. Próximo passo: confirmar decisões de produto. Nenhum teste funcional executado.

### 2026-10-24T10:25:27-03:00 — Marketing, isolamento e perfis configuráveis
Pedido: avaliar uso legal de dados em propostas/inteligência comercial, existência de flag de degustação e compatibilidade com releases e templates configuráveis. Inspecionados schema Tenant/License, serviço de entitlements, configuração de exemplo e buscas em backend/frontend/shared/Prisma. Não encontrado mecanismo específico de trial nesse escopo; quotas e entitlements oferecem base. Consultadas LGPD compilada e publicações oficiais da ANPD sobre legítimo interesse e cookies. Atualizada seção 11 do PRD e plano com proposta de instalação dedicada usando o mesmo artefato, controle de inscrições, configuração versionada e políticas por finalidade. Base SHA permanece `66444a9dd4c167453004bb6089278548bdd2c0d9`.
Validação: leitura técnica e documental; diff revisado e `git diff --check` executado sem erros nos caminhos da revisão. Sem testes funcionais por ausência de alteração de código. Limitações: sem inspeção de produção, auditoria jurídica ou homologação de infraestrutura. Próximo passo: definir bases/retenção e aprovar especificação para implementação. Recuperação: reverter apenas os acréscimos desta interação nos três documentos, preservando o registro anterior e mudanças de outras frentes.

### 2026-10-24T11:07:08-03:00 — Implementação autorizada, convivência e testes de falha
Usuário autorizou branch separada, implementação fim a fim, release 2.1.0 pelos scripts existentes e preparação dos ajustes no site, com solicitação de acesso remoto somente ao estar pronto. Esclareceu convivência de produção/trial na mesma instalação, sem alterar contas existentes ou criadas pela administração normal; solicitou backup do banco/imagens atuais para rollback e testes amplos de uso normal e falhas de usuário.
Criado worktree `/tmp/nodeaccess-NA-0068`, branch `feature/NA-0068-20261024-trial-environments`, base 66444a9dd4c167453004bb6089278548bdd2c0d9. Fetch remoto não respondeu e foi interrompido; base remota ainda exige revalidação. Mudanças anteriores de outras frentes preservadas no checkout original.
Em andamento: módulo trial, migração aditiva, cadastro/verificação/recuperação de link, preferências, convites, perfil/template/quotas, ativação com MFA existente, política HTTP/SSH/SFTP/compartilhamento e bloqueio de ingressos alternativos. Instalador flag-only, backup de imagens/banco/configuração, interface pública/admin e testes. Configuração de infraestrutura real continua pendente; não houve implantação, envio de mensagens reais ou exposição de credenciais.
Ran: baseline 34 testes; 147 migrações aplicadas em MySQL descartável; typecheck backend; testes específicos de instalação/empacotamento, contrato, privacidade, política e navegador executados pelos papéis de implementação/validação. Rodada completa inicial executou 232 arquivos, mas teve falhas por edição concorrente de regex e duas expectativas antigas; não é aprovação e será repetida após correções. SQL real encontrou falta de nós/ACL no provisionamento, corrigida com permissões herdadas somente view/connect, aguardando repetição. Ensaios de retenção em schema separado validaram FK e arquivos sem afetar tenant normal. Node24.21.0 extraído de imagem local; dependências copiadas isoladamente após cache npm incompleto, portanto reprodução exata do lock ainda é gate.
Limitações: provider/isolamento real, SMTP real, PTY real, build assinado, backup/restauração do ambiente alvo e deploy pendentes. Sem promessa de ausência absoluta de bugs. Próximo passo: concluir integração, revisão independente e evidências antes de release/deploy.

### 2026-10-24T11:48:40-03:00 — Integração, falhas reais e acesso ao ambiente
Pedido/decisão: usuário indicou servidor já utilizado para testes e autorizou gerar
novos artefatos atualizados. Credenciais foram tratadas fora do repositório. A chave
local exigiu normalização CRLF em cópia privada temporária; original preservado.
Inspeção remota somente leitura: instalação atual 2.0.3, MySQL8.0/Redis7, sites com
publicação por symlink, host Xen2vCPU/~3.6GiB sem KVM. Nenhuma alteração remota,
backup, reinício, deploy ou publicação executados. Necessária decisão de laboratório
antes de abrir cadastro. Não reutilizar SSH de produção como laboratório público.

Feito: backend/frontend/instalador integrados; migrações aditivas147/148 aplicadas em
MySQL descartável. Quotas, ACL dos hosts, convites/reservas, cancelamento concorrente,
fingerprint SSH e navegação inicial corrigidos após ensaios reais. Auditoria é
somente leitura quando habilitada. Telemetria UX/produtividade de trial descartada.
Fila de avisos operacionais inclui retry, lease, fencing, renovação, seleção antes
LIMIT e estados SENT/SKIPPED distintos. Revisão independente reproduziu P2002 na
criação simultânea; createMany skipDuplicates corrigiu. Contrato de provisionador
exige idempotência e tombstone contra criação tardia após DELETE.

Arquivos/fluxos: modules/trials e guards/ingressos autenticados; schema/migrations;
onboarding/admin/Hosts/Terminal/manual; configure-trial e backup-release-state;
docs/OPERATIONS-trial-environments.md. Patch do CTA público preparado contra HTML
atual em site-onboarding.patch, sem publicação; mantém login e contato comercial.
Clavinci já encaminha ao NodeAccess. Validação visual desse patch ainda pendente.

Validações realmente executadas: npm ci com lock exato e Node24.21; typecheck global;
suíte completa final2019pass/66opt-in skipped,223arquivos aprovados/15ignorados.
Primeira repetição falhou ao importar localStorage no teste Node de presença de
túneis; mock da dependência de capabilities e espera assíncrona corrigidos, incluindo
2casos para trial/falha. Não houve enfraquecimento de regra de produto.
Revisão independente72casos (service36/provider19/retention7/notices10) passou;
SQL onboarding8pass após migration148; SQL admissão5pass; transporte real2pass:
SSH expira com API/worker SIGSTOP e DB aindaACTIVE, sessão normal segue executando;
SFTP em andamento encerra ao cancelar e reuso é negado. API retomada, fixtures próprias
limpas. Browser20casos×6combinações; live MFA normal/trial+SSH/SFTP sem errosHTTP/JS;
PTYtop/htop reais; terminal-experience, manual18testes/capturas/hashes passaram.
ESLint estrito do módulo trial e testes passou; diffcheck passou. Evidência detalhada
frontend-evidence.md e logs locais /tmp/na0068-final-full-tests.log,
/tmp/na0068-independent-trial-tests.log, /tmp/trial-transport-real.log.

Limitações: SMTP e criação de VMs simulados nos ensaios; conexãoSSH real usa fixture
confiável descartável e não certifica hypervisor definitivo. Sem entrega pública2.1.0.
Build local não substitui pacote oficial com fonte limpa e artefatos assinados.
Windows anteriores rejeitados pelo validador oficial por fonte desatualizada;
PowerShell/Node Windows disponíveis, mas certificado/chaves de release não
localizados. Solicitada localização de certificado/runner, sem pedir segredos no chat.
Fetch remoto expirou; baseline remota fresca ainda não comprovada. Backup/restore,
upgrade MySQL8.0→8.4/Redis7→8 e homologação humana continuam gates separados.
Estado LOCAL_WIP, sem commit/push/merge/tag. Base SHA permanece66444a9dd4c167453004bb6089278548bdd2c0d9.
Próximo passo: concluir último ensaio de backoff concorrente, build local e registro;
com laboratório/assinatura definidos, preparar pacote oficial, backup/restore e deploy.

### 2026-10-24T11:49:58-03:00 — Fechamento da validação local desta interação
Último ajuste: claim de notificação revalida nextAttemptAt; worker com snapshot
antigo não ignora backoff SMTP gravado por outro. Teste independente reproduz essa
janela com dois workers:11/11notices passaram; lint estrito passou. Não foi repetida
suíte completa após esse predicado localizado; cobertura real específica foi repetida.
Build local final com VITE_APP_VERSION=2.1.0 passou (shared/backend/frontend), mantendo
aviso de chunk vendorUI acima950kB. Isso não é pacote oficial2.1.0 nem releaseassinada.
Typecheck global e diffcheck passaram. O validador de governança foi consultado sem
argumentos suficientes (exit2 de uso), não tratado como check aprovado. Não há SHA
final: fontes permanecem na branch/worktree isolada em LOCAL_WIP. Próximo passo
externamente dependente: definir laboratório e certificado/runner de assinatura;
autorização para gerar artefatos já recebida, não precisa ser solicitada novamente.

### 2026-10-24T14:00:57-03:00 — Ampliação de escopo, assinatura e recuperação real

Pedido e decisões: o usuário autorizou um certificado próprio e a atualização do
VPS atual, com criação de tenants. Escolheu hosts de demonstração prontos e depois
acrescentou a criação de até X máquinas e o cadastro de hosts do próprio parque,
tudo parametrizável. Reforçou que a flag controla apenas o onboarding e que tenants
normais/SaaS e a criação administrativa permanecem sem alterações. Forneceu o SMTP
por arquivo e confirmou a manutenção da confiança local no Windows para instalação
e testes. Essas decisões não autorizam registrar credenciais privadas no Git ou
em logs, nem estabelecer confiança automática nas máquinas dos clientes.

Implementação: `TrialMachines` mantém a quantidade desejada de máquinas de forma
durável, com reservas de quota transacionais, reconciliação dos trials ACTIVE após
reinício e expansão sem trocar credenciais, IPs ou chaves existentes.
`TrialCustomHosts` aceita IPv4 público literal, bloqueia destinos internos e o plano
de controle, cifra senhas/PEMs e aplica ACL individual, preservando o fluxo normal.
As permissões dos hosts de demonstração passaram de herança ampla para concessões
explícitas por host, evitando acesso de outros participantes aos hosts pessoais.

As escritas têm limite separado da autenticação. A validação de PEM ocorre em
processo filho, com dois slots, prazo de dois segundos e SIGKILL após timeout;
a entrada segue por stdin, sem segredos em argumentos ou variáveis de ambiente.
O encerramento revoga PEMs exclusivamente vinculados ao trial, e a retenção minimiza
os nomes de hosts e inventário. O monitor SSH/SFTP fecha conexões quando o host é
excluído ou muda de IP/porta. A interface administrativa, o painel, os menus e os
caches foram atualizados para refletir quotas e estados sem aguardar o TTL.

O provisionador HTTPS separado, em `scripts/trial-lab`, é operado exclusivamente
pelo administrador. Usa labels por UUID, redes /28, regras iptables específicas,
tombstones de DELETE, flock, limites de recursos e expansão idempotente. Nenhum
laboratório foi criado no VPS.

Assinatura: o WinTrust rejeitou o certificado inicial porque a configuração padrão
do OpenSSL duplicava BasicConstraints. A correção usou configuração explícita e
cadeia própria, com CA restrita a codeSigning e certificado final. PFX e chaves
permaneceram fora do Git; as cópias privadas temporárias no Windows foram apagadas.
A confiança em Root/TrustedPublisher foi mantida por decisão explícita do usuário,
que cancelou sua remoção no Windows. EXE/MSI 2.1.0 apresentaram Authenticode Valid;
o manifesto RSA e os digests foram validados. Nenhum aplicativo foi instalado.

O build Windows também revelou a ausência do catálogo compartilhado de diagnóstico
no checkout mínimo. O catálogo foi copiado e incluído no fingerprint oficial, com
teste. O package e o lock do agente foram atualizados para 2.1.0. Os runtimes oficiais
Linux/macOS foram baixados pelo Windows após falha de acesso ao GitHub no WSL;
seus hashes foram comparados com EXPECTED_HASHES do empacotador antes do uso.
Todos os artefatos passaram no check oficial, e o executável Linux retornou 2.1.0
com `--version`.

Backup real: os scripts foram copiados para um diretório de manutenção isolado no
VPS. Foram capturados banco, imagens pelos IDs atuais, auditoria, avatares,
configuração, sites, proxy e certificados. A validação inicial falhou porque
CERTS_DIR era relativo ao diretório dos scripts. O caminho foi corrigido para o
TLS da release atual e revalidado; o utilitário também foi corrigido para operações
futuras. O backup online de referência tem 553 MB, checksums, marcadores e uma cópia
externa privada. Ele não substitui o snapshot final consistente na janela de troca.

O MySQL 8.0 foi restaurado com a imagem salva, sem rede. Um segundo clone, em MySQL
8.4, restaurou o mesmo dump em rede interna, sem porta exposta. Os checksums das
migrações históricas coincidiram; `migrate deploy` passou com 148 migrações, incluindo
as pendentes. A comparação de todos os campos preexistentes de tenants, users,
hosts e licenses foi idêntica. A primeira tentativa de conexão ao ensaio recusou
root remoto; foi criada uma conta exclusiva para o banco de restauração, mantendo
root local. A produção não foi parada, recriada ou migrada.

Validações: a suíte consolidada registrou 2080 testes aprovados e 93 opt-in ignorados,
em 227 arquivos aprovados e 18 ignorados. Também foram registrados 37 unitários do
serviço, incluindo revogação de PEM; 15 casos SQL de máquinas, concorrência,
processamento justo e rollback; 51 casos de hosts próprios, raiz de inventário e
validação de PEM em processo filho, incluindo SQL; sete de retenção; cinco do
monitor de hosts; um SFTP real com exclusão; e um tenant normal criado pelo serviço
oficial, com login, MFA e cadastro de host enquanto a flag estava ligada.

O blackbox independente do provisionador passou, cobrindo fingerprint SSH, UID 1000,
capabilities zeradas na sessão, SFTP, DNS, IPv6, isolamento entre laboratórios e
controle, falhas durante PUT/DELETE, recriação do gateway e proteção de recursos
alheios. O resultado GO_WITH_RISKS se limita ao provisionador local: kernel
compartilhado e prontidão remota continuam sendo limites. O agente principal revisou
o módulo de hosts próprios e exigiu raiz válida e validação limitada de PEM;
as correções e os testes passaram.

A interface ampliada foi validada com expansão de uma para três máquinas, cadastro,
edição e exclusão de host próprio, menus e caches. Os fluxos normal/trial com MFA,
SSH e SFTP não apresentaram erros HTTP ou JavaScript. O endereço público usado no
CRUD foi apenas metadado; não houve conexão a esse IP. Também passaram: formulário
normal (6/6), serviços (24), experiência de terminal, manual (18), cinco capturas
inspecionadas com hashes validados, empacotamento/configuração (21), artefatos/digests
(18), política de conexão e revogação (76) e limitador (2). Typechecks e lints dos
novos módulos passaram. O build final web estava em andamento neste registro.
As evidências de frontend e Windows estão nesta pasta; os logs incluem
`/tmp/na0068-release-final-*.log` e `/tmp/na0068-restore-upgrade-resume.log`.

Limites e próximo passo: concluir a identificação no aviso de privacidade, validar
credenciais cifradas no banco restaurado, terminar a revisão de implantação e do
pacote final com fontes limpas e homologar provisionador/SMTP no VPS. Fazer o backup
final na janela de manutenção antes da promoção. Estado LOCAL_WIP, sem commit/push,
sem tar oficial da release 2.1.0 e sem implantação. Compilação e fixtures não devem
ser apresentadas como produção.

### 2026-10-24T14:11:19-03:00 — Autorização de commit e composição da release
Usuário autorizou registrar o commit da degustação e, em seguida, autorizou commitar
as demais frentes pendentes, revisar e integrá-las na versão 2.1.0 mais atualizada.
A base remota foi conferida via Git HTTPS no Windows: master permanece no SHA
66444a9dd4c167453004bb6089278548bdd2c0d9. O checkout original contém trabalho de
NA-0057 e NA-0059 a NA-0067 ainda sem commit; foi preservado em snapshot privado
antes de qualquer integração. A frente de clientes Android/macOS contém apenas
planejamento/documentação nesta etapa; não equivale a aplicativos implementados.
A integração do conjunto terá plano próprio NA-0069, mantendo a degustação rastreável.

Usuário informou a controladora CLAVINCI TECNOLOGIA LTDA, CNPJ69.282.852/0001-15,
Santa Catarina, e autorizou o mesmo e-mail operacional para pedidos de privacidade.
Identificação será usada no aviso público, sem revelar senha ou dados de acesso.
Checks finais desta árvore: 2080 testes passaram/93 opt-in ignorados; typecheck e
build local passaram. Todos os agentes Windows/Linux/macOS passaram verificação
oficial; Linux executou --version2.1.0. Credenciais cifradas restauradas puderam ser
abertas com a chave original sem exibição de conteúdo. Revisão complementar do
parser PEM e ACL de hosts próprios concluída; material privado fora do Git.
Próximo passo: commit autorizado desta frente, integração isolada dos snapshots,
resolução de conflitos e repetição das validações no conjunto antes de release/deploy.
