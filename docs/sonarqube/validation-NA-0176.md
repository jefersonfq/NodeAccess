# NA-0176 — Validação da consolidação

Candidato: `afdc9ebc53925ad7b00a4abcc80915e797d6daec`; base: `be4daff2e5a6d2a2ff7603df2ec676ec03f4156a`.

| Verificação local | Resultado |
|---|---|
| validate:sonar, 2026-11-15 20:47:09–21:03:22 UTC | PASS, zero falhas e avisos |
| Quality Gate | OK; nenhuma condição ignorada |
| Revisão de achados | Verificada; zero inesperados; sem alteração de baseline |
| Novas violações / hotspots pendentes | 0 / 0 |
| Cobertura nova Sonar | 81,4%, mínimo80% |
| Cobertura nova no diff local | 92%; recorte distinto do Sonar |
| Vitest / Node | 3782PASS,124pendentes / 701PASS,11skips |
| Browser / TLS | 10/10PASS / PASS e cleanup verificada |

[Evidência sanitizada](../changes/2026/11/NA-0176-base-reconciliation/validation-final.json). Análise `72863b6f-9c7b-414a-9b4d-a44bf03f4f9c`. Relatórios privados permanecem no worktree de validação em `.sonar-reports/validation-1794775629325-ead51899-e5ad-4f7d-8c66-6dfe7ebbf62a`. Revisão independente PASS; nenhum achado novo a dispensar ou threshold reduzido. Diagnóstico não fatal ResizeObserver no browser, sem reprovação dos harnesses; preservado no log.

[PR65](https://github.com/jefersonfq/NodeAccess/pull/65): CI remoto separado e ainda em andamento neste registro. Esta evidência não comprova merge, deploy, limpeza documental do workspace ou homologação humana. Tentativas interrompidas/concorrentes anteriores não são evidência de aprovação.
