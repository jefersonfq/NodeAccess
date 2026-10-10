---
change_id: NA-0052
title: Dimensionar recursos locais e medir carregamento
type: perf
status: ready-for-review
created_at: 2026-10-09T16:00:00-03:00
base_branch: fix/NA-0051-20261009-forwardings-transition
base_sha: 164bbb489a29952c3b23c6c51fc33e8928720d6f
branch: perf/NA-0052-20261009-dev-resources
owner: jeferson
planner: Codex
risk: medium
issue: null
---

# NA-0052 — Recursos de desenvolvimento

## Contexto e situação anterior

Workspace Linux, Node 24.21.0, Prisma 6.19.3, Vite 7.3.7, MySQL 8.4.12.
Base local conhecida e limpa; NA-0050/51 e master remota continuam pendentes
de autenticação GitHub. Nenhuma alegação de sincronização com origin/master.

## Problema e objetivo

Banco local com 25,7 MiB de dados/índices usa perfil de 4 GiB/500 conexões.
Dimensionar desenvolvimento e medir efeitos antes/depois, preservando produção.
Investigar download inicial e warmup sem mudanças especulativas.

## Escopo

Perfil MySQL apenas docker-compose.yml de desenvolvimento; defaults de pool
no launcher local Prisma; benchmark opt-in sem dados sensíveis; documentação
e testes. Ajustes de carregamento somente com evidência e regressão em browser.
Fora: produção, guacd, versões, credenciais, autenticação, ACL, transporte,
refatoração ampla, índices sem EXPLAIN ou evidência de gargalo.

## Critérios de aceitação

- Perfil MySQL local menor, persistência e parâmetros de durabilidade mantidos.
- Defaults de pool por processo, configuráveis, preservando URL explícita.
- Erros de configuração não expõem credenciais; produção não recebe defaults.
- Backup antes de reiniciar MySQL; banco e serviços locais voltam saudáveis.
- Medir RAM, pool e concorrência antes/depois; registrar limites da medição.
- Frontend: avaliar preload real e manter apenas alterações validadas em browser.
- Testes de scripts, regressão aplicável, build e revisão independente.

## Estratégia técnica

Sobrescrever parâmetros MySQL por argumentos apenas no compose de dev.
Inserir parâmetros ausentes na DATABASE_URL em memória no launcher local.
Não persistir .env. Benchmark somente SELECT com dois clientes Prisma e
concorrência 20/50. Não representa carga completa de negócio.

## Riscos e mitigações

Pool menor pode aumentar espera: medir p50/p95/erros, permitir override.
Reinício local breve comunicado ao usuário; dump prévio e reversão de parâmetros.
Chunks podem afetar inicialização: browser real e terminal caso alterados.

## Matriz de testes e evidências

| Área | Validação |
|---|---|
| Launcher | node --test apps/backend/scripts/dev-runtime.test.mjs |
| Banco | backup, config efetiva, SELECT concorrente, health e migrations |
| Frontend | build antes/depois, browser conforme alteração |
| Escopo | diff e revisão independente |

## Baseline

SHA 164bbb489a29952c3b23c6c51fc33e8928720d6f. Build frontend aprovado em 50,91s.
MySQL RAM 929,6 MiB (snapshot), pool 4 GiB, limite 500; 18 conexões observadas.
Bundle pré-carrega vendor-terminal: 412,81 kB / 105,15 kB gzip.
Logs privados: /home/jeferson/nodeaccess-workspace/reports/NA-0052/.

## Rollback ou recuperação

Reverter commit e recriar somente mysql com compose; reiniciar npm run dev.
Mesma versão e volume, sem migração de schema. Dump adicional protegido antes
de aplicar; não restaurar sobre dados novos sem necessidade e confirmação.

## Mudanças de escopo e decisões

IN_PLAN: perfil local, pool, medição e mudanças justificadas no carregamento.
Consultas observadas até agora são principalmente backup/health; nenhum índice
ou alteração de query de negócio justificado. Rotas já usam lazy import.

## Aprovação

- Decisão: GO_WITH_RISKS
- Aprovado por: usuário, "pode implementar fim a fim com os testes e etc".
- Riscos: reinício local e medição sintética não equivalem à carga de produção.


## Evidências e decisões finais

- Ran: 21 testes do launcher (URL, precedência, limites, falhas e sockets),
  11 de warmup e cinco de governança: 37 aprovados. Preferências/viewer: 14.
- Ran: typecheck e build frontend. O warning existente de vendor-ui >950 kB
  permanece; não se aumentou o limite para ocultá-lo.
- Ran: formulário de login em Chromium isolado, sem erros: JavaScript pedido
  2.370.034 → 1.923.291 bytes; gzip calculado por arquivo 685.776 → 569.093
  bytes (17% menos). Isso mede payload, não tempo de rede ou TTI.
- Ran: terminal completo em Vite dev após mudança final; smoke explícito do
  build verifica renderer, CSS, destaque, preferências e mouse. O teste completo
  importa /src/services/api.ts em um cenário de recuperação, por isso não roda
  integralmente contra dist. Smoke não substitui a suíte completa.
- Ran: banco local saudável, 146 migrations atualizadas. Memória observada
  929,6 MiB antes; 476,5 MiB após aquecimento; 481,9 MiB após cerca de 24 horas.
  Não é teste de soak automatizado nem garantia de RAM constante.
- Ran: 2.800 SELECTs antes e 2.800 depois, concorrência 20/50, dois clientes,
  sem erros. Faixas p95: 20 workers, 21,59–45,11 → 14,59–19,23 ms;
  50 workers, 35,59–52,77 → 26,44–47,57 ms. Resultados sintéticos sujeitos a
  cache/ruído e mudanças simultâneas; não atribuir ganho causal de latência.
- Backup protegido em backups/NA-0052-pre-resources; dump, gzip e checksums
  verificados antes da aplicação. Mesma versão/volume; durabilidade preservada.
  Redis e guacd mantiveram os mesmos IDs. Configuração de produção não mudou.
- Corrigido operacionalmente o dev antigo executado como root/Node 20;
  API, gateway e frontend reiniciados como jeferson/Node 24.21.0.
- Manual: capítulo terminal conferido, nenhum procedimento mudou; sourceFiles
  do manifesto não foram alterados e manual:check-reviewed passou nos cinco.
- Skipped: ensaio PTY real porque transporte/resize/SSH não foram alterados.
- Manual: homologação do usuário e publicação GitHub permanecem pendentes.

IN_PLAN: separar estado de preferências do renderer e mover CSS xterm para seu
adaptador. Reexports preservam mesma instância, setters e consumidores existentes.
NECESSARY_CORRECTION: acrescentar teste explícito para o build sem retirar
cenários ou asserts da suíte completa no dev. Harness de entrada versionado
impede regressão do preload, sem criar endpoint ou instrumentação na aplicação.
O warmup atual e as queries permanecem intactos por ausência de evidência para
uma mudança adicional. Nenhuma dependência foi adicionada.

Checks sobre SHA final serão gravados no diretório externo de relatórios para
evitar um commit de log invalidar a evidência do commit testado.


## Falha preexistente encontrada na regressão ampliada

Ran / FAIL: `test:sharing-flows:web` para no assert "Successful JIT terminal
triggered login". Reproduzido no dist baseline 164bbb4 (preview 5194), no dist
candidato (5192) e no dev (5173). Portanto não surgiu nesta otimização.
Logs: sharing-before.log, sharing-build.log, sharing-dev.log.
Causa provável: mount de useTerminal carrega destaques por endpoint autenticado
em contexto JIT anônimo; o 401 aciona login. Requer investigação/correção em
branch própria de JIT, com regressão de autorização e isolamento. Não alterar
esses controles nesta frente de performance nem tornar o teste permissivo.
Essa falha impede declarar todos os fluxos homologados ou uma release pronta.

O smoke do build é deliberadamente parcial; a suíte completa de terminal passou
no dev, e testes unitários do viewer passaram. Homologação completa de acesso
compartilhado permanece pendente do item acima. Publicação externa não ocorreu.
