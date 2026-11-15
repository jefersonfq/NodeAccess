# Reavaliação das 294 ocorrências

Estado atual: **Sonar A/A/A e Quality Gate OK**, commit 876966abc. Dos 294 itens originais: 98 FIXED,196 falsos positivos revisados e zero abertos. Histórico completo:572 ocorrências,366 FIXED/206 FALSE_POSITIVE. NA-0169 removeu TACACS+ legado e MD5. CI final da PR #60:16 checks distintos aprovados,release ignorada; Sonar hospedado aprovado com86,0% de cobertura nova. Homologação humana, merge da base #59 e desta frente pendentes. Avaliações históricas abaixo preservadas; estados atuais no JSON/CSV.





A tabela resume os estados confirmados na análise final local. CI também aprovado; homologação humana e merge permanecem pendentes.

| Estado atual das 294 ocorrências originais | Quantidade | Situação |
|---|---:|---|
| Corrigido (FIXED) | 96 | Confirmado pelo scanner |
| Falso positivo (FALSE_POSITIVE) | 197 | Decisão individual verificada |
| Aberto (OPEN) | 1 | MD5 TACACS legado; não aceito nem ocultado |

Os dois defeitos adjacentes de IPv6 e controles DCS estão registrados separadamente, sem aumentar o denominador original. A classificação histórica é preservada em `baselineClassification`; `currentAssessment` descreve a avaliação atual. Evidências de branches anteriores identificam a fonte testada naquela frente e não devem ser interpretadas como execução no candidato integrado.

Consulte [tabela CSV](remediation-progress.csv), [registro completo JSON](remediation-progress.json) e [diário](implementation.md).

## Histórico — avaliações anteriores à análise final

A análise verificada do commit `28a77996d` encontrou **211 ocorrências abertas**: 201 das 294 reavaliadas e dez novas. Das ocorrências originais, 93 deixaram de aparecer no export de itens abertos; isso não significa que todas foram corrigidas pelo mesmo mecanismo.

O manifesto propõe **206 revisões técnicas individuais** (194 anteriores, três de UI após corrigir teclado/foco e nove novas). Nenhuma foi aplicada ao projeto principal. NA0156 removeu um Secret sem consumidores e tornou efêmera a senha do teste negativo; ambos aguardam análise fresca. Os IDs antigos da [tabela completa](../../../../sonarqube/findings.html) foram preservados:569 ocorrências históricas acompanhadas.

NA0155 acrescentou testes HA e três harnesses obrigatórios. A coleta integrada antes da rotina NA0157 passou com80,03% do código alterado,3.609 testes Vitest e oito fluxos Chromium; o candidato final ainda será validado. Os limites70/70/60 dos97 serviços continuam atendidos. Consulte os campos `latestObservedAnalysis`, `newFindings` e `followupResolutions` no JSON para distinguir observação, implementação e proposta de revisão.

## Histórico — pendências operacionais anteriores

- SQ-0002: retenção e configuração persistente dos arquivos de auditoria; o default de desenvolvimento usa diretório temporário protegido.
- SQ-0003: retenção e compartilhamento dos avatares entre réplicas; confirmar armazenamento de produção.
- SQ-0030: MD5 faz parte da interoperabilidade TACACS+; qualquer aceite precisa considerar proteção da rede de gestão e seus segredos. Substituí-lo isoladamente quebraria o protocolo.

Nenhum risco foi aceito automaticamente. Nenhum gate ou baseline foi flexibilizado.
