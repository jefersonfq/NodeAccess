# Autocomplete: correções e validação

Implementação dos achados AC-01 a AC-10 e UX-01 da revisão anterior.

## Comportamento entregue

- Caminhos remotos preservam espaços, aspas, barras invertidas e caracteres especiais no operando inteiro. Nomes com controles são excluídos, sem transformar sua identidade. O `~` expandido é distinguido do `~` literal. Caminhos relativos à home não são concatenados ao diretório de trabalho; `..` permanece para resolução pelo servidor SFTP, inclusive com links simbólicos.
- Substituição da linha usa fim da linha seguido de limpeza (`Ctrl+E`, `Ctrl+U`) antes de inserir o texto. Prefixos com diferença de caixa são substituídos, pois comandos do shell diferenciam maiúsculas/minúsculas. Nenhum Enter é enviado.
- Atalhos modificados continuam chegando ao shell. Após navegação por palavra, o modelo local suspende sugestões até recuperar uma linha conhecida, evitando presumir uma posição de cursor.
- Esc invalida consultas pendentes; respostas canceladas ou anteriores à invalidação não repovoam o cache. A conclusão de uma consulta antiga não remove uma consulta nova em andamento.
- Histórico tolera armazenamento indisponível ou sem quota, com fallback limitado em memória. O usuário pode desativar a memorização para seu host e limpar os comandos lembrados mediante confirmação. Controles de terminal e padrões de segredos não entram no histórico.
- Entidades systemd são extraídas de linhas completas, inclusive quando divididas em chunks. Linhas parciais excessivas são descartadas sem criar nomes a partir de fragmentos. Pods preservam namespace; deployments não viram sugestões de pod.
- O popup acompanha mudanças da própria altura (quebra de texto e controles do histórico), preservando o espaço da linha do cursor em telas pequenas. Os controles ficam fora do listbox de sugestões.
- A interface distingue carregamento, vazio e erro; oferece nova tentativa sem bloquear digitação. Textos do popup possuem traduções PT/EN, sugestões expõem o comando completo e o textarea mantém referência ARIA à opção ativa.

## Arquivos principais

- `apps/frontend/src/components/TerminalPane.vue`
- `apps/frontend/src/services/terminal-autocomplete.service.ts`
- `apps/frontend/src/services/terminal-path-autocomplete.service.ts`
- `apps/frontend/src/services/terminal-autocomplete-history.service.ts`
- `apps/frontend/src/services/terminal-session-entity-index.service.ts`
- `apps/frontend/src/services/terminal-input-model.service.ts`
- `apps/frontend/src/locales/{pt-BR,en}.json`
- Testes correspondentes dos serviços, `terminal-autocomplete-resilience-review.test.ts` e harnesses em `tools/frontend/terminal-*`.

## Validação

- 104 testes de serviços/modelo passaram, sem `it.fails`. Incluem os oito defeitos originalmente reproduzidos e novos cenários de aspas, namespaces iguais, armazenamento negado, concorrência, linhas excessivas e atalhos de palavra.
- Cinco cenários passaram em um PTY local real com Bash/Readline em modo Emacs. O teste inspeciona `READLINE_LINE` com uma tecla de diagnóstico configurada somente no processo descartável; não submete os comandos sugeridos.
- Harness do navegador passou nos temas claro e escuro e cobre desktop/mobile, erro, timeout, resposta atrasada, reconexão, nova tentativa bem-sucedida, preferência/limpeza de histórico e vínculo da opção ativa ao input. O transporte SSH/SFTP e a API são simulados nesse harness.

Repetir a validação:

```bash
npx vitest run apps/frontend/src/services/terminal-autocomplete*.test.ts apps/frontend/src/services/terminal-path-autocomplete.service.test.ts apps/frontend/src/services/terminal-session-entity-index.service.test.ts apps/frontend/src/services/terminal-sftp-channel.service.test.ts apps/frontend/src/services/terminal-input-model.service.test.ts
npx tsx tools/frontend/terminal-autocomplete-pty.ts
npm run typecheck --workspace @nodeaccess/frontend
FRONTEND_BASE=http://127.0.0.1:5190 npm run test:terminal-experience:web
FRONTEND_BASE=http://127.0.0.1:5190 UI_THEME=light npm run test:terminal-experience:web
```

Limites: a certificação de edição real foi local em Bash/Readline Emacs, não em todos os shells/modos vi ou contra um host remoto. Não houve alteração de resize, WebSocket ou transporte SSH de produção. Não houve deploy. O relatório anterior documenta o estado antes das correções.

Artefatos locais: `/tmp/nodeaccess-autocomplete-fixed-dark.json`, `/tmp/nodeaccess-autocomplete-fixed-light.json`, `/tmp/nodeaccess-autocomplete-fixed-light-mobile.png`. A validação de tipos do frontend também passou. A geometria móvel manteve popup de 298 px em container de 314 px e distância de 6 px do cursor. O teste de contraste do texto de ajuda protege contra sobrescritas do tema claro.
