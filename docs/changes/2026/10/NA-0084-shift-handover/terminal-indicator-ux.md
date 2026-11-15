# NA-0084 — Revisão UX do plantão no terminal

Objetivo: consultar contexto autorizado sem perder a sessão nem reservar largura do terminal. Um ícone de prancheta na barra existente usa contagem discreta (9+); não há banner automático. O painel mostra host/descrição, títulos e expansão por item, reduzindo densidade. Detalhe completo abre em nova aba. Fechar não conclui o assunto.

Estados cobertos: carregamento, itens, vazio autorizado, indisponibilidade e recuperação; erros não viram zero. Foco permanece no painel aberto, Tab é contido, Escape/X fecham e restauram somente a mesma sessão. Descrição antiga não permanece em erro/troca. Cabeçalho fixo mantém Fechar visível; lateral segue a barra; mobile respeita viewport. O painel sobrepõe temporariamente parte da saída, trade-off explícito para preservar linhas/colunas.

## Capturas sintéticas

- [01-terminal-indicador-discreto](terminal-screenshots/01-terminal-indicador-discreto.png)
- [02-terminal-pendencias-do-host](terminal-screenshots/02-terminal-pendencias-do-host.png)
- [03-terminal-contexto-expandido](terminal-screenshots/03-terminal-contexto-expandido.png)
- [04-terminal-plantao-fullscreen](terminal-screenshots/04-terminal-plantao-fullscreen.png)
- [05-terminal-falha-local](terminal-screenshots/05-terminal-falha-local.png)
- [06-terminal-sem-pendencias-visiveis](terminal-screenshots/06-terminal-sem-pendencias-visiveis.png)
- [07-terminal-plantao-mobile](terminal-screenshots/07-terminal-plantao-mobile.png)
- [08-terminal-troca-de-host](terminal-screenshots/08-terminal-troca-de-host.png)
- [09-terminal-api-real](terminal-screenshots/09-terminal-api-real.png)
- [10-terminal-plantao-split](terminal-screenshots/10-terminal-plantao-split.png)
- [11-terminal-nota-longa-fechamento-visivel](terminal-screenshots/11-terminal-nota-longa-fechamento-visivel.png)
- [12-terminal-barra-a-esquerda](terminal-screenshots/12-terminal-barra-a-esquerda.png)

Dados sintéticos; captura09 usa API/MySQL reais e transporte SSH simulado. Sem credenciais ou saída de usuário. A revisão técnica não substitui homologação humana.

## Revisão independente

Revisão visual independente: PASS_WITH_WARNINGS. Novos12prints sem bloqueios funcionais; pequena faixa de texto junto ao cabeçalho sticky é cosmética. Capturas gerais do manual têm ressalvas preexistentes de fixture: hosts mostra1no cabeçalho e237na paginação; sharing contém textos técnicos do harness. Capítulos terminal/handover revisados; gate editorial PASS não representa eliminação dessas ressalvas nem homologação humana.
