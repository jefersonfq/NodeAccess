# NA-0204 — Registro da implementação

## Pedido e objetivo

Identificar gestores do cofre em `/admin/users`, com filtro e explicação, sem alterar nomeação ou permissões. Usuário aprovou a implementação da proposta.

## Estado e implementação

**LOCAL_WIP**, código implementado e validado localmente; sem commit, push ou publicação desta frente. Base `0ff5c1f9a8cf87c2b4715728ef7d91f96c37cf6e`; branch `feature/NA-0204-20261125-users-vault-managers`.

GET /users usa contrato de listagem com `isVaultManager` somente leitura. Consulta em lote considera nomeação enabled, usuário ativo/não excluído e igualdade de tenant. Filtro e total são calculados antes da paginação na mesma transação. Guard administrativo, auth, escritas, status do cofre e dupla aprovação preservados.

A tela mostra selo independente de ADMIN, filtro combinado com busca e ajuda recolhida PT/EN. O indicador não libera segredos ou ações de gestão. Respostas de leituras antigas são descartadas por identidade e geração de contexto, inclusive A→B→A. Sem migração, dependência ou polling novo. Correção necessária de lint no controller limitada a tipos de retorno e multipart, com teste HTTP real do upload.

## Validação executada

| Verificação | Resultado e evidência |
|---|---|
| Backend focal | 51 PASS, tipos e lint PASS; `.tmp/NA-0204/backend-correction-*.log` |
| Frontend focal | 16 PASS, tipos/lint da tela e testes PASS; `.tmp/na0204-context-*.log`. Serviço conserva 16 avisos de retorno comprovadamente preexistentes, zero erros. |
| MySQL real | 75 PASS/0 FAIL/0 skip, fontes estáveis e cleanup; `.tmp/NA-0203/mysql-1795647065-fc35b4/execution.json` (runner conserva identificação histórica NA-0203). |
| Playwright administração | 16 cenários, 27 capturas, 8 propostas/8 aplicadas; fontes estáveis, cleanup; `.tmp/NA-0188/administration-nlH3Xl/execution.json`. PT desktop e EN390 revisados visualmente. API administrativa usa fixtures no browser; SQL/guards têm provas separadas. |
| Manual/build | 5 capturas revistas, 60 geometrias, 2 ciclos de tenant sem reconexão; testes 3 Node + 18 Vitest; 5 capítulos atuais; build estrito e scan de 158 JS PASS. `.tmp/NA-0204/manual/`. |
| Coleta consolidada | 5068 Vitest PASS/0 FAIL/200 pending; 1037 Node PASS/0 FAIL/12 skip; 17 harnesses browser PASS/sem timeout. Skips explícitos não equivalem a homologação. |
| Cobertura | Nova local 95,145631% (111/117 linhas + 85/89 condições), mínimo80%; thresholds legados PASS. `coverage/summary.json`, base Git acima, working tree incluído. |
| Sonar | Gate OK, cobertura nova remota84,3%, zero novos achados/hotspots. **validate:sonar exit1 / BLOCKED** somente `REVIEWED_FINDINGS_NOT_VERIFIED`, causa `REVIEW_CHECKOUT_CHANGED`. [Evidência](../../../../sonarqube/validation-NA-0204.md). |
| Segurança | Novo scan PASS: Gitleaks43/43 revisados, zero pendências; Semgrep zero achados/erros em1009targets; fingerprint estável, cleanup. `.tmp/NA-0204/security-final-reviewed/evidence.json`. |
| Revisão independente | Anscombe: PASS_WITH_WARNINGS para código, P2 de resposta tardia fechado, sem P1/P2 aberto. Revisão não substitui execução própria nem validação formal do checkout limpo. |

## Falhas preservadas e correções

Baseline frontend9/backend36 e browser14 passaram. Teste A→B→A reproduziu estado antigo antes da geração de contexto; 16 testes finais passaram. Duas tentativas browser falharam em expectativas do harness (nome acessível do checkbox; POST de status somente leitura contado como mutação), corrigidas sem relaxar guard ou prazo. Outra execução recebeu SIGTERM143 após7cenários: causa não comprovada, inconclusiva, recursos próprios limpos. Rodada final completa passou. Captura manual inicial sem caminho Chromium falhou; uso do Chromium já instalado resolveu, sem alterar asserções.

Scan inicial falhou por três hashes de arquivos alterados fora dos trechos de fixtures. Anscombe comparou individualmente os placeholders PEM de locales e referências de variáveis no harness SQL contra HEAD: conteúdo inalterado. Atualizados somente três `fileSha256`, preservando regra/linha/motivo e outras entradas; matching histórico43/43 e novo scan completo passaram. Baseline Gitleaks final `bb53d79a521f5f7cd0e3e05a08a68bfbf700dc2fce5cdcd56de74862f5592b5e`; baseline Sonar intocada, sem exclusões ou redução de thresholds.

## Pendências, limites e recuperação

Validação formal de revisões exige checkout limpo: commit desta frente não foi autorizado, portanto não contornar o guard. Após autorização específica de commit, validar novamente o SHA limpo. Homologação humana e publicação continuam separadas. Roadmap: escrita única da META-005 e Revisões48 concluída e validada; demais IDs, Original2027, revisões1–47 e partes ZIP preservados. SHA final `18ee662f6d4e8b1feaf2d57bd9b358cdc2d89933f5b6f670a6c25c5353c182a1`; backup em `.tmp/NA-0204/roadmap/roadmap-before.xlsx`.

Rollback sem migração: retirar indicador/filtro/contrato de listagem sem alterar nomeações existentes. Preservar commit anterior NA-0203. Credenciais e relatórios brutos privados permanecem fora do Git.

## Diário consolidado

### 2026-11-25T20:36:40-03:00 — Implementação e validação local

Pedido aprovado executado no escopo de leitura/UI. Correções necessárias: tipagem multipart/controller, registro do SQL no runner existente, proteção de respostas tardias e fixtures de teste. Todos os testes aplicáveis, browser/manual/build e novo scan de segurança passaram. Gate Sonar OK; validação formal bloqueada pelo checkout com alterações. Próximo passo: autorização específica de commit e validação do SHA limpo, sem alegação de homologação ou publicação.

### 2026-11-26T08:58:21-03:00 — Conferência final após pedido de continuidade

Conferido diff sem erros de whitespace. Cache de compilação Node gerado durante o build em apps/frontend/.tmp/NA0204 foi preservado em .tmp/NA-0204/manual/frontend-node-compile-cache-preserved, fora dos arquivos de entrega; nenhum código alterado. Roadmap validado e evidências finais registradas. Estado continua LOCAL_WIP, validação formal Sonar bloqueada por checkout sem commit; sem nova autorização de commit/publicação.
