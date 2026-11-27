# Retomada econômica sem perder validação

1. Leia `ai/context.md`, `ai/patterns.md` e o plano/último resumo da frente. Não carregue o histórico inteiro.
2. Execute `npm run quality:context`. O comando só lê Git e evidências locais; não usa rede, API de IA nem token Sonar. Árvore suja, SHA diferente ou execução incompleta não são apresentados como gate validado.
3. Use `git diff --stat`, depois o diff dos arquivos afetados. Para Sonar, filtre por estado/rule/path e investigue uma ocorrência por vez; não cole o catálogo integral no chat.
4. Salve logs brutos em arquivo privado e traga resumo/trecho de falha. Imagens apenas quando layout ou interação precisarem de inspeção.
5. Teste o trecho durante edição; congele o candidato e rode os gates obrigatórios uma vez. Repetir somente após mudança, falha ou dúvida concreta. Não reaproveite cobertura/Sonar de outro SHA para aprovar entrega.
   - Antes de iniciar uma suíte longa, registre SHA, motivo, escopo e evidência faltante. Se o mesmo SHA limpo já passou e os inputs não mudaram, consulte o relatório em vez de reexecutar.
   - Falha interrompe a sequência: preserve o resultado, diagnostique e execute primeiro o teste focal. Não faça retry automático da suíte completa.
   - Deploy retoma da última etapa comprovada (artefato, transferência, backup, migração, ativação); não reinicia build/Sonar por sessão perdida ou diário desatualizado.
   - Use um único executor para cada gate longo, logs em arquivo e consultas espaçadas. Não abra agentes para repetir a mesma validação.
6. Consulte CI com resumo e intervalos compatíveis com duração do job. Não repetir scan por polling nem reconstruir evidência já existente.
7. Faça handoff curto com objetivo, branch/SHA, arquivos, decisões, testes realmente executados, limitações e próximo passo. Delegação usa contexto mínimo e responsabilidade delimitada; revisão independente continua separada da implementação.

`quality:context` é índice informativo: não comprova o CI remoto, operação em produção, assinatura dos relatórios ou homologação humana. A tabela canônica em docs pode pertencer a outro SHA; o comando indica isso. Detalhes e fontes em `docs/DEVELOPMENT-token-efficiency.md`.
