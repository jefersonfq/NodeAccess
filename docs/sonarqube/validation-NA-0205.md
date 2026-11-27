# NA-0205 — Validação integrada no projeto principal

Atualizado 2026-11-26T11:57:52-03:00. **Testes, cobertura e Quality Gate PASS; validação formal BLOCKED** por `REVIEW_CHECKOUT_CHANGED`, com alterações locais ainda sem commit. Não equivale a publicação nem aprovação formal.

Base/HEAD `0ff5c1f9a8cf87c2b4715728ef7d91f96c37cf6e`; checkout `/home/jeferson/projects/NodeAccess-current` com NA0204 preservada e NA0205 integrada por autorização explícita. Análise `caed3438-66a5-4f54-8c6d-518be4fbaae9`. Evidência privada `.sonar-reports/validation-1795703095302-6e46e631-b6a0-4922-8453-72a9c23d3233/validation.json`.

| Critério | Resultado atual |
|---|---|
| Tooling | 254PASS/0FAIL/1skip |
| Vitest | 5070PASS/0FAIL/200pending |
| Node | 1037PASS/0FAIL/12skip |
| Browser | 17/17PASS; inclui61checks extensão e reinício real com targetclose |
| Cobertura diff local | 91,2386707%,186/201linhas+116/130condições |
| Cobertura nova remota | 84,3%;mínimo80%;PREVIOUS_VERSION03/11/2026 |
| Duplicação remota | 0,82149%;máximo3% |
| Novas violações/hotspots | 0/0 |
| Exit tooling/coverage/scanner | 0/0/0 |
| Validação formal | exit1 somente REVIEWED_FINDINGS_NOT_VERIFIED; REVIEW_CHECKOUT_CHANGED |

Baseline Sonar e limites preservados; nenhum achado novo exige aceite. Segurança canônica43/43fixtures e Semgrep0achados/0erros1009targets,snapshotestável/cleanup; `.tmp/NA-0205/integration/security/evidence.json`. Registro das falhas anteriores abaixo permanece histórico, não descreve o resultado atual. A revisão formal exige nova validação após commit explicitamente autorizado; não criar commit automaticamente.

## Histórico anterior no worktree

# NA-0205 — Validação Sonar

Atualizado 2026-11-26T10:39:38-03:00. Base/HEAD `0ff5c1f9a8cf87c2b4715728ef7d91f96c37cf6e`, alterações locais no worktree `/home/jeferson/na-0205`. **Validação FAIL; não pronta para publicação.**

| Execução | Resultado |
|---|---|
| Primeira completa, análise aee19fc6-aebd-4b48-aba0-cc42a45f4ef5 | Browser interrompido no teste de atualização; cobertura remota76,4%<80;0novasviolações |
| Segunda completa, análise40d14bd4-6b4f-4d7a-960a-8e284f81faae | Vitest2FAIL e browser interrompido no catálogo; cobertura remota71,8%<80;0novasviolações;duplicação0,82907% |
| Revisões formais | REVIEW_CHECKOUT_CHANGED; não verificadas; não contornado |
| Hotspots | 0 a revisar na última execução |

Última evidência privada: `.sonar-reports/validation-1795698902684-a6a1cbf5-22b0-442d-920f-0133f5716402/validation.json`. Período remoto PREVIOUS_VERSION desde03/11/2026; não comparar diretamente com cobertura do diff local. Tooling254PASS/1skip,Vitest5046PASS/2FAIL/199pending,Node1037PASS/12skip. Preflights anteriores falharam em caches symlink e caminho Chromium longo; root curto corrigiu ambiente sem relaxar guardas.

Falha de atualização demonstrou modo de desenvolvedor desligado no perfil temporário: Chromium desabilitava extensão não empacotada após runtime.reload. Harness corrigido exclusivamente no perfil descartável, por UI;61checksPASS exigindo worker novo e popup funcional. Segunda execução não chegou a esse ensaio por parada anterior no catálogo.

Administração registrou ERR_NETWORK_CHANGED; dois timeouts do catálogo têm causa não confirmada. Repetições isoladas: catálogo14PASS com CDP,administração14cenáriosPASS/8propostas8aplicadas, fontes estáveis/cleanup. Não aprovam o full nem demonstram a causa das falhas sob carga. Nenhuma regra, baseline, threshold ou exclusão foi alterada. Nenhum novo achado para justificar individualmente.

Segurança final43/43fixtures e Semgrep0achados/0erros1009targets, snapshotestável/cleanup, `.tmp/NA-0205/update-security-final/evidence.json`. Revisão independente da UI e do harness semP1/P2, com limites de execução registrados.

Próximo passo: localizar causa dos timeouts do portal na execução consolidada e repetir a validação completa. Commit apenas mediante autorização; checkout limpo não resolve as falhas de testes por si só. [Registro da implementação](../changes/2026/11/NA-0205-extension-popup-ux/implementation.md).
