# NA-0085 — Triagem inicial da análise SonarQube

Esta é uma triagem por amostra, não revisão completa nem certificação de segurança. Nenhum achado foi marcado como resolvido/aceito/falso positivo no servidor e nenhuma regra foi desativada. Os relatórios brutos ficam privados em `.sonar-reports` no worktree.

Primeira análise:533issues, sendo126BUG,187VULNERABILITY e220CODE_SMELL;18BLOCKER,147CRITICAL,239MAJOR e129MINOR. Esses nomes são classificações do scanner, não riscos comprovados. Hotspots retornados:0; não significa ausência de risco.209015linhas não comentadas; cobertura global Sonar10,2%, distinta da cobertura limitada do Vitest40,91%de linhas nos services backend.

**Primeira baseline: Quality Gate OK com conditions=[]. Reanálise final: OK com3condições e ignoredConditions=true (new_coverage0, new_violations0).** Não usar esse verde como aprovação do legado ou substituto da falha de cobertura/testes. Política de novo código e enforcement de CI ainda precisam ser definidas; sem mudanças silenciosas de gate nesta frente.

## Amostras verificadas no código

| Achado | Evidência/contexto | Tratamento proposto |
|---|---|---|
| S2189, esperas sem deadline | tools/frontend/observability-resilience-playwright.cjs:62; terminal-lifecycle-review-playwright.cjs:92; hosts-acl-resilience-playwright.cjs:167,203,244 | Laços aguardam callbacks de rede sem prazo local. Candidato de baixo risco para primeiro lote de até5correções: timeout explícito com diagnóstico e execução dos respectivos harnesses, preservando assertivas. Não corrigido nesta implantação. |
| S2068, senha literal em exemplos | auth.routes.ts:19 e host.routes.ts:46, blocos de exemplos OpenAPI | Literais de instrução ao usuário, não credenciais operacionais identificadas nessa amostra. Candidatos a falso positivo; confirmar com revisão humana, sem suprimir regra ou alterar auth. Outros casos não foram automaticamente absolvidos. |
| S4790, MD5 | network-access/tacacs-protocol.ts:17 | Implementa ofuscação legada do protocolo, não criptografia de transporte. Trocar algoritmo isoladamente quebra interoperabilidade; requer revisão de protocolo e política de rede protegida. Não alterado. |
| S4830/S5527, TLS sem validação | tools/deploy/engineering-security-headers-harness.py:24 | Harness de headers aponta para127.0.0.1 e usa ambiente descartável. Confirmar que essa exceção não pode atingir destino arbitrário; não generalizar para código produtivo. |
| S5852, regex | SessionAuditDetailView.vue:834,961 | Potencial custo patológico com entradas longas da saída remota. Exige reprodução com limites/tamanho e regressão de auditoria; não corrigir às cegas em domínio crítico. |
| S6697, possível segredo | Exemplos em tools/deploy e arquivos de tradução antigos | Não reproduzir valores nos relatórios públicos. Referências de laboratório e strings documentais precisam ser distinguidas de segredos reais, inclusive histórico, antes de decidir rotação/supressão. Sem afirmação de inexistência de segredo em toda a base. |
| S5443/S4036, temporários e execução de processos | Concentração em harnesses/scripts operacionais | Revisar mkdtemp/permissões, diretório confiável, argumentos e PATH por ocorrência. Não excluir tools do scanner para remover os achados. |

## Avisos do scanner e baseline

Os cinco avisos de encoding em auditoria foram conferidos com decodificação UTF-8 estrita: arquivos válidos com literal U+FFFD usado propositalmente em testes/diagnóstico. Não houve conversão de encoding nem alteração de auditoria. Os quatro arquivos novos da integração ainda não têm blame porque estão LOCAL_WIP; nenhum commit foi criado para eliminar o aviso.

Vitest com cobertura falhou em timeout de5000ms no teste de exportação TXT fragmentada, mesmo com2workers. O arquivo isolado sem cobertura passou18testes. Isso indica diferença sob instrumentação/execução conjunta; não prova regressão causada pelo Sonar nem autoriza elevar timeout. Tratar separadamente com evidência de performance, sem tocar produção nesta frente.

## Sequência recomendada

1. Homologar uso local, acesso e retenção/backup do SonarQube.
2. Lote pequeno dos cinco waits de harness acima, com falha simulada e execução dos harnesses; reanalisar e comparar IDs, não só total.
3. Revisar achados de credenciais, diretórios temporários e execução de processos com responsáveis; domínios críticos exigem autorização explícita do roteiro.
4. Planejar cobertura frontend/shared/agent e serviços faltantes com testes de comportamento. Não alterar denominador/threshold para obter verde.
5. Definir baseline de novo código e política de CI compatíveis com Community. Nenhum gate externo foi habilitado.
