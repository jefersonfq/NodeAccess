# Revisão independente da consolidação NA0093

Estado: **REVIEW_WITH_PENDING_GATES**, não aprovação final. Leitura de WIP em `/tmp/nodeaccess-NA-0093`, HEAD ee436402d com patches integrados; nenhum scanner, suíte ampla ou alteração de fonte executados nesta revisão.

## Integridade e cobertura
- 294 IDs e issueIds únicos, conjuntos exatamente iguais ao audit NA0145.
- 82 resoluções mapeadas aos 294, sem duplicata válida ou inconsistência id/issueId/rule. Os seis itens NA0151 sem issueId foram corretamente vinculados pelo ID estável.
- Reconciliação possui225issueIds únicos:195 technical_fp_supported e30 needs_reassessment. Destes30,16 já possuem correção e14 tiveram ocorrência removida.
- Partição final coerente:82code_correction +195technical_fp_supported +14source_occurrence_removed +3operational_risk =294.
- Três riscos remanescentes explícitos: SQ0002 auditoria/tmp, SQ0003 avatar/tmp e SQ0030 TACACS+MD5. Nenhum aceite humano ou mitigação operacional na VPS inferido.
- Fontes removidas: SQ0191/0192/0193/0199/0200/0201/0202/0203/0204/0205/0245 e SQ0456/0460/0520. Não devem ser fechadas como FP; aguardam scanner.

## Gerador e apresentação
A versão relida separa baselineClassification/baselineReason de currentAssessment/currentReason, corrigindo o status anterior de209itens ainda apresentados como não reconciliados. Os14 itens acima são exatamente os que chegam hoje ao fallback `elif rec` e recebem source_occurrence_removed.

Pendências de robustez: esse fallback é genérico demais para futuros registros; uma nova decisão needs_reassessment sem correção não necessariamente significa fonte removida. Preferir categoria explícita source_removed_pending_scanner (incluindo os3tooling) e rejeitar/quarentenar os demais. Acrescentar assertions contra duplicata, ID desconhecido e conflito id/issue/rule; dicionários atuais fariam overwrite silencioso se entradas conflitantes surgissem. Glob de resolution.json não é recursivo; não há recursão/duplicação efetiva hoje.

Dois achados relacionados NA0145-F02/F03 em NA0148 não pertencem aos294 e são ignorados pelo gerador atual. Raiz informou que incluirá relatedFindings separadamente; na última leitura essa seção ainda estava ausente. Não adicioná-los ao denominador294 nem perder suas evidências.

## Fingerprints pendentes
35registros de reconciliação têm hash anterior ao último patch da integração;16são itens agora corrigidos e19são FP. Os19FP: SQ0039–0049, SQ0053–0056, SQ0060/0061 (normalizer) e SQ0396/0397 (recent-host harness). As mudanças conhecidas são limitadas à extração firstprompt/ajustes anteriores e ao helperdata, portanto hash stale não prova regressão. Mas exige conferir ocorrência/linha contra fonte final e atualizar hash/evidência antes de afirmar195revisões frescas. Não substituir hash automaticamente sem conferir âncora. Hashes dos16corrigidos permanecem evidência histórica e devem ser identificados como tal, não atestado da fonte final.

## Limites
Não foram aplicadas transições no servidor nem aceites. Contagem de correções representa integração de código, não ausência confirmada de achados. Sonar/cobertura/checks conjuntos, atualização da planilha e homologação humana/publicação continuam independentes. Revisões/testes focais das frentes constam em seus documentos; esta rodada verificou somente consolidação, mapeamento e integridade documental.

Revisão registrada em 2026-11-04T11:57:04-03:00

## Complemento — candidato commitado28a77996deb4c004690e828c4a3a1f6dd292d198
Leitura final readonly confirmou HEAD exato e árvore limpa. Contagens294/82/195/14/3 e relatedFindings2 conferidas. Os195 hashesFP agora correspondem aos arquivos do candidato (zero stale); evidência histórica dos16corrigidos não foi confundida com aceitação de código atual.

FixturesGitleaks:48registros anteriores→47 atuais, nenhuma entrada path/rule nova; removida exclusivamente allowance restoreMySQL obsoleta. Cinco registros restantes tiveram hash/linha atualizados (incluihelm autorizado antes da proposta final): em todos, linha literal anterior/atual byteidêntica e hash atual válido. A proposta final de quatro revalidações é subconjunto dessas cinco. Não houve ampliação de regra/path wildcard ou inclusão de novo segredo. A contagem46 reportada pelo scanner representa findings efetivos e não o número47 de registros do catálogo.

Nenhuma alteração em sonar-project.properties, tools/coverage, tools/sonarqube ou thresholds/baseline nesta diferença ee436..28a779. Workflowagent acrescenta gatilho tools/shared e teste nativo de executable boundaries, sem retirar gate. Composição TerminalPane/SessionAuditDetail mantém clientWorker, estado visível de pausa e parsingDCS; circuito permanente e telemetria sem duração inventada presentes. Restore preserva ancestorcheck/fchmodFDnovo/segredosrandômicos e cleanupowned. Ajustes de tipos e ordenação previamente revisados permanecem no candidato.

Parecer de código/composição: **PASS_WITH_WARNINGS para esta revisão readonly**, não aprovação final de entrega. Não executei suites durante o fullvalidation concorrente. Cobertura e Sonar desteSHA ainda pendentes; nenhuma ausência de achado ou aceite operacional/humano inferidos. Limites de CPU residual do Worker, filesystem confiado frente ao mesmoUID/root, diferenças textuais de espaços renderizados e ensaios com API/DB simulados continuam nos documentos das frentes.

Complemento registrado em 2026-11-04T12:04:35-03:00
