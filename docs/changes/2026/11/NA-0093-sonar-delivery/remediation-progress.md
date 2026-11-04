# Reavaliação das 294 ocorrências

Estado atual: **Quality Gate OK** no commit 025e82863. Revisão autorizada aplicada a206falsos positivos; conta temporária desativada. Dos294itens originais,197são falsos positivos confirmados,94estão FIXED e3riscos operacionais permanecem abertos. O catálogo histórico completo contém569ocorrências. Os registros abaixo preservam avaliações anteriores; os estados atuais estão no JSON/CSV e na tabela geral. CI hospedado e homologação humana permanecem pendentes.



Esta tabela descreve o candidato integrado. Ainda não substitui a análise final do SonarQube nem indica fechamento de itens no servidor.

| Avaliação atual | Quantidade | Próximo gate |
|---|---:|---|
| Correção no código integrada | 82 | Testes combinados e scanner |
| Falso positivo com justificativa individual | 195 | Conferir fonte final e ocorrência no scanner |
| Ocorrência removida da fonte | 14 | Confirmar desaparecimento no scanner |
| Risco operacional | 3 | Configuração e decisão operacional |

Os dois defeitos adjacentes de IPv6 e controles DCS estão registrados separadamente, sem aumentar o denominador original. A classificação histórica é preservada em `baselineClassification`; `currentAssessment` descreve a avaliação atual. Evidências de branches anteriores identificam a fonte testada naquela frente e não devem ser interpretadas como execução no candidato integrado.

Consulte [tabela CSV](remediation-progress.csv), [registro completo JSON](remediation-progress.json) e [diário](implementation.md).

## Resultado observado e correções adicionais

A análise verificada do commit `28a77996d` encontrou **211 ocorrências abertas**: 201 das 294 reavaliadas e dez novas. Das ocorrências originais, 93 deixaram de aparecer no export de itens abertos; isso não significa que todas foram corrigidas pelo mesmo mecanismo.

O manifesto propõe **206 revisões técnicas individuais** (194 anteriores, três de UI após corrigir teclado/foco e nove novas). Nenhuma foi aplicada ao projeto principal. NA0156 removeu um Secret sem consumidores e tornou efêmera a senha do teste negativo; ambos aguardam análise fresca. Os IDs antigos da [tabela completa](../../../../sonarqube/findings.html) foram preservados:569 ocorrências históricas acompanhadas.

NA0155 acrescentou testes HA e três harnesses obrigatórios. A coleta integrada antes da rotina NA0157 passou com80,03% do código alterado,3.609 testes Vitest e oito fluxos Chromium; o candidato final ainda será validado. Os limites70/70/60 dos97 serviços continuam atendidos. Consulte os campos `latestObservedAnalysis`, `newFindings` e `followupResolutions` no JSON para distinguir observação, implementação e proposta de revisão.

## Pendências operacionais

- SQ-0002: retenção e configuração persistente dos arquivos de auditoria; o default de desenvolvimento usa diretório temporário protegido.
- SQ-0003: retenção e compartilhamento dos avatares entre réplicas; confirmar armazenamento de produção.
- SQ-0030: MD5 faz parte da interoperabilidade TACACS+; qualquer aceite precisa considerar proteção da rede de gestão e seus segredos. Substituí-lo isoladamente quebraria o protocolo.

Nenhum risco foi aceito automaticamente. Nenhum gate ou baseline foi flexibilizado.
