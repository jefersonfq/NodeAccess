# NA-0169 — Validações

Estado atual: **gates técnicos aprovados; homologação humana e merge pendentes**. Consulte o resultado técnico final e os arquivos em `evidence/`; seções anteriores preservam o histórico das execuções.

Base: `df8482674781c24a92f3f24d551c4e392297c9f1`. Resultados abaixo pertencem ao WIP; não substituem gates no SHA final.

| Estado | Validação | Resultado e limite |
|---|---|---|
| Ran | Baseline API | 27 testes passaram antes da mudança |
| Ran | API com certificado | 38 testes passaram |
| Ran | TLS, ativação, resiliência e PKI | 79 testes passaram; mTLS real e certificados descartáveis |
| Ran | Cliente Python independente | 15 checks passaram; biblioteca padrão SSL |
| Ran | MySQL e SSH emulado | 26 checks e 7 cenários CLI passaram; migração, isolamento, rotação e auditoria |
| Ran | Redis health | 6 checks passaram em namespace descartável |
| Ran | Soak | 1.356 pedidos, 4 clientes, 31,423 s; baseline/recuperação sem falhas, erros injetados negados |
| Ran | Watchdog final | Readiness 503, saída controlada em 18,864 s, nenhuma confirmação AAA; reinício por supervisor não testado |
| Ran | Chromium TLS | 5 grupos de verificações passaram; desktop, mobile, teclado e erros com API interceptada |
| Ran | Coletor de navegador | 28 contratos passaram; TLS obrigatório e skip silencioso bloqueado |
| Ran | Typecheck/build/lint | Backend/frontend typecheck, build backend e lint estrito dos arquivos alterados passaram |
| Ran | Segurança estática | Semgrep: 0 achados/902 arquivos; Gitleaks: 42 fixtures revistas, 0 pendências |
| Ran | Bateria geral inicial | 3.658 Vitest e 655 Node passaram; 125 e 7 skips, respectivamente |
| Ran | Chromium integrado inicial | Falhou ao carregar SettingsView; reprodução focal passou. Dois Vite compartilhavam cache. Servidor auxiliar encerrado antes de repetir; causa ainda não comprovada |
| Ran | Coleta WIP final | PASS: 3.658 Vitest, 673 Node, nove harnesses Chromium; 125/7 skips documentados; cobertura incremental 85,78199%, acima de80% |
| Ran | Laboratório dentro da coleta | Quatro etapas PASS, 798 pedidos de soak e cleanup confirmado; provas TLS/Python verificadas |
| Planned | Sonar e CI no SHA final | Pendentes até consolidar o candidato e executar os gates finais |
| Manual | Homologação funcional | Não recebida; nenhuma inferência a partir dos testes |
| Skipped | Firmware real/VPS/produção | Sem equipamento físico ou implantação de produção nesta frente |

## Evidência local

Relatórios privados: `/tmp/NA0169-lab/`, `/tmp/NA0169-security-final/`, `/tmp/NA0169-coverage-first/`. Capturas sintéticas legíveis foram preservadas em `docs/changes/2026/11/NA-0169-tacacs-tls/evidence` no projeto principal. A primeira coleta e a falha permanecem registradas; nenhuma asserção, exclusão ou limiar foi relaxado. Não registrar chaves de laboratório ou credenciais nos artifacts públicos.

## Revisão independente

Revisão separada identificou e confirmou a correção de rejeição de CRLs inválidas no startup. Falsos positivos SQ-0165 e SQ-0490 foram revistos individualmente; identidade Sonar final do segundo depende de nova análise. Fixture de teste de redação do Gitleaks revalidada após mudança de linha/hash, sem ampliação de escopo. Aprovação de entrega ainda pendente.


## Resultado WIP final

Fingerprint de fontes: `3e2244f782b13e886da81b1a2dee3ef0bb8155e47020d9ab3b2a605eedb31ab7`. Coleta com `failures=[]`, inventário completo e limiares legados preservados. Python: cliente89/102linhas e instrumentador81,818% das linhas executáveis, a partir de contagens reais. Lint estrito passou nos28arquivos JS/TS/Vue alterados; Semgrep0/903 e Gitleaks0pendências,42fixtures revistas.

Revisão independente: PASS_WITH_WARNINGS no WIP, conferindo fingerprint, hashes, quatro etapas do laboratório, nove harnesses e cleanup. Os798pedidos pertencem à coleta final;623pedidos pertencem ao focal compilado anterior. Não há homologação humana nem certificação de firmware. Evidência do SHA final e CI será vinculada no PR, evitando commits recursivos apenas para registrar o próprio hash.


## Candidato da PR #60

Validação local do commit referenciado em `evidence/final-verification.json`: PASS após reaplicação autorizada de SQ0490. O scanner inicial retornou falha pelo alerta de IP de teste; esse resultado foi preservado, e a verificação posterior somente leitura confirmou gate OK na mesma análise. Evidência de notas e histórico: `evidence/final-sonar.json`.

| Verificação | Resultado |
|---|---|
| Vitest / Node | 3.658 / 673 aprovados; 125 / 7 skips |
| Chromium | Nove harnesses aprovados |
| Cobertura incremental / Sonar | 85,78199% / 80,7% (períodos diferentes) |
| Laboratório TLS | 802 requisições; live, health, soak, watchdog e cleanup aprovados |
| Sonar | A/A/A; gate OK; zero abertos; 366 FIXED e 206 FALSE_POSITIVE |
| Revisão independente | PASS_WITH_WARNINGS; sem bloqueador de código |
| CI hospedado | Em execução na PR #60 |
| Homologação humana / hardware | Pendente |

Nenhuma implantação de produção realizada. O teste visual usa API interceptada; o protocolo/backend também foram exercitados no laboratório real independente.


## Resultado técnico final — 2026-11-04T23:36:31-03:00

Candidato e análises identificados em `evidence/final-verification.json` e `evidence/ci-tree-proof.json`; PR https://github.com/jefersonfq/NodeAccess/pull/60.

| Verificação | Resultado final |
|---|---|
| Vitest / Node | 3.658 / 675 aprovados;125 / 7 skips |
| Chromium | Nove harnesses; resposta de histórico controlada validada |
| Laboratório TLS | 734 requisições; quatro etapas e cleanup aprovados |
| Cobertura incremental local | 86.1556% |
| Sonar local / hospedado | Gates OK; código novo 80.7% / 86.0% em períodos distintos |
| Issues locais | A/A/A;366 FIXED/206 FALSE_POSITIVE;zero abertas |
| CI | 16 aprovados;1 release ignorada;nenhuma falha atual |
| Homologação humana / hardware | Pendente |

As primeiras duas falhas de CI estão preservadas em `first-ci-failure.json` e `second-ci-failure.json`. Nenhuma aprovação foi inferida dessas execuções. O commit sintético do CI tem árvore idêntica ao HEAD publicado. Sem merge ou deploy.


### 2026-11-05T09:55:49.428540-03:00 — Integração concluída das PRs59/60

Pedido autorizado: homologação e merge; README atualizado com SonarQube e ferramentas realmente presentes. ZAP e StrykerJS documentados como propostas, sem instalação. PR59 merge e1d4995c1869accb685aedd8b602ede5bfd0e289; PR60 merge 745253d1edb522db79aaa44fd96608ce434a2774. Candidato dc3c8fadfa6e4459a0288d880a28d137b0282439 inclui README e correção necessária da revisão SQLite por imagem/distro. O candidato b0ac11ef teve Sonar aprovado mas gate de imagens reprovado; sua evidência foi preservada em evidence/integration-b0ac11ef. Correção validada por50 contratos, lint e replay real; novo CI executado integralmente.

Validações realmente executadas nesta interação: diff/check de links e scripts do README, governança local e hospedada, revisão documental independente PASS, CI hospedado atual (16 checks distintos aprovados; 1 ignorado), Sonar real base/head com gate aprovado e limpeza completa. Evidências sanitizadas em evidence/integration; testes locais da política foram reexecutados após commit; testes de produto executados no novo CI. Revisão independente confirmou prazo e demais identidades preservados, sem aceite do CLI vulnerável. Threads revisadas; merge normal protegido pelo SHA exato, sem bypass.

Master sincronizado com origin/master em /tmp/nodeaccess-master-integration, árvore/candidato verificados. Pasta principal mantém alterações preexistentes; README e registros canônicos atualizados nela. COMMITTED/PUSHED/MERGED/MASTER_SYNCED sim; PR_OPEN não; LOCAL_WIP do código não (documentação canônica local permanece modificada). Sem deploy VPS ou certificação de hardware. Próximo passo opcional: piloto ZAP em ambiente descartável e Stryker por módulo crítico.
