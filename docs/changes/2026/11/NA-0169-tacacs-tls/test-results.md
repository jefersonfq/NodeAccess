# NA-0169 — Validações

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
