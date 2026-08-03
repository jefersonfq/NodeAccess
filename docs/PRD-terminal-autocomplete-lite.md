# PRD Lite - Terminal Autocomplete

Versao curta para evolucao de autocomplete no terminal do NodeAccess.

## Objetivo
- aumentar adocao do terminal web com uma experiencia mais proxima de IDE/clientes SSH modernos
- reduzir digitacao repetitiva e erro operacional em comandos comuns
- reaproveitar snippets, historico e contexto do host sem comprometer seguranca
- manter o terminal previsivel: sugestoes ajudam, mas nao executam comandos sozinhas

## Principio central
- autocomplete deve ser opt-in por tenant e opt-in por usuario
- sugestao nunca deve alterar stdin automaticamente sem acao explicita do usuario
- senhas, tokens e segredos nao devem aparecer em sugestoes, historico ou auditoria
- o recurso deve falhar de forma silenciosa e segura, sem bloquear input, paste, resize ou reconexao

## Configuracao
- tenant:
  - habilitar/desabilitar `Terminal autocomplete`
  - permitir fontes: snippets, password prompts, historico de comandos, command suggestions, IA
  - definir politica de IA: desabilitada, local, cloud aprovada
  - definir se o uso entra em auditoria administrativa
- usuario:
  - ativar/desativar autocomplete no terminal
  - escolher fontes habilitadas dentro da politica do tenant
  - configurar gatilhos:
    - snippets: `sni ` ou outro prefixo configuravel
    - command suggestions: atalho explicito, por exemplo `Ctrl+Space`
    - password suggestions: somente quando o terminal detectar prompt compativel

## Fontes de sugestao

### 1. Snippet suggestions
- gatilho recomendado: `sni ` no inicio da linha ou apos prompt
- exibir snippets pessoais e compartilhados que o usuario pode usar
- buscar por nome, tags e conteudo mascarado do comando
- inserir o comando no terminal sem executar automaticamente
- se o snippet usa `{{secret:alias}}`, manter o fluxo seguro ja definido em `docs/PRD-snippets-lite.md`
- respeitar confirmacao quando houver secret ou politica de risco

### 2. Password suggestions
- objetivo: ajudar quando a sessao remota pede senha, sem expor o valor
- fontes permitidas:
  - credencial do host ja autorizada
  - Vault Secret permitido para aquele usuario/host
  - 1Password resolvido pelo fluxo existente, quando aplicavel
- comportamento:
  - detectar prompts como `password:`, `Password:`, `sudo password for ...:`
  - mostrar sugestao generica: `Usar senha autorizada para este host`
  - ao aceitar, enviar o segredo diretamente pelo canal seguro, sem renderizar no terminal
  - registrar auditoria mascarada, nunca o valor
- guardrails:
  - nao sugerir senha quando o prompt for ambiguo ou vier de comando desconhecido de alto risco
  - nao salvar senha em localStorage
  - nao incluir segredo em snippet, historico ou command suggestion

### 3. Command suggestions
- fase inicial sem IA:
  - sugestoes baseadas em historico local mascarado do usuario
  - comandos frequentes por host, tag, sistema operacional e protocolo
  - snippets mais usados como fonte ranqueada
  - comandos comuns seguros por distro, por exemplo `systemctl status`, `journalctl`, `df -h`, `free -m`
- fase posterior com contexto:
  - considerar sistema operacional cadastrado do host
  - considerar tags do host e ambiente
  - considerar diretorio atual apenas se shell integration fornecer esse dado com seguranca
- comandos sugeridos devem entrar como texto editavel, sem execucao automatica

### 4. AI command suggestions
- deve ser uma evolucao separada, opcional e governada por tenant
- primeira fase recomendada:
  - usuario descreve a intencao em linguagem natural
  - IA retorna comando sugerido e explicacao curta
  - usuario revisa e insere no terminal
  - execucao continua manual
- guardrails:
  - nunca enviar segredos, output sensivel ou buffer completo do terminal sem politica explicita
  - preferir provider local quando o tenant exigir isolamento
  - comandos destrutivos devem exigir confirmacao ou aviso forte
  - registrar auditoria de uso da IA sem prompt sensivel quando a politica exigir
- relacao com PRD de IA:
  - seguir `docs/PRD-local-ai-lite.md` para provider, politica e fases

## Shell integration
- referencia conceitual: terminais modernos usam integracao com shell para identificar prompt, comando, output, exit code, diretorio atual e comandos recentes
- no NodeAccess, isso deve ser fase posterior porque exige cooperacao do shell remoto e pode variar por bash, zsh, powershell e ambientes restritos
- primeiro corte recomendado:
  - nao instalar script automaticamente no host remoto
  - detectar apenas sinais seguros e opcionais
  - permitir configuracao por tenant antes de qualquer injecao de prompt/shell
- beneficios futuros:
  - saber melhor quando a linha atual esta editavel
  - melhorar command suggestions por diretorio/contexto
  - navegar entre comandos e outputs no buffer
  - sugerir comandos recentes com mais precisao

## UX recomendada
- overlay pequeno acima da linha atual do terminal, sem cobrir output importante
- navegacao por teclado:
  - setas para escolher
  - Enter ou Tab para inserir
  - Esc para fechar
- mostrar origem da sugestao:
  - `snippet`
  - `historico`
  - `host`
  - `senha autorizada`
  - `IA`
- indicar seguranca:
  - badge `usa secret` quando aplicavel
  - aviso antes de inserir comando destrutivo
  - microcopy clara quando o tenant bloqueia uma fonte
- deve funcionar bem com:
  - paste
  - copy
  - fullscreen
  - resize
  - tema/fonte do terminal
  - multiplas abas

## Fases recomendadas
1. Preferencias e feature flag:
   - configuracao por tenant
   - preferencia por usuario
   - fonte `snippets`
2. Snippet suggestions:
   - gatilho `sni `
   - picker no terminal
   - insercao sem execucao automatica
3. Password suggestions:
   - deteccao conservadora de prompt de senha
   - envio mascarado pelo canal seguro
   - auditoria sem valor
4. Command suggestions sem IA:
   - historico mascarado
   - comandos frequentes
   - ranking por host/OS/tag
5. IA opcional:
   - descricao para comando
   - provider governado por tenant
   - revisao obrigatoria antes de inserir/executar
6. Shell integration:
   - protocolo seguro e opcional
   - sem injecao automatica em hosts por padrao

## Fora do escopo inicial
- executar sugestao automaticamente
- instalar shell integration nos hosts sem aprovacao explicita
- armazenar segredo em historico, snippet ou localStorage
- autocomplete de path remoto em tempo real via comandos invisiveis no shell
- enviar buffer completo do terminal para IA por padrao

## Riscos
- interferir no input do terminal e piorar latencia percebida
- sugerir comando perigoso em host errado
- vazar segredo em historico/auditoria/output
- gerar falso senso de confianca em sugestao de IA
- shell integration quebrar prompt customizado do usuario

## Criterios de aceite
- tenant consegue desligar completamente o recurso
- usuario consegue desligar o recurso para si
- com recurso desligado, terminal se comporta como hoje
- snippet suggestion por `sni ` nao executa automaticamente
- password suggestion nunca exibe o valor
- auditoria de uso sensivel e sempre mascarada
- autocomplete nao degrada input do terminal acima da meta de latencia

## Arquivos provaveis
- frontend:
  - `apps/frontend/src/views/TerminalView.vue`
  - `apps/frontend/src/composables/useTerminal.ts`
  - `apps/frontend/src/terminal/*`
  - `apps/frontend/src/components/SnippetsPanel.vue`
- backend:
  - `apps/backend/src/modules/snippets/*`
  - `apps/backend/src/modules/sessions/*`
  - `apps/backend/src/modules/ssh/*`
  - `apps/backend/prisma/schema.prisma`
- docs:
  - `docs/PRD-snippets-lite.md`
  - `docs/PRD-local-ai-lite.md`
  - `docs/PRD-user-preferences-lite.md`
