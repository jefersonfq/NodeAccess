# Navegação por seções da Central — NA-0172

## Pedido e causa

O usuário informou homologação da Central e indicou como único ajuste o efeito de transição ao clicar em uma seção. O layout usava `fullPath`, incluindo o fragmento, como identidade do componente. Alterar `#security-audit` recriava a view e acionava a animação de página.

## Correção

Somente a rota `security-center` ignora o fragmento em sua identidade e no indicador de carregamento. Query e todas as demais rotas mantêm o comportamento anterior; a chave fixa do terminal foi preservada. A view observa o hash e rola para uma seção já existente, sem busca de dados, interpretação de HTML ou seletor interpolado.

Arquivos de aplicação: `apps/frontend/src/layouts/AppLayout.vue` e `apps/frontend/src/views/SecurityCenterView.vue`. Contrato SSR ajustado para o contexto de rota e harness ampliado em `tools/frontend/security-center-playwright.cjs`.

## Antes e depois

| Evidência | Antes | Após correção |
|---|---|---|
| Instância/DOM da Central | Substituído no clique | Preservado |
| Transição/barra observada | 21 efeitos no cenário reproduzido | Zero nas 54 verificações |
| Destino da âncora | Correto, mas com transição | Correto, sem recriação da página |
| Histórico e query | Não demonstrados pelo caso inicial | Back/Forward, query preservada e mudança real de query verificados |

[Reprodução](evidence/anchors/baseline/report.json) e [resultado completo](evidence/anchors/after-query/report.json). Oito cenários completos, 54 verificações de âncoras e 12 capturas em desktop/mobile, perfis usuário/admin e temas claro/escuro. Cliques repetidos, Enter, histórico, links diretos e retorno do perfil aprovados. API de bootstrap simulada; isso não é homologação de produção.

## Validações

Ran: quatro testes SSR, lint focal, typecheck e build aprovados. Cinco capturas do manual revisadas, 2 testes Node +18 Vitest e cinco capítulos com revisão atual aprovados. Procedimento de Hosts inalterado; apenas hash editorial atualizado pela dependência de AppLayout. As capturas do manual contêm marcas de simulação já existentes.

A rotina final Sonar com cobertura real está em andamento; seus resultados serão registrados neste documento. O layout útil e o transporte do terminal não foram alterados; a regressão completa do terminal integra a coleta de navegador.

## Homologação e entrega

Homologação da tela anterior informada pelo usuário, com este ajuste solicitado. Não inferir nova homologação humana do comportamento a partir dos testes. Alteração disponível localmente em NodeAccess-current, branch `feature/NA-0172-20261106-security-center`, base/HEAD `745253d1edb522db79aaa44fd96608ce434a2774`, ainda LOCAL_WIP. Sem commit, push, PR, merge ou implantação desta frente.

Para conferir, atualizar a aba uma vez e selecionar **Auditoria e privacidade** no índice: o conteúdo deve apenas rolar até a seção. Voltar/avançar do navegador também deve manter a página.
