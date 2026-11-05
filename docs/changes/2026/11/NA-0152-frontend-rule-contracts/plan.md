---
change_id: NA-0152
title: Preservar contratos frontend removendo seis violações aplicáveis
type: fix
status: in-development
created_at: 2026-11-04T11:15:00-03:00
base_branch: chore/NA-0154-20261104-frontend-legacy-lint
base_sha: 661b37f323537a788ff610bc487a3d823a79aee9
branch: fix/NA-0152-20261104-frontend-rule-contracts
owner: equipe NodeAccess
planner: Codex
risk: medium
---

# NA-0152 — Contratos frontend e navegação por teclado

## Contexto e situação anterior
Revisão individual de 80 propostas FP com definições instaladas encontrou seis ocorrências aplicáveis: quatro pre estáticos com tabindex (SQ0115–0118), atribuição ao índice do for (SQ0158) e regex não linear em timestamp ISO limitado (SQ0161). Onze trechos removidos ficam pendentes de scanner; 63 propostas técnicas não recebem transição nesta frente.

## Problema e objetivo
Eliminar seis ocorrências preservando conteúdo, comandos, interpretação lexical e formato do identificador. Reduzir paradas de Tab sem ação; não remover rolagem focável legítima ou separadores interativos.

## Escopo
McpAgentSetup.vue: somente quatro tabindex de pre estáticos; terminal-path-autocomplete.service.ts: salto de separadores; HighAvailabilityView.vue: remoção de fração ISO. Testes, evidências e documentos próprios. Sem autenticação, transporte, websocket, área útil do terminal, componentes de outros fluxos, dependências ou gates.

## Critérios de aceitação
- [x] Pre estáticos fora de Tab; Copy/details continuam alcançáveis e funcionais, sem mudança de geometria desktop/mobile.
- [x] Parser preserva separadores simples/duplos, quotes, escapes, Unicode e cursor parcial por testes e diferencial.
- [x] Timestamp preserva UTC/Z, milissegundos removidos e anos estendidos byte a byte.
- [x] Lint/tipos/testes focais e revisão independente; status Sonar somente após análise integrada.

## Estratégia técnica
Para separador duplicado avançar index += 1, depois start = index + 1; não esconder atribuição em expressão composta artificial. Remover fração por operação de string ou quantificador fixo compatível com ISO. Remover somente tabindex dos quatro pre; preservar nome/Copy/details/estilos. Testar SFC real quando viável, sem alterar configuração de instrumentação. Frontend skill modo Implementer + revisão UX mínima. Arquivos não constam no manifest manual; nenhum procedimento mapeado alterado.

## Riscos e mitigações
Salto duplo poderia pular caractere seguinte: baseline e diferencial. Timestamp de ano estendido: teste explícito, evitar slice fixo de comprimento total. Navegação estática: comprovar foco em ações e details por browser; não declarar leitor de tela formal. Nenhuma alteração de resize/área/SSH: PTY real não exigido por este delta, reavaliar se escopo mudar.

## Matriz de testes e evidências
Baseline autocomplete existente; contratos diferenciais de parser e ISO; browser real isolado MCP antes/depois desktop/mobile com teclado e capturas; lint focal, typecheck frontend, revisão independente. Scanner integrado pela raiz, sem análise concorrente. Testes sem dependência de host real.

## Baseline
Base 02e7521cbe69e72cb5c8c3f5f951dcdc6e1c5fec. Produto ainda intacto ao escrever este plano. Resultados de baseline e evidências serão registrados no diário antes da edição.

## Rollback ou recuperação
Reverter checkpoint desta frente; nenhum schema/dado/configuração migrado. Sem push/merge direto.

## Mudanças de escopo e decisões
2026-11-04: raiz autorizou seis correções após reconciliação das definições. Planejamento vivo e reconciliação final da iniciativa sob coordenação da raiz; pendência de sincronização de status na planilha registrada.

## Aprovação
Decisão: GO_WITH_RISKS
Aprovado por: raiz, conforme autorização do usuário para correções e validação fim a fim.
Aprovado em: 2026-11-04.

### Base atualizada após cleanup
2026-11-04: base atual661b37f323537a788ff610bc487a3d823a79aee9; comparação histórica02e7521 preservada nos probes. NA0154 independente elimina57errors568warnings semmisturarfeatures. Oito contratos novos migrados para arquivo próprio, teste legado preservado bytea byte.
