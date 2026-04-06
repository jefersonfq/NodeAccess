# PRD Terminal Fullscreen Lite

## Objetivo
Permitir que o usuario coloque a area de terminal em fullscreen real do browser sem depender de `F11`, com saida clara e comportamento previsivel.

## Problema
Hoje o terminal ocupa bem a tela, mas ainda compete com chrome do browser e da aplicacao.
Isso reduz foco operacional em:
- troubleshooting longo
- execucao de mudancas
- monitoramento de output extenso
- uso em telas menores

## Resultado esperado
- entrar em fullscreen por botao visivel na UI do terminal
- sair por:
  - `Esc`
  - botao flutuante de retorno
  - mesmo botao de toggle quando visivel
- manter abas, toolbar e paineis do terminal funcionando dentro do fullscreen

## Escopo inicial
- fullscreen no frontend usando Fullscreen API do browser
- aplicar ao container principal da tela de terminal
- indicar estado atual na UI
- manter compatibilidade com multi-abas e split panes
- manter resize correto do terminal ao entrar e sair

## Fora de escopo inicial
- fullscreen automatico por preferencia persistida
- esconder automaticamente paineis laterais ao entrar
- atalho dedicado novo
- comportamento especial por browser

## Regras
- fullscreen e uma preferencia de visualizacao, nao de negocio
- se o browser nao suportar Fullscreen API, a UI nao deve quebrar
- a saida do fullscreen deve ser clara mesmo sem teclado
- entrar em fullscreen nao deve reconectar sessao SSH

## UX recomendada
- botao discreto na toolbar do terminal
- botao flutuante pequeno para sair quando fullscreen estiver ativo
- copy simples no tooltip:
  - entrar em fullscreen
  - sair do fullscreen

## Riscos
- resize incorreto do xterm ao trocar de modo
- conflito visual com modais e overlays
- diferencas menores entre navegadores

## Proximo corte recomendado
1. persistir preferencia opcional no perfil
2. permitir escolher se paineis laterais devem fechar ao entrar
3. avaliar atalho configuravel
