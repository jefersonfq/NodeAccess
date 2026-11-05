# SonarQube — integração e consulta

[Tabela com filtros](../../../../sonarqube/findings.html) · [CSV](../../../../sonarqube/findings.csv) · [JSON](../../../../sonarqube/findings.json) · [Branches e recuperação](branches.md) · [Testes e limites](test-results.md)

539 ocorrências acompanhadas:533 originais e6 descobertas na reanálise. Todas têm decisão, justificativa, evidência e branch. A tabela separa correção de código, revisão contextual e presença/ausência na análise; nenhuma regra foi desativada. O inventário preserva ocorrências corrigidas e IDs de consulta estáveis.

Código consolidado em `chore/NA-0089-20261103-sonar-integration`; origem separada emNA0085(configuração/rotina),NA0086(backend/shared/agent),NA0087(frontend) eNA0088(ferramentas). Workspace principal contém outras frentes e permanece preservado; esta documentação também é sincronizada em NodeAccess-current/docs.

Rotina normal: `npm run validate:sonar`, com Node24.21+ e tokens locais separados conforme [operação](../../../../OPERATIONS-sonarqube.md). CI existente executa os testes dos validadores. Scanner real exige ambiente que alcance o Sonar local; não foi inventada conexão de runner GitHub com WSL.

**Gate de cobertura reprovado.** Suite final2714PASS/124skipped; cobertura41,03%linhas/40,34%funções/34,63%branches versus70/70/60. São testes opt-in não ativados no run normal; uploadSFTP real foi executado separadamente3PASS. O servidor também exige80%de cobertura de código novo. Os thresholds foram preservados.

Revisão independente abrange backend,frontend,ferramentas,rotina e baseline235assinaturas/295ocorrênciascontextuais. Foram encontrados e corrigidos durante as revisões: promptsCR/LF, referências da baseline, labels sem associação nativa, strictmode deslocado e cleanup de navegador após falha de captura.

Homologação humana permanece pendente. Somente commits locais autorizados; sem push,PR,merge da master ou deployVPS. Resultado final da reanálise e proveniência são registrados em test-results.md/evidência; nenhum teste automatizado substitui aprovação humana.
