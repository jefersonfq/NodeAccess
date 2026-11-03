# NA-0132 — Registro da implementação

## Pedido e objetivo

Corrigir execução npm por PATH que voltou como violação nova no CI descartável, sem relaxar gate.

## Implementação

Base SHA: 8dae9b49a8dab89b9c0a7c4fcb4a29a1d401662d. Branch/worktree próprios. Plano criado antes de edição.

## Validação

A executar; nenhum scanner nesta frente.

## Recuperação

Patch mínimo no runner; rollback por commit local. Tokens continuam somente no ambiente.

## Pendências

Testes, revisão independente e integração. Workbook/índices coordenados pela raiz.

## Diário de interações

### 2026-11-03T19:35:25.714918-03:00 — Decisão e escopo

Revisão contextual original S4036 não resolve gate de novas violações da análise específica. Root autorizou correção estrutural, mantendo baseline aceita intacta e registrando disposição fixed após validação.

### 2026-11-03T19:37:55-03:00 — Implementação e revisão concluídas

`analyze.mjs` passa a executar `process.execPath` com o npm CLI como primeiro argumento. Resolução aceita npm_execpath absoluto explícito ou layout padrão Unix junto ao Node; realpath, basename npm-cli.js e arquivo regular validados. Não pesquisa PATH. Instalações separadas (por exemplo Node temporário/nvm) devem executar pelo npm run ou fornecer npm_execpath absoluto. Esse valor é configuração confiável do operador/CI, não autenticação criptográfica do conteúdo; não se promete defesa contra operador malicioso do mesmo ambiente.

Versão @sonar/scan5.0.2, parâmetros do gate, configuração, shell:false, normalização localhost, token somente no ambiente e códigos de saída preservados. Opções internas root/env permitem fixtures reais isoladas; nenhum novo argumento CLI aceito. --check continua somente preflight, sem iniciar scanner ou exigir npm CLI disponível.

Ran neste worktree:23/23 contratos passaram (8 de analyze, incluindo6novos;15validate-flow), lint dos2arquivos sem erros/avisos e diffcheckPASS. Novo teste executa script npm-cli.js sintético com Node real, registra somente presença do token sintético, confirma argv/cwd/host e prova que executável npm malicioso no PATH não foi chamado. Negativos cobrem relativo, ausente, nome inesperado, diretório chamado npm-cli.js, symlink explícito, exit7, sinal e guards. LCOV mínimo existe apenas na fixture descartável, não é usado como evidência de cobertura de produto.

Revisor frontend leu delta e reproduziu8/8, depois1/1 negativo de diretório reforçado; parecer PASS_WITH_WARNINGS. Raiz leu diff sem bloqueio. Nenhum npmci/scanner/Docker/VPS executado nesta frente. Lint usa dependências existentes por symlink somente leitura, sem alterar instalação de outra frente.

Disposição original4c089a7b-f35e-4b44-8dcb-b4585c80275a em NA-0088 mudou context_reviewed→fixed, com evidências específicas. accepted-findings.json não alterado. A base local usa campo key; integração já migrou para issueId na NA-0130 e preservará esse campo ao resolver o delta. Sincronizada somente documentação NA-0132 canônica, evitando reverter a migração do catálogo/NA-0088 compartilhado. Root regenerará tabela/cópia da disposição após integração.

Próximo passo: checkpoint local, integração e scanner real para confirmar ausência da violação; não declarar gate aprovado antecipadamente. Workbook/índices permanecem coordenados pela frente principal. Reversão por commit restaura runner anterior, sem efeitos em serviços.
