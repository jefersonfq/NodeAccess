---
change_id: NA-0116
title: Aplicar configuração efetiva igual nas análises Sonar
type: fix
status: in_progress
created_at: 2026-11-03T17:11:23-03:00
base_branch: chore/NA-0093-20261103-sonar-final-validation
base_sha: 47f06b51e693d91f5ed724b7b86e5362af75bc35
branch: fix/NA-0116-20261103-sonar-base-config
owner: Codex
planner: Codex
risk: medium
issue: null
---

# NA-0116 — Configuração efetiva Sonar base e candidato

## Contexto e situação anterior

Ensaio real mostrou @sonar/scan5.0.2 ignorando project.settings na leitura do arquivo. Base antiga sem sonar-project.properties usou defaults, incluindo C# e testes como fontes.

## Problema e objetivo

Materializar configuração candidata no worktree base privado e provar os parâmetros efetivos usados pelo scanner nas duas análises.

## Escopo

- tools/sonarqube/ci-run.mjs, helper de configuração, testes e documentação desta frente.
- Fora: refatoração do produto, exclusões de cobertura, conexão à VPS, PTY real ou instalação.

## Critérios de aceitação

- [x] Base sem arquivo e com arquivo diferente recebem a mesma configuração candidata.
- [x] Arquivo e contexto efetivo divergentes reprovam; limiares/baseline não são reduzidos.
- [x] Testes e cobertura observada registrados sem inferir homologação real.

## Estratégia técnica

Copiar bytes do arquivo candidato para sonar-project.properties da base privada, comparar SHA256 e contexto scanner efetivo. Falhar em divergência, sem expor credenciais.

## Riscos e mitigações

| Risco | Impacto | Mitigação | Parada |
|---|---|---|---|
| Scanner ignora arquivo | Comparação inválida | Hash e contexto CE efetivo | Ausência/mismatch do contexto |
| Contexto contém segredo | Vazamento | Comparar allowlist em memória e exportar só campos seguros | Rawcontext persistido |

## Matriz de testes e evidências

| Critério | Teste | Ambiente | Evidência | Obrigatório |
|---|---|---|---|---|
| Configuração ausente/diferente e falhas fechadas | Node.test ci-* | Worktree isolado | test-results.md | Sim |
| Configuração efetiva e gate de cobertura | Três análises Sonar reais em fixture | Worktree isolado | test-results.md | Sim |

## Baseline

SHA `47f06b51e693d91f5ed724b7b86e5362af75bc35`; ensaio da coordenação comprovou defaults indevidos na base sem arquivo. Preservar critérios existentes e distinguir fixture de análise do produto completo.

## Rollback ou recuperação

Reverter commit desta frente. Nenhum schema/runtime de produção alterado.

## Mudanças de escopo e decisões

Coordenação atribuiu esta frente após o ensaio CI completo demonstrar configuração efetiva diferente na base antiga.

## Aprovação

- Decisão: GO_WITH_RISKS
- Aprovado por: usuário (tratamento das pendências) e coordenação (configuração Sonar CI)
- Aprovado em: 2026-11-03

## Evidência primária

@sonar/scan5.0.2 instalado: src/properties.js getSonarFileProperties lê join(projectBaseDir, sonar-project.properties), linhas183/427. Documentação oficial https://docs.sonarsource.com/sonarqube-server/10.7/analyzing-source-code/scanners/npm/configuring. Ensaio privado da integração identificou ausência de sonar.tests; configurações TS extends são locais e nenhuma falha de resolução foi observada, portanto não compartilhar node_modules HEAD com base sem evidência de necessidade.
