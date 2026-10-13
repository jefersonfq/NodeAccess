---
change_id: NA-0056
title: CSP aplicada e execução Compose sem root com migração explícita
type: security
status: ready-for-tests
created_at: 2026-10-12T22:03:25-03:00
base_branch: master
base_sha: 8eeef08b520a4ffde58cb0733b1e55ff7b247ef7
branch: security/NA-0056-20261011-csp-nonroot
owner: jefersonfq
planner: codex
risk: medium
---
# NA-0056 — CSP e runtime sem root

## Contexto e situação anterior
Perfis Nginx de produção apenas relatam CSP, permitindo scripts inline/eval; Compose API/gateway executa como root apesar de já remover capabilities.

## Problema e objetivo
Aplicar CSP verificável e disponibilizar migração explícita/reversível do runtime sem root, preservando instalações existentes.

## Escopo
- Extrair registro/limpeza do service worker inline, sem mudar fluxo.
- CSP enforced nos quatro perfis Nginx, com testes de bloqueio e compatibilidade no build real.
- Override Compose API/gateway UID/GID1000 e preparação/restauração de permissões delimitadas, com documentação e testes isolados.
- Fora: guacd, produção, autenticação/autorizações, dependências novas e troca automática das instalações existentes.

## Critérios de aceitação
- [x] Headers CSP enforced nas respostas SPA/assets/erros; scripts inline/eval bloqueados.
- [x] Build real, terminal/Monaco e estados principais carregam sob CSP sem violações inesperadas.
- [x] API/gateway UID1000 exercitados em ambiente descartável; leitura/escrita dos volumes e host key verificadas.
- [x] Migração de permissões exige comando explícito e guarda inventário para rollback; rejeita symlinks e destinos inesperados.
- [x] Perfil Compose antigo continua disponível; produção não é alterada; riscos e adoção documentados.

## Estratégia técnica
Manter estilos inline necessários à biblioteca de UI; remover somente inline/eval de scripts após extrair bootstrap. Reutilizar volumes, UID1000 do Helm e imagens existentes nos ensaios.

## Riscos e mitigações
Migração nonroot será opt-in: arquivo de override exige preparação dos volumes/host keys. Não inferir conclusão da adoção operacional a partir dos testes.

## Matriz de testes e evidências
| Critério | Teste | Evidência |
|---|---|---|
| CSP quatro perfis | Respostas reais Nginx + navegador bloqueio inline/eval | reports/NA-0056 |
| Compatibilidade frontend | Build, terminal-experience e smoke build | reports/NA-0056 |
| Permissões | Testes positivos/negativos + volume Docker real | reports/NA-0056 |
| Nonroot | Runtime descartável UID1000, health/armazenamento | reports/NA-0056 |
| Regressões | Gates existentes no SHA candidato | CI/PR |

## Baseline
Base8eeef08 integrada com CI aprovado NA0054. Revisão estática confirmou script inlineSW, CSPReportOnly em quatro perfis e ausência de USER backend; Helm já adota UID1000. Worktree isolado por concorrência autorizada com NA0055; current preservada.

## Rollback ou recuperação
Reverter por PR. CSP antiga recuperável pelo checkpoint/base. Remover override somente após parar API/gateway e restaurar inventário das permissões; banco/schema e conteúdo de arquivos não mudam. Inventário não substitui backup e não deve ser publicado.

## Aprovação
Decisão: GO_WITH_RISKS. Usuário autorizou fechar pendências autônomas fim a fim nesta sessão; migração explícita acordada com orquestrador. Validação independente e homologação operacional não presumidas.

## Evidências locais e limites
- Build frontend Vite7.3.7 e lint dos arquivos alterados aprovados; bootstrap incorporado ao asset com hash.
- 15 testes de permissões/empacotamento aprovados; volume Docker real confirma UID1000, leitura de host key, preservação de hashes e rollback inclusive de arquivos novos.
- 24 respostas reais Nginx, carve-out estrito do proxy, navegador bloqueando inline/eval e Monaco com worker JavaScript/edição aprovados.
- Build smoke final de terminal sob CSP aprovado. Harness full sob CSP+Vite aprovado antes da mudança somente de empacotamento do bootstrap; smoke final cobre o bootstrap entregue.
- Stack real: API/gateway UID1000, login/MFA, isolamento, refresh/logout, SSH/PTY/SFTP, Redis e SIGTERM aprovados. As imagens desse ensaio antecedem apenas o reempacotamento do bootstrap; CI reconstruirá a árvore final.
- Evidências privadas: reports/NA-0056. São evidências do worktree, não aprovação de SHA ainda não commitado. Revisão independente/CI no candidato continuam pendentes.
- Exceção CSP específica preserva os documentos do proxy remoto; isolamento em outra origem permanece pendência. CDN Monaco está limitado ao caminho versionado existente, sem dependência nova. Estilos inline necessários à biblioteca permanecem.
- FUT003 permanece parcialmente tratado: adoção operacional do override e homologação dos volumes reais são explícitas, não foram executadas.

Registro formalizado no horário created_at; esse horário não representa a hora original do pedido. Histórico anterior resumido no diário, sem atribuir horário exato ao usuário.

Navegador Chromium confirmou WS e WSS reais de mesma origem através do Nginx com CSP aplicada. Firefox/WebKit e worker JSON não foram testados.
