---
change_id: NA-0050
title: Atualizar o estado local e validar scripts no WSL
type: fix
status: ready-for-review
created_at: 2026-10-09T10:47:04.796243-03:00
base_branch: chore/NA-0049-20261009-local-consolidation
base_sha: 9be2f73ac28f5af8678c56849f704185ab9059a0
branch: fix/NA-0050-20261009-wsl-dev-stack
owner: jeferson
planner: Codex
risk: high
issue: null
---

# NA-0050 — Ambiente local e scripts no WSL

## Contexto e situação anterior

Workspace Linux limpo no SHA base. MySQL local 8.0.45 e Redis 7.4.8
foram criados pelo Compose da pasta OneDrive; código prevê 8.4.12/8.2.10.
Guacd 1.5.5 deve permanecer intacto. Master rastreia origin/master, mas
GitHub está sem autenticação; base desta continuação é o commit local conhecido,
não uma alegação de master atualizada. NA-0049 permanece pendente de publicação.

## Problema e objetivo

Deixar o desenvolvimento na pasta Linux funcionando com as imagens já
selecionadas, preservando dados e verificando scripts de operação/release.

## Escopo

- Backup privado de MySQL, Redis, configurações e metadados necessários à recuperação.
- Ensaio de restauração, atualização apenas dos containers mysql/redis locais.
- Corrigir incompatibilidades demonstradas de Compose/scripts com WSL/stack atual.
- Revisar scripts/ por caminhos fixos, versões antigas, resolução de paths e gates de release.
- Fora: produção, atualização de guacd, serviços de outros projetos, novas versões de dependências,
  publicação de release, mudanças de autenticação da aplicação e desativação de assinatura.

## Critérios de aceitação

- [x] Backup com checksum e restauração validada antes da atualização.
- [x] MySQL 8.4.12/Redis 8.2.10 saudáveis, dados preservados e retorno documentado.
- [x] Guacd e containers de outros projetos preservados.
- [x] npm run dev: API, gateway e frontend disponíveis, migrations em dia.
- [x] Scripts revisados, correções mínimas acompanhadas por checks proporcionais.
- [x] Release preserva gates de assinatura e documenta qualquer pré-requisito externo.

## Estratégia técnica

Usar projeto Compose nodeaccess e volumes existentes. Backup lógico com dump
e backup físico a frio antes do upgrade; restauração isolada sem portas públicas.
Somente após verificar dados, recriar mysql e redis pela pasta Linux.
Fixar identidade Compose quando necessário; caminhos de scripts derivados da raiz.

## Riscos e mitigações

- Upgrade altera o formato do volume: guardar cópia fria e imagens antigas; nunca
  executar MySQL 8.0 no volume alterado por 8.4.
- Interrupção local autorizada; iniciar aplicação apenas após verificação dos dados.
- Dados/senhas ficam em diretório privado, fora do Git; logs públicos somente agregados.
- Release Windows pode exigir host Windows e assinatura; não contornar validações.

## Matriz de testes e evidências

| Critério | Validação | Ambiente | Evidência |
|---|---|---|---|
| Backup | gzip/checksum + restore + contagens e digest de dados | Docker isolado | reports/NA-0050 |
| Upgrade | versões, saúde, paridade, guard e configurações | Docker local | reports/NA-0050 |
| Dev | readiness API/gateway, frontend HTTP, migrations | WSL Node 24 | reports/NA-0050 |
| Scripts | sintaxe shell/JS, harnesses relevantes, paths com espaços | WSL | reports/NA-0050 |
| Release | gates reais de artefatos/assinatura e teste de empacotamento | local/isolado | reports/NA-0050 |

## Baseline

- Base SHA: 9be2f73ac28f5af8678c56849f704185ab9059a0; git status limpo.
- MySQL: caching_sha2_password em todas as seis contas; zero conexões da aplicação.
- Volumes: nodeaccess_mysql_data e nodeaccess_redis_data.
- Imagens alvo disponíveis localmente; diretório Linux com espaço livre suficiente.
- Scripts de release já referenciam MySQL 8.4.12 e Redis 8.2.10; revisão em andamento.

## Rollback ou recuperação

Parar apenas aplicação e containers NodeAccess mysql/redis. Restaurar cópia fria
em NOVOS volumes e recriar usando IDs das imagens/configuração originais salvos
no backup privado. Não fazer downgrade sobre volumes migrados. Preservar .env e
PEM_ENCRYPTION_KEY. Alterações de código reversíveis pela branch/base registrada.
Referência: https://dev.mysql.com/doc/refman/8.4/en/downgrading.html

## Mudanças de escopo e decisões

IN_PLAN: manutenção local explicitamente autorizada pelo usuário, incluindo backup,
aplicação e revisão dos scripts. Usar versões fixadas e já ensaiadas em NA-0046/48.
Não atualizar remotamente nem depender de fetch indisponível para a operação local.

NECESSARY_CORRECTION: o fallback PowerShell tentava executar npm.cmd em caminho
UNC de WSL e recebia paths Linux de chaves. Linux/WSL agora exige importação de
artefatos Windows assinados, mantendo build nativo Windows e validação de origem.
Overrides de imagens são aplicados às referências dos Composes empacotados.
Fixtures dos testes de proveniência usam chaves RSA descartáveis e verificam
assinaturas adulteradas; nenhum gate de assinatura de produção foi removido.

Validação operacional: comparação Redis inicial esperava strings e aceitou uma
resposta de erro Lua como texto; essa evidência foi invalidada. Novo comparador
valida JSON/tipos e confirmou restauração física e migração isolada da imagem
original para Redis 8.2.10, além da entrada original no Redis em uso.


## Aprovação

- Decisão: GO_WITH_RISKS
- Aprovado por: usuário, ao solicitar backup, aplicar atualização e deixar dev pronto.
- Aprovado em: 2026-10-09 (conversa atual; escopo operacional explicitamente autorizado).
