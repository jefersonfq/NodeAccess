# Retomada econômica sem perder validação

1. Leia `ai/context.md`, `ai/patterns.md` e o plano/último resumo da frente. Não carregue o histórico inteiro.
2. Execute `npm run quality:context`. O comando só lê Git e evidências locais; não usa rede, API de IA nem token Sonar. Árvore suja, SHA diferente ou execução incompleta não são apresentados como gate validado.
3. Use `git diff --stat`, depois o diff dos arquivos afetados. Para Sonar, filtre por estado/rule/path e investigue uma ocorrência por vez; não cole o catálogo integral no chat.
4. Salve logs brutos em arquivo privado e traga resumo/trecho de falha. Imagens apenas quando layout ou interação precisarem de inspeção.
5. Teste o trecho durante edição; congele o candidato e rode os gates obrigatórios uma vez. Repetir somente após mudança, falha ou dúvida concreta. Não reaproveite cobertura/Sonar de outro SHA para aprovar entrega.
6. Consulte CI com resumo e intervalos compatíveis com duração do job. Não repetir scan por polling nem reconstruir evidência já existente.
7. Faça handoff curto com objetivo, branch/SHA, arquivos, decisões, testes realmente executados, limitações e próximo passo. Delegação usa contexto mínimo e responsabilidade delimitada; revisão independente continua separada da implementação.

`quality:context` é índice informativo: não comprova o CI remoto, operação em produção, assinatura dos relatórios ou homologação humana. A tabela canônica em docs pode pertencer a outro SHA; o comando indica isso. Detalhes e fontes em `docs/DEVELOPMENT-token-efficiency.md`.
