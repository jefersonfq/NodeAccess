# Revisão da reconstrução e do playback SSH — 28/09/2026

## Escopo e evidências

Revisão somente leitura dos exports entregues em `imgs_debug`, seguida de correções no reconstrutor offline e na apresentação da auditoria. Não houve conexão aos servidores auditados, execução dos SQLs, alteração do transporte SSH ou publicação em produção.

| Export | Eventos válidos | Comandos reconstruídos | Achado principal |
| --- | ---: | ---: | --- |
| 136 | 624 | 14 | Histórico do shell e fronteira de saída no prompt `(opensips-cli):` |
| 166 | 599 | 9 | SQL colado/editado e navegação pelo histórico do MySQL |
| 183 | 4.899 | 7 | Cinco consultas completas de 509 caracteres, incluindo mudanças de datas após recuperar o histórico |
| 184 | 4.106 | 6 | Shift+seta interpretado pelo servidor como inserção de caractere; recuperação do eco observado |

O arquivo mencionado como 134 não foi localizado; havia um arquivo 184, também analisado. Nenhuma linha inválida nos quatro exports. As duas primeiras consultas da sessão 183 foram interrompidas no servidor; continuam registradas como comandos submetidos. Na sessão 184, o erro de coluna `time` consta no registro bruto e foi preservado: não é uma falha da auditoria.

Além dos exports, foram reconstruídas 1.904 sessões locais com contagem armazenada superior a cinco comandos. Todos os chunks estavam disponíveis. Em 1.903 sessões a contagem coincidiu; na sessão 4177, o histórico recuperou uma execução adicional de `htop`, passando de nove comandos armazenados para dez reconstruídos. O scanner não atualiza essas contagens no banco.

## Causas e correções

- O reconstrutor removia sequências de cursor antes de aplicar a edição; exclusões e inserções acabavam na posição errada.
- Quebras de linha eram tratadas como submissões independentes, fragmentando SQLs. O modo MySQL/MariaDB agora acumula continuações até um delimitador válido, respeitando aspas, comentários, `DELIMITER`, `\g` e `\G`.
- A seta para cima não transporta o texto completo no canal de entrada. A reconstrução agora aceita o texto efetivamente redesenhado pelo servidor em formatos de readline reconhecidos, inclusive fragmentação e quebra física de linha verificada pela largura do terminal.
- Uma tecla modificada não tem comportamento uniforme entre clientes. No caso observado, Shift+seta produziu um caractere literal; isso só é aplicado quando há uma operação de inserção explícita no eco do servidor.
- O prompt do OpenSIPS CLI agora separa corretamente comando e saída.
- SQL multilinha preserva espaços e quebras. A interface quebra linhas visualmente sem modificar o texto. Edição não verificável recebe baixa confiança e aviso para consultar o playback e o registro bruto.

Cancelamento de entrada incompleta não cria um comando executado. Uma consulta já submetida e depois interrompida mantém sua saída de erro. O parser não busca histórico remoto nem inventa trechos ausentes.

## Validação reproduzível

Executar a partir da raiz do projeto. Os exports reais permanecem locais e não são fixtures versionadas: podem conter dados e credenciais digitados pelo operador. Os relatórios de tela reais não geram capturas; as capturas de interface usam dados sintéticos.

```bash
# Regressões do módulo; testes reais são opt-in.
AUDIT_EXPORT_REVIEW_DIR=imgs_debug npx vitest run apps/backend/src/modules/session-audit

# Artefatos privados para a conferência de tela.
npx tsx tools/session-audit/review-exported-session.ts imgs_debug/session-audit-136.jsonl imgs_debug/session-audit-166.jsonl imgs_debug/session-audit-183.jsonl imgs_debug/session-audit-184.jsonl
npx tsx tools/session-audit/mysql-playback-fixture.ts

# Usar uma instância local do frontend atualizada.
FRONTEND_BASE=http://127.0.0.1:5182 node tools/frontend/audit-export-review-playwright.cjs /tmp/nodeaccess-audit-136-review.json /tmp/nodeaccess-audit-166-review.json /tmp/nodeaccess-audit-183-review.json /tmp/nodeaccess-audit-184-review.json /tmp/nodeaccess-audit-synthetic-review.json

FRONTEND_BASE=http://127.0.0.1:5182 PLAYBACK_VISUAL_ARTIFACTS=1 node tools/frontend/session-playback-playwright.cjs
npx tsx tools/session-audit/reconstruction-fidelity.ts

# Somente banco local: lê o acervo sem alterar sessões ou contagens.
node --env-file=apps/backend/.env --import tsx tools/session-audit/review-recorded-sessions.ts
```

A suíte visual confere cada comando, sua integridade textual, ausência de corte horizontal, ação “Ver no playback” e presença integral no playback final, em 1440 e 390 pixels. A suíte existente cobre estados de erro, vazio, truncamento, controles de reprodução, filtros, paginação e uma sessão de 600 comandos.

Os testes do reconstrutor incluem colagem multilinha, todas as divisões possíveis de um fluxo com Unicode/ANSI/CRLF, cursores, exclusão, histórico, entradas canceladas, SQL longo, comentários, delimitadores de procedures, troca de ator, Tab interativo e controles desconhecidos. Há comparações independentes das datas dos cinco SQLs da sessão 183 e do texto da sessão 184 com o histórico efetivamente exibido pelo servidor.

## Arquivos de implementação

- `apps/backend/src/modules/session-audit/session-audit-input.ts`: estado de edição e submissão offline.
- `apps/backend/src/modules/session-audit/session-audit-history.ts`: recuperação conservadora de eco de histórico.
- `apps/backend/src/modules/session-audit/session-audit-normalizer.ts`: integração, detecção de prompts e confiança.
- `packages/shared/src/schemas/session-audit.schema.ts`: aviso opcional de incerteza no contrato.
- `apps/frontend/src/views/admin/SessionAuditDetailView.vue`: texto integral com quebra visual e aviso de reconstrução.
- Testes e ferramentas nos mesmos módulos, `tools/session-audit` e `tools/frontend`.

## Resultados da validação

- 183 testes do módulo de auditoria passaram, incluindo quatro verificações opt-in dos exports reais.
- 12 cenários adicionais de fidelidade passaram, cobrindo 1.394 comandos sintéticos/representativos.
- 10 cenários de navegador passaram na revisão dos exports e da fixture SQL: 86 cartões conferidos, sendo 72 dos arquivos reais, com navegação comando a comando no playback.
- Build do contrato compartilhado, typecheck de backend/frontend e lint dos arquivos de reconstrução passaram.
- Capturas sintéticas inspecionadas em desktop e celular; nenhum SQL real foi incluído nas capturas.
- A suíte completa de playback passou: desktop/celular, bruto/limpo, CSV, exportação de destaques, estados de erro/vazio/truncamento, sessão longa e escala de 600 comandos. Duas execuções anteriores excederam o orçamento de paginação (9,6 s e 8,5 s para cinco trocas). Uma comparação com o estilo anterior passou em 4,3 s; a execução final com a interface atual também passou, sem ampliar limites ou remover verificações. A causa da variação de tempo não foi isolada.

Evidências versionadas, com dados sintéticos ou metadados: [revisão de telas](evidence/2026-09-28-ssh-audit/export-browser-review.json), [regressão de playback](evidence/2026-09-28-ssh-audit/playback-regression.json), [fidelidade](evidence/2026-09-28-ssh-audit/reconstruction-fidelity.json), [SQL em desktop](evidence/2026-09-28-ssh-audit/sql-desktop.png) e [aviso em celular](evidence/2026-09-28-ssh-audit/uncertainty-mobile.png).

## Limites e operação

A correção beneficia auditorias históricas na leitura, desde que seus chunks brutos estejam disponíveis. Artefatos de IA já gerados e contagens históricas persistidas não são reescritos automaticamente. A contagem do painel de comandos é reconstruída na consulta.

Prompts personalizados e atalhos personalizados que não possam ser confirmados pelo eco ainda exigem consulta ao bruto. Baixa confiança não deve ser usada como prova de um comando exato. As simulações não cobrem todos os clientes interativos existentes.

O frontend foi validado com respostas locais produzidas pelo reconstrutor e interceptação das APIs; isso não substitui uma verificação da versão publicada em produção. O terminal ao vivo, sua área útil, o transporte e os WebSockets não foram alterados; testes de PTY real não se aplicam a esta mudança offline.

O fluxo de auditoria não está mapeado em `docs/manual/manifest.json`; esta nota registra o procedimento e as evidências sem marcar capítulos do manual como revisados.
