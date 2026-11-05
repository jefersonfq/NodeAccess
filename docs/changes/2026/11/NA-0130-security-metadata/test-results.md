# NA-0130 — Validação

Base: 8dae9b49a8dab89b9c0a7c4fcb4a29a1d401662d. Execução em /tmp/nodeaccess-NA-0130; não no checkout canônico.

- Ran: 137 testes Node de tools/sonarqube/*.test.mjs PASS, incluindo legacy key, novo issueId, conflito e CLI real com persistência de descoberta. Log privado /tmp/NA0130-all-tests.log.
- Ran: ESLint dos cinco arquivos alterados e helper novo, zero erros/warnings; git diff --check PASS.
- Ran: Chromium real no Vite loopback isolado: 44 labels e 10 controles nativos, nomes acessíveis, foco e ausência de overflow mobile PASS. /tmp/NA0130-dom.log; artefatos privados /tmp/NA0130-dom. Primeira execução com página completa excedeu prazo de navegação; repetição usou HTML mínimo de fixture, sem mudar timeout ou produto.
- Ran: comparação de 14 JSONs contra base: 1280 ocorrências de IDs, ordem, demais propriedades e pares arquivo/hash preservados (migration.json).
- Ran: scanner local real com as mesmas imagens/configuração fixadas: Gitleaks 47 matches, 47 fixtures exatas reconhecidas, zero pendentes; Semgrep 860 alvos, zero achados/erros (security-summary.json). Antes da migração havia 1268 matches; 1221 metadados públicos deixaram de parecer credenciais. Sete isoladas revisadas em fixture-review.json; 40 reconhecidas anteriormente preservadas.
- Ran: revisão independente PASS_WITH_WARNINGS, 24 contratos reproduzidos e 12 documentos de IDs conferidos contra base (/tmp/NA0130-independent.log). Planned: gates integrados da PR. Alterações posteriores nos workflows invalidam seus hashes exatos; revisar diff e atualizar somente as três fixtures correspondentes antes do scan integrado.

## Compatibilidade e limites

JSON público usa issueId para identificar achados Sonar. APIs internas/raw continuam key; leitores das disposições e descobertas aceitam ambos, rejeitando conflito. CSV/HTML e IDs SQ permanecem iguais; schemaVersion 1 conservado, com mudança documentada no nome do campo público. Consumidores externos não versionados que leem diretamente JSON.key precisam adotar issueId. Evidências de hashes usam arrays file/sha256, preservando todos os pares. Nenhuma credencial real foi aceita como fixture nem regra/exclusão global adicionada. Os controles DOM são fixtures derivadas dos componentes, não uma sessão autenticada de produto. Não houve alteração funcional ou visual do produto.
