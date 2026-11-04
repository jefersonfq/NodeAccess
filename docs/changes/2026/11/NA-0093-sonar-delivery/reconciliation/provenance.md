# Proveniência da reconciliação

Os registros de reconciliação identificam a fonte efetivamente inspecionada naquela revisão. Uma correção posterior pode mudar o hash do componente sem invalidar a evidência histórica: não substituir hashes antigos por valores novos sem nova inspeção.

Na integração NA0146–0154 foram detectados35 hashes diferentes da revisão anterior:19 ocorrências classificadas tecnicamente como falso positivo exigem reconferência da fonte atual;16 registros correspondem a correções posteriores já associadas a resolution.json. A confirmação final de presença/ausência cabe à análise real do candidato.

Não houve transição de estado no SonarQube durante esta consolidação. A coluna currentAssessment da tabela é proposta técnica, não o estado do servidor. As2 ocorrências adjacentes são armazenadas fora das294 originais.

Revalidação posterior:19/19 propostas FP reconferidas contra o snapshot original e fonte integrada, anchors preservados,16 verificações sobre funções reais aprovadas. Valores anteriores preservados em previousReviewedSourceSha256; justificativas e limitações em finalSourceRevalidation. Os16 registros de correções conservam hashes históricos, e sua confirmação atual pertence às frentes de resolução e ao próximo scanner.
