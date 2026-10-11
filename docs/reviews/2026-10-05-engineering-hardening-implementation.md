# NA-0038 — Correções e validação de engenharia

Branch local: `fix/NA-0038-20261005-engineering-hardening`. Base: workspace da frente NA-0037, com alterações anteriores preservadas. Sem deploy, merge, publicação ou alteração do banco da instalação.

Este trabalho implementa os problemas concretos NA-ENG-01 a 12 da [varredura](2026-10-05-engineering-practices-audit.md). A matriz de práticas continua sendo um roteiro: microserviços, CQRS, réplicas de leitura, circuit breakers e outras mudanças condicionais não foram adicionados sem necessidade demonstrada.

## Resultado por achado

| Achado | Implementação | Evidência e limite |
|---|---|---|
| 01 — flags | Parser existente aplicado a todos os booleanos; valores inválidos rejeitados | Matriz de flags e Fastify real com headers de IP falsificados; revisar configurações que dependiam da coerção antiga |
| 02 — Jira/IA | Consumidor Jira independente da flag de resumo | API real processou evento com IA desligada |
| 03 — recuperação | Leases persistidos e recuperação de PROCESSING vencido/legado | Consumidores mortos com SIGKILL e retomada no MySQL real |
| 04 — concorrência | Claim atômico, token de proprietário e updates cercados pela validade do lease | 30 claims concorrentes por fila; 100 eventos/10 workers/100 efeitos no cenário sem falha de ACK |
| 05 — deduplicação do outbox | Chave única persistida para entregas e criação idempotente com leitura do vencedor | 20 inserts concorrentes convergem para uma entrega; migração preserva o histórico e suprime duplicatas pendentes |
| 06 — deadlines e retry | HTTP Jira limitado a 30 s/1 MiB; oito tentativas máximas, backoff com jitter e término de falhas permanentes; frontend com limites por operação | Corpo travado/grande, esgotamento e integração desabilitada; SFTP usa cinco minutos sem progresso; mutações frontend não são repetidas automaticamente |
| 07 — shutdown | Tasks sem sobreposição, stop drenável, readiness indisponível e deadline global | SIGTERM da API real: evento persistido antes da saída; worker de auditoria não reagenda após stop |
| 08 — headers | Headers mantidos nas locations com Cache-Control, em quatro perfis Nginx; CSP report-only | 24 respostas HTTP reais verificadas. CSP ainda não é uma política de bloqueio |
| 09 — erros UI | Tratamento global sanitizado e fronteira recuperável no painel de arquivos | Exceção no FileManager real, retry por teclado, foco e SSH preservados; timeout Axios sem reload |
| 10 — componentes | Extração localizada de TerminalFilesPanel e PanelErrorBoundary | Primeiro passo validado; a decomposição das demais páginas grandes continua pendente |
| 11 — corpo webhook | Leitura incremental de até 512 bytes e cancelamento do restante | Corpo infinito/grande/travado; identificador de entrega estável mesmo sem assinatura |
| 12 — backups | Pausa antes de salvar ao atingir 20 backups por arquivo, 64 MiB reconhecidos no diretório ou limite de inspeção | OpenSSH real; original e backups preservados, rascunho local mantido e recuperação explicada na UI |

Correções adicionais encontradas na execução: retry de webhook agora valida tenant e subscription e recusa entregas concluídas ou duplicatas antigas; respostas de quota chegam à interface mesmo após fechar/reabrir o painel; encerramento do worker de resumos não volta a agendar trabalho.

## Testes e evidências

Os resultados finais, comandos e contagens estão em [test-results.md](../changes/2026/10/NA-0038-engineering-hardening/test-results.md). Evidências em `docs/reviews/evidence/2026-10-05-engineering-hardening/`. Ambiente descartável: MySQL 8.4, Redis sem persistência, OpenSSH, Chromium/Playwright e CDP. Nada foi exercitado em produção.

Durante a validação foram encontradas e corrigidas a corrida de upsert Prisma/MySQL e a resposta EOF do OpenSSH na inspeção incremental de backups. Uma execução inicial teve timeout no teste de observabilidade sob disputa de recursos; a suíte foi repetida com concorrência controlada. A simulação de foco foi repetida após reiniciar Vite, pois o ambiente em volume Windows ainda servia um componente antigo. O harness do manual teve a versão esperada alinhada à versão explícita do frontend.

## Implantação e recuperação

Antes de ativar a versão, parar os consumidores antigos, executar a migration aditiva `20261005160000_engineering_queue_leases` e regenerar o cliente Prisma/build. Não manter consumidores antigos concorrendo com os novos: eles não respeitam leases. A migration preserva IDs e histórico e neutraliza duplicatas antigas ainda não enviadas. Quando existe uma entrega concluída para a mesma chave, ela tem preferência; isso evita reenviar o registro pendente mais antigo apesar de já haver sucesso conhecido. O ensaio de migration foi feito em banco descartável; backup/restore da instalação deve integrar a homologação da implantação.

[Procedimento de recuperação](../changes/2026/10/NA-0038-engineering-hardening/rollback.md) contém snapshot verificável dos arquivos anteriores e dry run de restauração seletiva. Trocar de branch sozinho não restaura alterações não commitadas. Não executar reset/stash global sobre o workspace anterior.

## Limites conhecidos

- Entrega externa continua sendo **ao menos uma vez**. Se o receptor aceitar a operação e o processo cair antes de persistir o resultado, o lease permite nova tentativa. Webhooks incluem identificador estável para deduplicação pelo receptor; Jira não oferece garantia automática de exactly-once.
- O limite de backups não é uma reserva distribuída de espaço: escritores concorrentes ou ferramentas externas podem ultrapassá-lo. Não há limpeza automática nem descarte silencioso de rascunhos.
- CSP report-only e a extração de componentes são etapas parciais; não constituem certificação de segurança, acessibilidade ou refatoração completa.
- O build ainda sinaliza chunk grande da biblioteca UI. Os testes de navegador registram avisos de runtime e navegação quente pontualmente acima de dois segundos sob carga local; esses avisos não foram ocultados.
- Não houve certificação de capacidade de produção, soak de horas/dias, aplicações Windows de terceiros ou ausência absoluta de regressões. Os resultados delimitam os cenários executados.
