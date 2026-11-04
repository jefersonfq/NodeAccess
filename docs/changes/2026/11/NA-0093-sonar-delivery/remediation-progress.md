# Reavaliação das 294 ocorrências

Esta tabela descreve o candidato integrado. Ainda não substitui a análise final do SonarQube nem indica fechamento de itens no servidor.

| Avaliação atual | Quantidade | Próximo gate |
|---|---:|---|
| Correção no código integrada | 82 | Testes combinados e scanner |
| Falso positivo com justificativa individual | 195 | Conferir fonte final e ocorrência no scanner |
| Ocorrência removida da fonte | 14 | Confirmar desaparecimento no scanner |
| Risco operacional | 3 | Configuração e decisão operacional |

Os dois defeitos adjacentes de IPv6 e controles DCS estão registrados separadamente, sem aumentar o denominador original. A classificação histórica é preservada em `baselineClassification`; `currentAssessment` descreve a avaliação atual. Evidências de branches anteriores identificam a fonte testada naquela frente e não devem ser interpretadas como execução no candidato integrado.

Consulte [tabela CSV](remediation-progress.csv), [registro completo JSON](remediation-progress.json) e [diário](implementation.md).

## Pendências operacionais

- SQ-0002: retenção e configuração persistente dos arquivos de auditoria; o default de desenvolvimento usa diretório temporário protegido.
- SQ-0003: retenção e compartilhamento dos avatares entre réplicas; confirmar armazenamento de produção.
- SQ-0030: MD5 faz parte da interoperabilidade TACACS+; qualquer aceite precisa considerar proteção da rede de gestão e seus segredos. Substituí-lo isoladamente quebraria o protocolo.

Nenhum risco foi aceito automaticamente. Nenhum gate ou baseline foi flexibilizado.
