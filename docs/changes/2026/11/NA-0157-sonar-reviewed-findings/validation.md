# Validação NA0157

Manifesto proposto:206 ocorrências(194 técnicas anteriores,3 de UI após correção de teclado/foco,9 novas). Cada entrada vincula fonte, blobGit, regra instalada, hash/range e evidência. Três riscos operacionais e credenciais corrigidas ficam excluídos. Nenhuma classificação foi aplicada ao projeto NodeAccess existente.

Revisão independente confirmou206 hashes de fonte e21 regras. Inventário anterior28a779 confirma201 identidades; cinco ranges mudaram com imports/hookCDP e só podem ser avaliados numa análise nova. O manifesto nunca autoriza reutilizar essa análise antiga.

Contratos:217PASS antes do reforço de Git;32contratos do reconciliador PASS após reforço de Git. Nova execução conjunta planejada. Revisão independente reproduziu73contratos de CI/reconciliador, apontou descrição real em descriptionSections, concorrência após comentário e intenção de journal; todos tratados com testes.

Ensaio real descartável: dois achados ANSI, falha parcial, retry semduplicação, idempotência e substituição por análise real confirmados. Primeira tentativa tinha casos sintéticos insuficientes e falhou; ensaio seguinte confundiu gate histórico poranalysisId com gate atual porprojectKey e falhou. Ensaio corrigido confirmou gateatual ERROR→OK semrescan, mantendo resultado histórico separado. Conta temporária desativada, tokenrevogado eprojetoremovido ao final. Versão com Git real está emexecução para comprovar também blob/HEAD/árvorelimpa.

Limitações: API não oferece compare-and-swap; GETimediato reduz, mas não elimina a janela de edição humana. Ator separado e privilégio restrito ao projeto, seguido de cleanup. Journal privado contém chaves para recuperação, resumo público preserva somente ID de revisão/ação/estado, sem chave do servidor. O CI ainda precisa executar no candidato final; não há homologação humana ou concessão local issueadmin.

Resultado final:222contratos PASS e labGitreal PASS. Evidência final em evidence/real-git-review.json; fonteGit/HEAD e análise correntes obrigatórios. Reviewindependente81contratos PASS, incluindo rejeição de manifesto rastreado removido. Ganho de cobertura desta frente ainda depende da execução integrada.
