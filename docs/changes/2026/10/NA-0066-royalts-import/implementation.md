# NA-0066 — Registro da implementação

## Pedido e objetivo
Adicionar Royal TS ao Importar Hosts com testes de sucesso, falha e simulações.

## Implementação
Base SHA: 66444a9dd4c167453004bb6089278548bdd2c0d9. Branch feat/NA-0066-royalts-import; preservadas alterações anteriores ainda não commitadas.
Parser royalts-import.service, detecção, aba ImportHostsModal, locales pt-BR/en e enum shared. Reutilização de preview/commit/history; sem migração, dependências novas ou mudanças no transporte.
O formato exportável documentado é CSV; documentos nativos recebem orientação. Prévia anterior é invalidada se um arquivo substituto falhar na leitura ou exceder limites.

## Validação
Ran: 82 testes de parser/detecção/HTTP/serviço aprovados após build shared; /tmp/royalts-unit.log.
Ran: rodada final test:royalts-import — 83 testes aprovados (/tmp/royalts-unit-final.log); consentimento de senhas validado também para royalts.
Ran: test:host-import:core — 92 testes; Guacamole e política de rede — 32 testes (/tmp/royalts-regression.log, /tmp/royalts-other-formats.log). Essas suítes se sobrepõem à específica; não somar como testes únicos.
Ran: test:royalts-import:web — seis cenários aprovados: arquivos inválidos/correção, committed, rolled_back, partially_rolled_back, history-failure e stale-preview (/tmp/royalts-web.log). Exercitam prévia expirada, relatório, teclado e duplicata ignorada; API interceptada.
Ran: navegador 390px claro e 1440px escuro, versões inglês e português; leitura tardia descartada, arquivo grande/corrompido bloqueia prévia antiga e correção manual recupera fluxo (/tmp/royalts-mobile.log, /tmp/royalts-desktop.log, /tmp/royalts-final-failures.log, /tmp/royalts-final-success.log). Regex do harness ajustada à forma plural existente em pt-BR após falha de asserção; sem mascarar falha de aplicação.
Ran: regressão MobaXterm e CSV no Playwright (/tmp/royalts-moba-web.log, /tmp/royalts-csv-web.log). Moba usou FRONTEND_BASE=5173, após tentativa no default 5174 sem serviço.
Ran: build shared, typechecks frontend/backend e ESLint direcionado passaram (/tmp/royalts-shared.log, /tmp/royalts-frontend-types.log, /tmp/royalts-backend-types.log, /tmp/royalts-final-types.log, /tmp/royalts-lint-final.log).
Ran: manual:capture dev, test:manual (2 Node + 18 Vitest), manual:check-reviewed e git diff --check. Cinco capturas oficiais e capturas Royal TS desktop/mobile revisadas. Hash Hosts atualizado após revisão; novos arquivos de importação mapeados. Logs /tmp/royalts-manual*.log.
Ran: build frontend passou (/tmp/royalts-build.log), com aviso de chunks acima de 950 kB. Formatação final e tipos de retorno ajustados conforme lint; nova rodada dos 83 testes passou. ESLint final sem avisos/erros.
Skipped: teste com Royal TS instalado/exportação real, banco/SSH real e suíte geral completa; testes focados e fixtures cobrem este fluxo.
Fixtures sintéticas, não exportação de uma instalação real do Royal TS.

## Recuperação
Alterações locais reversíveis; base acima. Não usar reset por haver trabalho anterior no checkout. Remover somente o diff desta frente ou reverter PR quando existir.
Sem migração de banco. Registros importados podem ser revertidos pelo histórico quando o fluxo existente permitir.

## Pendências
Nenhuma validação técnica planejada pendente. Homologação com exportação real do Royal TS não foi realizada; o suporte cobre CSV documentado, não documentos nativos. Sem commit/publicação.

## Diário de interações

### 2026-10-23T17:20:40-03:00 — Implementação solicitada
Definido suporte ao CSV Royal TS documentado, com protocolo explícito para arquivos sem tipo. Implementados parser, UI e contrato; testes unitários/serviço/HTTP passaram. Próximo passo: finalizar simulações de falha e revalidação visual/manual.

### 2026-10-23T17:25:54-03:00 — Testes de sucesso/falha e revisão\n83 testes específicos passaram, assim como regressões e simulações Playwright. Tratados arquivo inválido substituindo prévia válida, leitura concorrente e recuperação por edição. Manual e cinco capturas revalidados; capturas da nova aba revisadas em ambos os temas. Sem criação de hosts reais. Próximo passo: concluir build e entregar instruções de uso.\n
### 2026-10-23T17:28:10-03:00 — Fechamento\nBuild frontend, lint final e repetição dos 83 testes passaram; manual:check-reviewed e git diff --check passaram após atualização do hash editorial afetado pela formatação. Capturas Royal TS inspecionadas em português/inglês, desktop escuro/mobile claro. Sem publicação ou commit. Próximo passo: usuário pode testar Hosts → Importar Hosts → Royal TS com CSV exportado do aplicativo; compatibilidade com arquivos reais ainda não homologada.\n
### 2026-10-23T17:56:30-03:00 — Inventário de testes solicitado\nUsuário perguntou a quantidade atual. Ran: npx vitest list --json=/tmp/nodeaccess-test-inventory.json, coleta sem execução, exit 0. Configuração padrão lista 2.150 casos em 239 arquivos: backend 1.499, frontend 638, shared 13. Lista omite casos skipped/opt-in desabilitados; não representa o total de cenários de todos os runners. Inventário por nomes fora de node_modules/dist encontrou 31 arquivos .test.js/.cjs/.mjs e 67 scripts com playwright no nome; são arquivos/roteiros, não casos adicionais somáveis. Sem alterações de produto ou nova execução de testes. Próximo passo: nenhum para esta consulta.\n