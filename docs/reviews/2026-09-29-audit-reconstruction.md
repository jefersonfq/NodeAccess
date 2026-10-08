# Auditoria SSH: TXT, rastreabilidade e versões

Revisão complementar: [testes ampliados, consultas e planos de índices](2026-09-29-audit-sql-validation.md).

Atualização posterior: [TXT legível como padrão e três opções de exportação](2026-09-29-readable-audit-txt.md). O TXT detalhado descrito abaixo continua disponível como “Relatório técnico”.

## Entrega

A tela de detalhes da auditoria oferece **Baixar TXT**, **Reprocessar**, diagnóstico da gravação e comparação de versões preservadas. O download JSONL continua disponível. Os comandos exibem os intervalos de eventos de entrada e saída usados na reconstrução.

O TXT contém os comandos reconstruídos e suas saídas, avisos de integridade, versão do processador, identificação da reconstrução e todos os eventos válidos registrados, identificados por direção, sequência, horário e autoria disponível. Caracteres de controle são representados como texto visível, sem executar sequências de terminal. O arquivo é derivado sob demanda; não há uma segunda gravação no caminho crítico do SSH.

A busca entre auditorias terá sua **tela em uma próxima etapa**, conforme decisão do usuário. Esta entrega prepara tabelas materializadas, isolamento por tenant e índice FULLTEXT dos comandos. A pesquisa existente dentro da auditoria permanece disponível, com seus limites atuais.

## Uso e estados

1. Abra Administração → auditoria de sessões → detalhes de uma sessão.
2. Consulte “Gravação e reconstrução”. “Sem lacunas detectadas” significa que os controles implementados não encontraram lacunas; não comprova captura perfeita.
3. Use “Baixar TXT” para obter a transcrição. Gravações parciais continuam exportáveis, com os avisos incluídos. Sem eventos válidos, o botão fica desabilitado.
4. Use “Reprocessar” para reler a fonte. A mesma fonte e versão reutilizam a identidade persistida; uma fonte ou versão diferente gera outra reconstrução, sem substituir a anterior.
5. Expanda “Rastreabilidade e versões preservadas” para consultar identificadores e comparar uma versão com a reconstrução atual.

Há estados de carregamento, falha com nova tentativa, gravação em andamento, gravação indisponível, falha ao salvar o histórico, falha no download e falha na comparação. A comparação é por posição dos comandos, não um alinhamento semântico: uma inserção pode causar várias diferenças subsequentes. A resposta mostra até 20 diferenças e prévias de 2.000 caracteres; os comandos preservados continuam integrais.

## Fonte e limites de interpretação

- O JSONL original não é alterado. Não se introduziram comandos de sondagem nem mudanças no transporte, resize ou área útil do terminal ao vivo.
- A reconstrução reconhece partes ausentes/vazias/ilegíveis, JSON/eventos inválidos, sequência ausente/repetida/fora de ordem e ausência de início/fim. Uma sessão em andamento não precisa ter evento final.
- Lacunas separam segmentos de interpretação, evitando concatenar entradas dos dois lados de um trecho perdido. Os comandos recebem aviso e confiança reduzida quando a fonte apresenta problemas.
- A proveniência é um intervalo de **eventos**, não uma atribuição byte a byte. Um evento de saída pode contribuir para mais de um comando.
- O SHA-256 identifica a fonte observada durante esta leitura. Não é assinatura, cadeia de custódia criptográfica nem prova contra alteração anterior à leitura.
- O TXT mantém o mascaramento já presente na captura; não recupera dados mascarados e não introduz um detector universal de segredos. Aplica as permissões administrativas e o isolamento por tenant já usados pela auditoria.
- Eventos inválidos não são inventados nem exportados como válidos: há diagnóstico e o JSONL continua sendo a fonte para investigação.

## Arquitetura e carga

`session-audit-reconstruction.ts` concentra a projeção pura e a transcrição. O serviço separado coordena autorização, leitura, concorrência e cache; o repositório cuida de persistência transacional. O componente `AuditReconstructionPanel.vue` apresenta os novos estados sem alterar o playback.

Controles por processo da API:

| Controle | Limite |
| --- | --- |
| Cache LRU | 32 MiB estimados e no máximo 64 entradas |
| Validade de captura encerrada | 60 segundos |
| Validade de captura em andamento | 2 segundos |
| Processamentos simultâneos | 2 |
| Processamentos em espera | 8; excesso retorna 503 |
| Fonte descompactada por reconstrução | 128 MiB; excesso retorna 413 |
| Inserção SQL | Lotes de até 100 comandos ou aproximadamente 1 MiB |
| Histórico retornado | 20 versões mais recentes |

Requisições simultâneas para a mesma sessão compartilham o processamento. A autorização é revalidada mesmo em acessos ao cache. O limite de descompactação protege contra arquivos gzip expansivos. Uma linha SQL individual maior que o lote não é truncada: se exceder o limite do banco, a transação falha e a interface informa que a versão não foi salva.

Comandos, estatísticas e leitura de eventos usam a mesma projeção. A listagem deixa de abrir todas as gravações para recalcular contagens. Contagens antigas ainda nulas dependem do contador/backfill existente; não há varredura automática na listagem.

O cache é local ao processo, não distribuído. Após expiração ou reinício, a projeção atual relê a fonte. A persistência SQL atende histórico e preparação para busca; não substitui essa verificação da captura. O limite do cache é uma estimativa e não um limite total de memória do processo.

## Banco, implantação e próxima etapa

Migração: `apps/backend/prisma/migrations/20260929000000_audit_reconstruction/migration.sql`.

As tabelas `session_audit_reconstructions` e `session_audit_derived_commands` preservam a versão do processador, fingerprint, metadados, comandos e saídas. A chave única impede duplicação de uma mesma sessão/fonte/versão. As consultas usam parâmetros e escopo de tenant. A exclusão física da auditoria remove as projeções por FK; o estado PURGED bloqueia leitura. Não foi adicionado um agendador de retenção nesta entrega: a política de descarte deve abranger também essas cópias derivadas.

Antes de disponibilizar o backend atualizado em outro ambiente, execute o procedimento habitual de `prisma migrate deploy` e build do pacote compartilhado. Mudanças futuras na interpretação devem incrementar `AUDIT_PROCESSOR_VERSION` para preservar comparabilidade.

A migração foi aplicada somente no desenvolvimento local. O deploy local também aplicou a migração aditiva de eventos TLS que já estava pendente. Não houve publicação em produção.

O índice FULLTEXT foi exercitado com MATCH e EXPLAIN em MySQL real. Ele cobre texto dos comandos, não saídas; busca textual tokenizada não equivale a substring. Só sessões encerradas abertas/reprocessadas ganham projeções nesta entrega. A etapa futura deve definir backfill em lotes, versão corrente por sessão, paginação, filtros de tenant/permissão e política de retenção antes de expor a busca global. Não há endpoint de busca global nem sua tela agora.

## API adicionada

Todos os caminhos abaixo são relativos a `/api/v1/session-audit/:sessionId`, exigem autenticação administrativa e validam o tenant da sessão:

| Método/caminho | Resultado |
| --- | --- |
| GET `/transcript` | TXT UTF-8, attachment, no-store e nosniff |
| GET `/reconstruction` | Estado e versão da projeção atual |
| POST `/reconstruction` | Nova leitura da fonte |
| GET `/reconstructions` | Histórico preservado |
| GET `/reconstructions/:runId/commands` | Comandos de uma versão |
| GET `/reconstructions/:runId/compare` | Comparação com a projeção atual |

## Validação

Resultado final: **220 testes passaram em 9 arquivos**, **8 cenários novos de interface passaram**, assim como a regressão do playback (desktop/mobile, erro, vazio, truncamento, sessão longa e 600 comandos). Typecheck de frontend/backend, build compartilhado, validação Prisma e lint dos arquivos novos passaram. Uma primeira execução encontrou timeout na importação dinâmica de uma fixture; a importação foi movida para o carregamento do módulo, sem relaxar o limite do teste, e a suíte completa passou novamente.

- Testes de projeção: colagem/edição/histórico de SQL, autoria, intervalos de eventos, Unicode, controles, mascaramento, lacunas, eventos inválidos e captura em andamento.
- Testes de serviço: cache, expiração, limite de entradas/memória, singleflight, reprocessamento concorrente, saturação, liberação da fila, falha de persistência, limite de captura e autorização após cache.
- Rotas: autenticação, papel administrativo, IDs inválidos, isolamento entre tenants e headers/conteúdo TXT.
- Storage: arquivo ausente, gzip corrompido, Unicode e limites de leitura/descompactação.
- MySQL 8.4 descartável: concorrência idempotente, rollback transacional, histórico, isolamento com controle positivo em outro tenant, índice FULLTEXT, PURGED e cascade sem remover dados do outro tenant.
- Integração local real: sessão 4177, 712 eventos, 10 comandos, TXT de 212.520 bytes, persistência, reprocessamento idempotente e comparação sem diferenças.
- Playwright: desktop e mobile, download e reprocessamento, comparação, fonte parcial/indisponível, falha de consulta com recuperação, falha de reprocessamento, download e histórico. Regressão adicional do playback com sessão longa e 600 comandos.

Os quatro JSONL originais não estavam mais em `imgs_debug` nesta revisão. Os oito testes dos casos 136/166/183/184 usam cópias locais dos eventos previamente preservados na análise anterior. Isso valida os eventos e a interpretação, **não os bytes originais dos arquivos**. Esses dados privados não foram adicionados ao repositório.

Comandos reproduzíveis:

```sh
AUDIT_EXPORT_REVIEW_DIR=/caminho/privado npx vitest run apps/backend/src/modules/session-audit
npm run typecheck --workspace @nodeaccess/backend
npm run typecheck --workspace @nodeaccess/frontend
npx tsx tools/session-audit/reconstruction-mysql-integration.mts
FRONTEND_BASE=http://127.0.0.1:5182 node tools/frontend/audit-reconstruction-playwright.cjs
FRONTEND_BASE=http://127.0.0.1:5182 node tools/frontend/session-playback-playwright.cjs
```

O teste MySQL exige um banco **descartável** em `127.0.0.1:13319/audit_reconstruction_test`; recria suas tabelas de teste. A revisão integrada local em `tools/session-audit/reconstruction-local-review.mts` lê a gravação existente e salva apenas a versão derivada. Capturas e relatórios sanitizados ficam em `docs/reviews/evidence/2026-09-29-audit-reconstruction`.
