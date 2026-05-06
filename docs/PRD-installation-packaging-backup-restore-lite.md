# PRD Installation Packaging Backup Restore Lite

## Objetivo
Reduzir o atrito para instalar, atualizar, empacotar, fazer backup e restaurar o NodeAccess em ambientes reais, sem exigir conhecimento profundo do monorepo ou intervenção manual arriscada no banco.

## Problema
O projeto ja tem base funcional de deploy com Docker, mas a operacao ainda esta fragmentada:
- instalacao inicial depende de leitura dispersa entre `README.md`, `docs/DEPLOY-lite.md` e compose manual
- o empacotamento existe em nivel de imagem Docker, mas nao como entrega operacional padronizada por versao
- nao ha fluxo padrao de backup e restore de banco com validacao e checklist
- nao ha artefato oficial unico para levar a outro servidor em ambiente sem registry
- nao ha runbook claro para upgrade com rollback e preservacao de chave de criptografia

Isso aumenta risco de:
- erro de instalacao
- ambientes inconsistentes
- perda de dados ou restore incompleto
- downtime desnecessario em upgrade
- suporte operacional caro e pouco previsivel

## Resultado Esperado
Um operador tecnico deve conseguir:
1. instalar uma instancia nova com poucos comandos
2. subir uma versao especifica a partir de artefatos oficiais
3. executar backup com validacao minima
4. restaurar em ambiente novo ou no mesmo ambiente com procedimento seguro
5. atualizar com previsibilidade e rollback claro

## Principios
- priorizar operacao previsivel antes de sofisticacao
- nao depender de conhecimento interno do monorepo para tarefas basicas
- artefatos devem ser versionados e reproduziveis
- backup sem restore testado nao conta como backup confiavel
- restore deve preservar compatibilidade com `PEM_ENCRYPTION_KEY`
- preferir poucos comandos oficiais em vez de guias longos e ambíguos
- manter abordagem Docker-first

## Estado Atual Observado
### O que ja existe
- `README.md` com fluxo de desenvolvimento e exemplo de producao
- `docs/DEPLOY-lite.md` com orientacao curta de build, compose e migrate
- `docker-compose.yml` para desenvolvimento
- `docker/backend.Dockerfile` e `docker/frontend.Dockerfile`
- migrations Prisma aplicaveis por `npm run db:deploy -w apps/backend`
- export manual de imagens com `docker save`

### Lacunas principais
- nao existe pacote oficial unico de release com compose, env template e checklist
- o compose de producao aparece como exemplo em documentacao, nao como artefato versionado do repo
- nao existe script oficial de `backup` e `restore`
- nao existe manifest com versao do app, versao de schema e checksum dos artefatos
- nao existe validacao pos-restore padronizada
- nao existe fluxo oficial de rollback operacional
- segredos criticos para restore estao documentados, mas nao tratados como parte explicita do processo

## Escopo

### 1. Instalacao Inicial
Entregar um caminho oficial de primeira instalacao para ambiente self-hosted.

#### Deve incluir
- template oficial de producao:
  - `.env`
  - `docker-compose.prod.yml`
  - volumes esperados
  - portas e URLs publicas
- checklist de pre-requisitos:
  - Docker
  - Docker Compose
  - DNS/TLS
  - persistencia de volume
  - espaco em disco
- fluxo oficial de bootstrap:
  - configurar env
  - subir MySQL e Redis
  - aplicar migrations
  - subir API, gateway e frontend
  - validar health basico

#### Nao deve exigir no MVP
- Kubernetes
- Helm
- instalador grafico
- automacao completa de TLS

### 1.1 Recuperacao de acesso administrativo
Definir um caminho seguro para recuperar acesso quando o admin perder senha, perder acesso ao MFA ou quando nao houver mais um admin funcional no tenant.

#### Problema especifico
Hoje existe um script de bootstrap para promover `platform admin`, mas isso nao cobre todo o problema operacional:
- o usuario pode existir e ter perdido a senha
- o usuario pode ter perdido o segundo fator
- pode nao haver nenhum admin funcional no tenant
- o operador pode precisar recuperar o acesso sem editar o banco manualmente

#### Objetivo
Permitir recuperacao administrativa segura, auditavel e previsivel, com minimo de improviso operacional.

#### Abordagem recomendada
Usar duas camadas complementares:

##### Camada A. Recuperacao offline por script operacional
Fluxo para uso pelo operador do servidor quando o acesso pela UI estiver indisponivel.

Comandos esperados no MVP:
- promover um usuario existente para `platform admin`
- forcar reset de senha de um usuario por email
- opcionalmente invalidar MFA do usuario com confirmacao explicita
- opcionalmente marcar `forcePasswordChange=true` no proximo login

Regras:
- exigir acesso ao servidor e `.env` valido
- logar o evento de recuperacao em `AdminLog` quando possivel
- imprimir aviso claro de seguranca no terminal
- nunca exibir senha em claro em logs

##### Camada B. Recuperacao governada dentro da plataforma
Fluxo para quando ainda existe algum admin autenticado ou um canal secundario de verificacao disponivel.

Direcao recomendada:
- permitir a um `platform admin` iniciar recuperacao de outro admin
- emitir token de recuperacao de uso unico e curta duracao
- opcionalmente entregar por email corporativo se o tenant tiver email configurado
- exigir redefinicao imediata de senha e reconfiguracao do MFA

#### Guardrails
- nao permitir bypass silencioso de MFA sem auditoria
- toda recuperacao administrativa deve gerar log administrativo dedicado
- a recuperacao deve ter escopo minimo necessario
- o operador deve ser lembrado de revisar e revogar acessos temporarios apos a recuperacao

### 2. Empacotamento e Releases
Definir um formato de release operacional consumivel por times de infra.

#### Entregaveis desejados
- pacote de release versionado, por exemplo:
  - `nodeaccess-release-<versao>.tar.gz`
- conteudo minimo do pacote:
  - `docker-compose.prod.yml`
  - `.env.example.prod`
  - `RELEASE-NOTES.md`
  - `VERSION`
  - `checksums.txt`
  - scripts operacionais
- opcao de distribuicao por:
  - registry privado
  - pacote offline com `docker save`

#### Requisitos
- backend e frontend devem compartilhar a mesma versao de release
- a release deve identificar a versao de schema esperada
- deve existir comando oficial para validar o pacote antes do uso

### 3. Backup
Definir backup operacional padronizado com foco inicial em MySQL e configuracoes criticas.

#### MVP de backup
- backup consistente do MySQL
- empacotamento do dump com metadata:
  - data/hora
  - versao do app
  - hostname de origem
  - hash do arquivo
- opcao de incluir:
  - `.env` sanitizado ou checklist de variaveis obrigatorias
  - manifest informando que `PEM_ENCRYPTION_KEY` nao esta dentro do dump
- padrao de nome de arquivo
- local padrao de saida

#### Regras importantes
- `PEM_ENCRYPTION_KEY` e outros segredos nao devem ser embutidos no backup automaticamente
- o processo deve lembrar explicitamente que sem a mesma `PEM_ENCRYPTION_KEY` nao sera possivel descriptografar PEMs e secrets antigos
- backup de Redis nao e prioridade no primeiro corte se os dados forem regeneraveis ou nao autoritativos

### 4. Restauracao
Definir restore seguro, reproduzivel e com validacao pos-restore.

#### MVP de restore
- restaurar dump MySQL em ambiente alvo
- reaplicar env correto
- subir servicos na versao compativel
- executar validacoes minimas:
  - login admin
  - leitura de hosts
  - leitura de integracoes
  - leitura de PEM/secrets cifrados
  - abertura de sessao SSH de teste

#### Guardrails
- restore deve exigir confirmacao explicita em ambiente nao vazio
- deve haver modo recomendado para restore em ambiente temporario de homologacao
- se houver mismatch de versao, o processo deve avisar antes de sobrescrever
- o runbook de restore deve incluir verificacao de acesso administrativo funcional apos a subida

## Fluxos Recomendados

### Fluxo 1. Nova instalacao
1. baixar release oficial
2. copiar `.env.example.prod` para `.env`
3. preencher segredos e URLs
4. subir stack base
5. executar bootstrap e migrations
6. validar health e login inicial

### Fluxo 2. Upgrade
1. executar backup antes do upgrade
2. baixar nova release
3. validar compatibilidade e release notes
4. atualizar imagens/artefatos
5. aplicar migrations
6. validar aplicacao
7. manter rollback documentado

### Fluxo 3. Backup manual
1. rodar script oficial de backup
2. obter dump + manifest + checksum
3. armazenar em destino seguro
4. opcionalmente testar restore em ambiente isolado

### Fluxo 4. Restore
1. preparar ambiente alvo
2. garantir posse da `PEM_ENCRYPTION_KEY` correta
3. restaurar banco
4. subir mesma release ou release compativel
5. validar login, secrets e terminal

### Fluxo 5. Recuperacao de admin
1. validar se ainda existe algum admin funcional pela UI
2. se nao houver, usar script offline oficial no servidor
3. redefinir senha ou promover admin com escopo minimo necessario
4. forcar troca de senha no proximo login
5. revisar MFA e acessos administrativos
6. registrar e revisar o evento de recuperacao

## Requisitos Funcionais
- existir script ou comando oficial para:
  - `install`
  - `backup`
  - `restore`
  - `validate`
- existir script ou comando oficial para `recover-admin`
- existir manifest de release e manifest de backup
- existir modo offline para transportar imagens
- existir checklist curta de restore
- existir validacao rapida pos-instalacao e pos-restore
- existir checklist curta de recuperacao administrativa

## Requisitos Nao Funcionais
- comandos devem ser idempotentes quando possivel
- toda operacao destrutiva deve pedir confirmacao clara
- logs operacionais devem ser legiveis e objetivos
- scripts devem falhar cedo quando faltar:
  - env obrigatorio
  - arquivo esperado
  - chave critica
- preferir shell script simples no primeiro corte
- documentacao deve servir tanto para Linux local quanto para servidor Ubuntu comum

## Fases Recomendadas

### Fase 1. Foundation operacional
- criar compose de producao oficial no repo
- consolidar `.env.example.prod`
- criar script de validacao de env
- criar script de healthcheck pos-subida
- consolidar script oficial de recuperacao administrativa offline

### Fase 2. Release artifact
- gerar pacote versionado oficial
- gerar checksums
- padronizar export/import offline de imagens
- documentar release notes minimas

### Fase 3. Backup e restore
- script oficial de backup do MySQL
- script oficial de restore
- manifest de backup
- checklist de validacao pos-restore
- incluir verificacao de login admin e plano de recuperacao caso falhe

### Fase 4. Upgrade e rollback
- fluxo documentado de upgrade
- fluxo documentado de rollback
- validacoes de compatibilidade de versao e schema

### Fase 5. Admin recovery governado
- endpoint ou fluxo interno para recuperacao administrativa auditada
- token temporario de recuperacao ou reset assistido
- forcar troca de senha e recomposicao do MFA

## Medidas de Sucesso
- menor tempo para primeira instalacao funcional
- menor quantidade de passos manuais fora da documentacao oficial
- backup executado por comando unico
- restore validado com sucesso em ambiente de teste
- menor dependencia de suporte do time de produto para tarefas operacionais

## Fora de Escopo Inicial
- backup continuo gerenciado pela propria aplicacao
- snapshot orchestration em cloud provider
- Kubernetes, Helm ou operador dedicado
- HA multi-node
- DR automatizado multi-regiao
- UI administrativa completa para backup/restore
- self-service irrestrito de bypass de MFA sem verificacao adicional

## Arquivos Provaveis
- documentacao:
  - `README.md`
  - `docs/DEPLOY-lite.md`
  - `docs/DEPLOY-DATABASE-VERSIONING.md`
  - `docs/PRD-installation-packaging-backup-restore-lite.md`
- infraestrutura:
  - `docker-compose.prod.yml`
  - `docker/backend.Dockerfile`
  - `docker/frontend.Dockerfile`
- scripts:
  - `scripts/release/*.sh`
  - `scripts/backup/*.sh`
  - `scripts/install/*.sh`
  - `apps/backend/scripts/promote-platform-admin.mjs`
  - `apps/backend/scripts/recover-admin-access.mjs`

## Proximo Corte Recomendado
1. oficializar `docker-compose.prod.yml` no repo
2. criar `.env.example.prod` com variaveis obrigatorias e comentarios minimos
3. criar script `validate-env`
4. criar script `backup-mysql`
5. criar script `restore-mysql`
6. consolidar script `recover-admin-access`
7. consolidar um runbook unico de instalacao, upgrade e recuperacao
