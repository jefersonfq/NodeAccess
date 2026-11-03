# NA-0131 — Evidências

Base 8dae9b49a8dab89b9c0a7c4fcb4a29a1d401662d, execução em /tmp/nodeaccess-NA-0131.

- Ran: 154 contratos Sonar PASS antes da separação por responsabilidade do helper; /tmp/NA0131-all-tests.log.
- Ran: 40 contratos focais ci-new-code/ci-run PASS após separação validatedPage/diagnosticIssue; /tmp/NA0131-final-focal.log.
- Ran: ESLint quatro arquivos zero erros/warnings e diff-check limpo.
- Ran: negativos para API, totais mutáveis, paginação incompleta, duplicatas e diferenças em regra/arquivo/hash/linha; saída não inclui message, author, textRange ou resposta de erro.
- Ran: integração de orquestração mantém gate ERROR mesmo com signaturePresentInReviewedBaseline=true; cleanup permanece completo. Guarda latest antes/depois envolve export e consulta adicional; mudança de análise rejeitada.
- Manual: raiz consultou contrato oficial Community26.10 via api/webservices/list; confirmou inNewCodePeriod/components/resolved e paginação.
- Ran: reprodução real do snapshot8dae, LCOV preexistente validado por SHA/fingerprint, duas análises e configurações efetivas comprovadas em servidor efêmero. Diagnóstico capturado e cleanup completo. Gate continuou ERROR/new_violations=1; cobertura80.1. Não é execução do candidato final nem substitui coleta integrada. Snapshot do helper antes da separação identificado por SHA256 em rehearsal.json.
- Ran: revisão independente da raiz PASS_WITH_WARNINGS; 40 testes reproduzidos antes do último guard; separação e guard finais revisados em leitura, 40 finais executados pelo autor.

## Limites

Assinatura presente na baseline é evidência de correspondência, não decisão automática de falso positivo nem exceção para new_violations. API de diagnóstico tem falha fechada e pode impedir aprovação quando indisponível. Nenhum token, texto de achado ou trecho de código é persistido pelo novo resumo. Testes unitários simulam API; ensaio real é reportado separadamente.

## Resultado real

Única ocorrência em código novo: javascript:S4036 em tools/sonarqube/analyze.mjs:46. Assinatura presente na baseline revisada, porém gate rejeitado corretamente. Correção de resolução do executável será frente separada, sem exceção de gate. Relatório completo sanitizado em rehearsal.json; logs privados apagados pelo cleanup.
