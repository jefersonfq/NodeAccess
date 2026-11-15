# NA-0170 — Revisão do TOTP da fixture ZAP

Estado: revisão técnica concluída; decisão individual autorizada e aplicada após validação do candidato. Revisor temporário desativado e token revogado; credenciais de leitura preservadas. Nenhuma regra, exclusão, limiar ou estado do Sonar foi alterado para esse item.

## Achado
Sonar python:S4790 em tools/security/zap-driver.py sinaliza HMAC-SHA1. Nesta instalação o item apareceu como vulnerabilidade crítica, não como hotspot pendente. Identificador observado: d7704a4c-bdcf-47e6-acb5-4acfbd772b77; a posição pode mudar após comentários.

## Contexto e evidência
O driver gera TOTP de seis dígitos e intervalo de 30 segundos para uma conta MFA criada exclusivamente no banco descartável do laboratório. O segredo tem 20 bytes, gerado pelo speakeasy. A implementação corresponde ao algoritmo padrão usado pelo verificador real do backend. Não é hash de senha nem assinatura digital, não usa contas reais e não adiciona SHA1 ao produto.

Revisor independente verificou o backend e o pacote instalado e executou seis vetores SHA1 do RFC6238 Appendix B, adaptados de oito para seis dígitos: todos passaram, incluindo zeros à esquerda e timestamp futuro. Os mesmos seis vetores foram incorporados ao teste Python; suite16/16 aprovada. Trocar somente o driver por SHA256 quebra interoperabilidade e elimina a validação real de MFA. O HMAC permanece explícito para análise; não há NOSONAR, exclusão, usedforsecurity=False ou disfarce da chamada.

## Conclusão técnica proposta
Não foi demonstrada vulnerabilidade neste uso restrito. Proposta: classificar somente este item como falso positivo contextual após validação final e autorização específica, com comentário remetendo a esta evidência. Não aceitar risco genérico, não desabilitar regra e não alterar estados de outros achados. A autorização antiga para 206 decisões não é presumida para este novo item.

## Evolução
Avaliar algoritmo TOTP explícito e migração compatível em frente futura. O NIST prevê a transição de SHA1 em todas as aplicações até31/12/2030; esta revisão não afirma conformidadeFIPS nem segurança indefinida. A migração de MFA do produto exige avaliação de clientes e dados fora desta integração de ferramentas.

## Fontes primárias
- [RFC6238 — algoritmo e vetores](https://www.rfc-editor.org/rfc/rfc6238.html).
- [RFC4226 — análise HMAC-SHA1, apêndiceB](https://www.rfc-editor.org/rfc/rfc4226.html).
- [NIST — transição SHA1](https://csrc.nist.gov/news/2022/nist-transitioning-away-from-sha-1-for-all-apps).

## Demais achados da rodada
Cinco itens foram corrigidos no código: asserção explícita no teste SFTP; comparadores explícitos na normalização dos relatórios de mutação/ZAP; validação de IDs de recursos extraída do bloco finally, preservando rejeição e cleanup.71contratos aprovados. Nova análise final em preparação; a correção não é declarada encerrada apenas por inspeção local.
