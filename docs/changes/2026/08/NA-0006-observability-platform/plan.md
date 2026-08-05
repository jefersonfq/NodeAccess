---
change_id: NA-0006
title: Simplificar a observabilidade e reposicioná-la em Plataforma
type: feature
status: tests-passed
created_at: 2026-08-05T18:11:27-03:00
branch: feature/NA-0006-20260805-observability-platform
risk: medium
decision: GO
---

# NA-0006 — Observabilidade em Plataforma

## Contexto e situação anterior

A tela exibe todas as métricas com peso visual semelhante, quatro cards grandes e tabelas técnicas sempre abertas. A navegação está em Administração, embora represente a saúde da plataforma.

## Objetivo

Facilitar a leitura da saúde atual, destacar somente o que exige atenção e manter detalhes técnicos acessíveis sob demanda. Posicionar a entrada no grupo Plataforma sem quebrar a URL existente.

## Escopo

- Reorganizar hierarquia, densidade e microcopy da tela.
- Resumir CPU, memória, disco, componentes e backups.
- Expor detalhes em tooltips e regiões expansíveis acessíveis.
- Preservar loading, erro, alertas e dados vazios.
- Mover o item lateral para Plataforma, mantendo rota e contrato da API.
- Atualizar o harness visual para validar a nova estrutura e a navegação.

## Fora do escopo

- Alterar coleta, cache, thresholds ou API de observabilidade.
- Alterar permissões da rota existente.
- Criar novos gráficos ou dependências.

## Critérios de aceitação

- [x] O estado geral e recursos essenciais ficam identificáveis sem abrir detalhes.
- [x] Detalhes de host, limites, discos e containers ficam acessíveis por tooltip ou expansão.
- [x] Alertas ativos permanecem visíveis e acionáveis.
- [x] Loading, erro e ausência de métricas não quebram o layout.
- [x] A tela permanece utilizável em 360 px e 1366 px.
- [x] Observabilidade aparece em Plataforma e deixa de aparecer em Administração.
- [x] A URL `/admin/observability` e a API existente continuam funcionais.
- [x] Typecheck, build e harness de observabilidade passam no SHA candidato.

## Resultado

- Harness: 6 cenários funcionais, perfil admin comum e admin de plataforma, sem findings, erros de console ou overflow.
- Validação visual: desktop 1440 px e mobile 360 px.
- Build e typecheck: aprovados.
- Artefatos locais: `/tmp/nodeaccess-observability-na0006.json` e `/tmp/nodeaccess-observability-na0006-shots/`.

## Riscos e mitigações

- Detalhe ficar oculto demais: manter resumos visíveis, contagens e expansões com rótulos claros.
- Perda de acesso para administradores não-plataforma: preservar rota e permissão; a mudança é somente de organização do menu.
- Regressão mobile: validar via harness em viewport representativo.

## Testes e evidências

- Typecheck e build do frontend.
- Harness CDP: saudável, degradado, histórico vazio, disco vazio, erro de API e mobile.
- Asserção do agrupamento no menu lateral.
- Capturas desktop e mobile produzidas pelo harness.

## Rollback

Reverter os arquivos da view, layout, harness e este plano. Nenhum dado ou schema é alterado.
