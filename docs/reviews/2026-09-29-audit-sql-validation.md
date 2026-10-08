# Auditoria: validação ampliada de SQL e falhas

Complemento de [TXT, rastreabilidade e versões](2026-09-29-audit-reconstruction.md).

## Correções confirmadas no MySQL

### Comandos históricos

A implementação anterior fazia duas consultas: verificava a versão e depois carregava os comandos. A leitura foi unificada com os filtros de tenant, sessão e retenção no mesmo SELECT que retorna os dados. Isso elimina uma ida ao banco nas versões com comandos e a janela entre a autorização da versão e a leitura dos dados.

O teste de uma alternativa com LEFT JOIN encontrou tabela temporária e filesort. A implementação final usa INNER JOIN, com acesso ordenado pelo índice de comandos. Somente um resultado vazio exige uma consulta adicional de existência, também autorizada, para distinguir uma versão vazia (`[]`) de uma versão inacessível (`null`). Essa segunda consulta não retorna comandos.

### Histórico

Com várias versões, inclusive horários iguais, o otimizador escolheu o índice de unicidade da fonte e ordenou os resultados. A consulta agora usa `FORCE INDEX (audit_reconstruction_tenant_session_idx)`: os dois primeiros campos têm igualdade por tenant/sessão, e o índice atende à ordem de criação. O InnoDB também contém a chave primária no índice secundário, permitindo o desempate por ID.

O plano validado faz leitura reversa do índice, sem filesort. Não foi criado índice redundante nem nova migração. A indicação de índice é específica dessa consulta limitada a 20 versões; deve ser reavaliada se os filtros, ordenação ou mecanismo/versão do banco mudarem.

## Cenários adicionados

O script `tools/session-audit/reconstruction-sql-review.mts` usa exclusivamente o MySQL descartável em `127.0.0.1:13319/audit_reconstruction_test`, após a preparação pelo script de integração anterior.

| Cenário | Verificação |
| --- | --- |
| Versão vazia, inexistente ou de outro escopo | Diferencia vazio de ausência/negação sem vazar comandos |
| SQL como conteúdo | Aspas, barras, Unicode e texto com DROP permanecem dados; tabela preservada |
| Escrita indevida | Outro tenant, sessão ausente, RUNNING e PURGED recusados; FAILED aceito |
| Nova versão do processador | Preserva comandos anteriores com a mesma fingerprint; identidade conflitante não cria registros |
| Falha no terceiro lote | Reverte metadados e os dois lotes anteriores, sem comandos órfãos |
| 12 gravações concorrentes | Uma versão e exatamente 600 comandos em seis lotes |
| Saídas extensas | Cinco saídas de 600 mil bytes UTF-8 são distribuídas em lotes sem truncamento |
| Histórico com timestamps iguais | Retorna exatamente as 20 versões esperadas em ordem determinística |
| Base ampliada | 50 sessões sintéticas; conjunto de carga com 10 mil comandos, mais casos específicos |
| EXPLAIN FORMAT=JSON | Histórico e comandos sem full table scan/filesort; busca usa índice FULLTEXT |
| Busca por tenant | Termo presente nos dois tenants, com controle positivo; resultados restritos ao tenant consultado |
| Retenção e exclusão | PURGED impede leitura; DELETE físico remove derivados sem afetar outro tenant |

Testes automatizados do serviço/API também cobrem: retenção durante a leitura do arquivo, recuperação após falha do banco, histórico indisponível retornando 503 em vez de vazio, limites da comparação de versões, POST sem autenticação/sem papel administrativo e bloqueio de TXT/histórico após aquecer o cache e aplicar retenção.

## Índices e limites

- `audit_reconstruction_tenant_session_idx`: listagem ordenada das versões de uma sessão/tenant.
- `audit_reconstruction_source_key`: unicidade de sessão, processador e fingerprint; mantido para idempotência.
- `audit_derived_run_command_key`: unicidade e leitura ordenada dos comandos por versão; escolhido no plano observado.
- `audit_derived_tenant_run_idx`: disponível para consultas por tenant/versão; não foi removido por não ser escolhido nesse único plano.
- `audit_derived_command_search_idx`: FULLTEXT de `command_text`, validado com MATCH. O tenant é filtro adicional; o FULLTEXT não é um índice particionado por tenant.

Os planos registrados são de MySQL 8.4 com dados sintéticos e estatísticas atualizadas por ANALYZE TABLE. Os tempos no relatório são observações locais, não SLA nem previsão de produção. O teste não representa milhões de registros, distribuição real de termos, contenção de disco ou várias réplicas da API.

A busca global continua sem tela/endpoint. Antes de publicá-la, ainda será necessário filtrar a versão corrente, definir paginação, backfill e testar seletividade de termos frequentes, stopwords e retenção. A comparação de versões continua por posição, e os limites de TXT/cache/processamento da entrega anterior permanecem.

## Reprodução e evidências

Resultado: **226 testes em 9 arquivos passaram**, além dos **10 grupos de validação SQL no MySQL real**. Typecheck do backend e lint dos arquivos de backend alterados passaram. Na execução registrada, 12 gravações concorrentes de uma versão com 600 comandos terminaram em 97 ms; a leitura dos 600 comandos em uma consulta levou 54 ms. Esses números são observações do laboratório descartável e não devem ser extrapolados para produção.

```sh
# Banco descartável; não usar o banco da aplicação.
docker run -d --name nodeaccess-audit-reconstruction-test \
  -e MYSQL_ALLOW_EMPTY_PASSWORD=yes -e MYSQL_DATABASE=audit_reconstruction_test \
  --tmpfs /var/lib/mysql -p 127.0.0.1:13319:3306 mysql:8.4
# Aguarde mysqladmin ping indicar disponibilidade.
npx tsx tools/session-audit/reconstruction-mysql-integration.mts
npx tsx tools/session-audit/reconstruction-sql-review.mts
AUDIT_EXPORT_REVIEW_DIR=/caminho/privado npx vitest run apps/backend/src/modules/session-audit
npm run typecheck --workspace @nodeaccess/backend
```

Relatório e planos: `docs/reviews/evidence/2026-09-29-audit-reconstruction/sql-review.json`. Os dados usados são sintéticos. Os casos históricos 136/166/183/184 continuam usando os eventos locais preservados, conforme a ressalva da revisão anterior sobre ausência dos JSONL originais.

Esta revisão altera apenas consultas de auditoria e testes. Não altera o fluxo SSH, a área do terminal nem a interface. Nenhuma mudança foi publicada em produção.
