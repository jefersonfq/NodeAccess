# NA-0092 — Evidências de CI real

## Execução local

Worktree `/tmp/nodeaccess-NA-0092`, Node24.21.0, base `4a77f7139600e70aa612e753418978d9b31b10ae`. GitHub ainda não executado; nenhuma publicação ou proteção de branch presumida.

- Ran: `node --test tools/sonarqube/*.test.mjs` com cobertura Node/V8 —61 testes PASS; novas ferramentas93,90%linhas/83,64%branches/85,71%funções. Medição focal, não substitui agregador NA-0090.
- Ran: validação YAML do workflow, triggers previstos, token read-only e runner Ubuntu hospedado —PASS.
- Ran: ensaio Docker real —PASS, três análises e cleanup completo. [Evidência sanitizada](rehearsal.json).
- Ran: governança do checkpoint inicial —PASS; delta final será validado no commit.
- Pending: revisão independente do delta e rotina completa do produto após integração do coletor NA-0090. O worktree desta frente não contém o coletor; não se presume que a fixture prove o gate de toda a aplicação.
- Pending: execução do workflow no GitHub após publicação autorizada. Nenhuma execução GitHub alegada.

## Ensaio real e correções observadas

ServidorSonar26.10/Postgres17.11 novos, porta dinâmica, imagens por digest. Primeira tentativa identificou senha hexadecimal incompatível com política do servidor (HTTP400 change_password); gerador agora mantém256bits aleatórios e classes maiúscula/minúscula/dígito/especial. Segunda incompatibilidade: grupo virtual Anyone ausente retorna404; somente essa combinação explícita é tolerada, e consulta anônima continua obrigatoriamente401/403. Outros erros de permissão interrompem o fluxo. Testes de regressão cobrem ambos.

A fixture executa testes Node com cobertura V8/LCOV real. Base foi analisada e seu ID configurado como SPECIFIC_ANALYSIS. Head coberto:4linhas novas,3linhas a cobrir,100%coverage e gateOK. Head com funções novas sem chamadas:42,9%coverage e gateERROR no limite80. `ignoredConditions=false` em ambos, inclusive abaixo de20linhas. Portanto o ensaio demonstrou que primeira análise/fudge factor não fabricam aprovação. A redução a42,9% (não0%) reflete linhas de declaração executadas ao importar o módulo e permanece reprovada corretamente.

Projeto privado, token de análise de projeto, token distinto com Browse, bloqueio anônimo e limpeza confirmados. Nenhum finding foi marcado como falso positivo/aceito na API. Servidor9000 preservado. Listagem final de contêineres `nodeaccess-ci-*` vazia.

## Modelo e limites

Cada job cria Sonar/Postgres novos com imagens fixadas por digest e porta loopback dinâmica. O projeto é privado, autenticação obrigatória, token de análise limitado ao projeto e usuário de consulta com Browse. A senha inicial é trocada antes da criação do projeto. Credenciais são efêmeras e não são recebidas do GitHub. Apenas JSON sanitizado é publicado como artefato por7dias; logs brutos e fontes não são enviados.

O baseline do candidato é validado pelo mesmo contrato individual existente, sem marcar findings como falsos positivos. O resumo registra hashSHA256, quantidade, bootstrap e diferença de ocorrências frente à base. Alterações de rationale/evidência também mudam o digest. A revisão humana do PR continua necessária; o workflow não configura proteção ou aprovação automaticamente.

SCM fica desativado somente nas duas análises efêmeras, para usar datas das análises como marca de alterações e evitar que commits anteriores ao job desapareçam do código novo. A análise da base é inicialização, jamais aprovação do candidato. Specific analysis aponta para esse ID. A cobertura real por Gitdiff/LCOV de80 é verificada independentemente, inclusive quando o gate não tem condições mensuráveis. Condições explicitamente ignoradas causam falha.

Cobertura roda antes do servidor. Falha de testes/gate não é convertida em sucesso: se a coleta gerou dados completos, o scanner ainda roda para diagnóstico e o resultado final falha. O gate70/70/60 conserva os serviços backend originais; medição global ampliada é informativa. Dados incompletos, fontes modificadas ou metadata incompatível interrompem a análise.

O runner Linux precisa Docker e `vm.max_map_count>=524288`. No GitHub o ajuste é temporário dentro da VM descartável; o script local apenas verifica. Execuções canceladas são finalmente descartadas com a VM hospedada. A remoção normal/falha usa os nomes únicos criados pela execução; nenhum recurso do servidor local9000 é reutilizado.

## Fontes oficiais consultadas em 03/11/2026

- [Sonar SCM integration](https://docs.sonarsource.com/sonarqube-community-build/analyzing-source-code/scm-integration): sem SCM, datas de análise identificam modificações.
- [Sonar new-code configuration](https://docs.sonarsource.com/sonarqube-community-build/project-administration/adjusting-analysis/configuring-new-code-calculation): Specific analysis configurado pela WebAPI.
- [Sonar quality gate e fudge factor](https://docs.sonarsource.com/sonarqube-community-build/project-administration/adjusting-analysis/changing-quality-gate-and-fudge-factor): `sonar.qualitygate.ignoreSmallChanges=false`.
- [GitHub secure use](https://docs.github.com/en/actions/reference/security/secure-use): token mínimo, mascaramento de valores efêmeros, ações fixadas porSHA e riscos de runners persistentes.
- [GitHub Docker service containers](https://docs.github.com/en/actions/tutorials/use-containerized-services/use-docker-service-containers): runner Linux e isolamento por job. Aqui o Docker inicia após cobertura para reduzir consumo simultâneo.

SHAs das ações confirmados por `git ls-remote` nos repositórios oficiais: checkoutv4.3.1, setup-nodev4.4.0 e upload-artifactv4.6.2. Imagens confirmadas por `docker image inspect`, sem alterar serviços existentes.
