---
change_id: NA-0088
title: Isolar artefatos e corrigir achados Sonar de ferramentas
type: fix
status: in-development
created_at: 2026-11-03T14:10:00-03:00
base_branch: main
base_sha: 3aa5513789d63ef24b3e268c5f2077fde7db616e
branch: fix/NA-0088-20261103-sonar-tooling
owner: codex
planner: codex
risk: medium
issue: null
---

# NA-0088 — Revisão e remediação dos achados de tooling

Estado: in-development / LOCAL_WIP. Base 3aa551378, branch fix/NA-0088-20261103-sonar-tooling. Pedido de 03/11/2026 autoriza tratar todos os achados, commits locais em branches recuperáveis, testes e revisão independente.

## Escopo

Revisar individualmente 270 achados atribuídos de tools/scripts. Corrigir comportamento inseguro ou incorreto; manter contexto intencional com justificativa por ocorrência. Não reduzir regras/thresholds nem excluir código para elevar score. tools/sonarqube é propriedade do agente principal; registrar sua ocorrência sem editar. Não alterar apps, pacotes ou execução normal do produto.

## Critérios de aceitação

- [x] Cada key recebe decisão sanitizada, justificativa e evidência verificável.
- Esperas têm prazo e diagnóstico sem enfraquecer assertivas; operações temporárias não seguem symlinks/preexistências de terceiros.
- Mudanças pequenas por lote/commit (até 5 correções lógicas); testes de erro e sucesso nas abstrações compartilhadas.
- Sintaxe, suites e harnesses relevantes registrados; limitações explícitas, sem declarar testes não executados.
- Independência: root revisa diff e executa reanálise Sonar integrada; nenhum achado marcado no servidor por este agente.

## Riscos e mitigações

Scripts/harnesses podem ter contratos de saída usados por outros harnesses. Preservar nomes e documentar mudanças em diretório de artefatos; testar encadeamento. Caminhos dentro de containers e fixtures remotas não são caminhos temporários host; não substituir automaticamente. Commits locais por lote permitem revert sem tocar produção; volumes/dados fora do escopo.

## Matriz de testes e evidências

Node:test para utilidades com falhas, symlinks e permissões; suites já existentes de scripts afetados, simulações de wait/deadline e smoke dos harnesses locais. Testes Docker/browser opt-in apenas com recursos descartáveis próprios. Registros em implementation.md e dispositions.json; prints quando fluxo visual for executado, não imagens artificiais de resultados.

## Contexto e situação anterior

Baseline Sonar atribuiu 270 ocorrências a scripts/harnesses, incluindo arquivos temporários previsíveis, regex ambíguos e esperas sem deadline.

## Problema e objetivo

Corrigir riscos reais e manter decisões contextuais verificáveis por ocorrência, sem ocultar regras ou enfraquecer assertivas.

## Estratégia técnica

Raiz de artefatos por UID/worktree, guards de destino live, parsers lineares e testes negativos dos contratos. Preservar interfaces e overrides explícitos.

## Baseline

Base SHA 3aa551378; inventário de 270 ocorrências em assigned.json privado. Nenhum estado Sonar alterado pelo agente.

## Rollback ou recuperação

Reverter commits locais por lote; sem migrações, deploy ou dados de produção. Diretórios antigos de artefatos não são removidos automaticamente.

## Mudanças de escopo e decisões

Consumidores manual-pilot incluídos para manter upload de evidências. Root autorizou; implementação e detalhes dos testes no registro adjacente.

## Aprovação

Decisão: GO_WITH_RISKS. Usuário autorizou remediação de todos os achados e commits locais em branches separadas. Não equivale a homologação humana/publicação. Revisão independente e Sonar integrado permanecem com o agente principal.
