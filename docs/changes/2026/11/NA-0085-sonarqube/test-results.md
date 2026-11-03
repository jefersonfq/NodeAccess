# NA-0085 — Resultados e limites

Estado inicial: LOCAL_WIP; configuração registrada posteriormente em 3aa551378. Base `f4a44b4b7ae87a8f688b1246d9e52a31f9a104bc`; fingerprint do candidato em [analysis-summary.json](analysis-summary.json). Gate da integração técnica: PASS_WITH_WARNINGS; gate de cobertura do produto: FAIL. Sem commit, push, PR, merge ou sincronização de entrega.

| Verificação | Execução / resultado |
|---|---|
| Inventário de versões/recursos/kernel | Ran: WSL Ubuntu20.04, Docker28.1.1/Compose2.35.1, Node24.21.0; ajuste temporário524288 autorizado |
| Compose/versionamento | Ran: config --quiet PASS; Sonar26.10.0.133078 e PostgreSQL17.11-bookworm disponíveis/instalados |
| Servidor | Ran: UP; banco healthy; porta127.0.0.1:9000; sem publicação PostgreSQL |
| Credenciais/acesso | Ran: senha inicial alterada, tokens separados; anônimo401, leitura200, admin403; [evidência](access-checks.json) |
| Scripts | Ran:16testes node:test PASS; sintaxe/diffcheck PASS; revisão independente PASS_WITH_WARNINGS |
| Baseline com cobertura | Ran duas vezes:2669passed/1timeout/121skipped. LCOV gerado na segunda execução com reportOnFailure, não transforma falha em PASS |
| Teste que falhou, isolado sem cobertura | Ran:18/18PASS; não elimina timeout sob instrumentação |
| Cobertura Vitest | Ran:40,91%linhas,40,22%funções,34,43%branches nos services backend; FAIL contra70/70/60 preservados |
| Scanner real | Ran duas análises:primeira3m41,525s e final3m18,725s, exit0; processamento finalSUCCESS |
| Exportação real | Ran:533issues e0hotspots, paginado completo, arquivos0600 em diretório0700 |
| Comparação | Mesmos533achados/0hotspots; não houve correção de produto nem redução alegada |
| Manual/terminal/PTY | Skipped: interface e transporte NodeAccess não alterados |
| CI enforcement, correções do legado e restore | Planned: escopos posteriores, sem execução nesta frente |
| Homologação humana | Manual: pendente; teste automatizado não a substitui |

## Quality Gate e cobertura

Primeira análise retornouOK com conditions=[]. Reanálise final retornouOK com3condições de código novo e `ignoredConditions=true`: new_coverage0, new_duplicated_lines_density0, new_violations0. Portanto o verde NÃO aprova a qualidade do legado nem significa cobertura suficiente. Não alteramos gate/limiares para obter esse resultado. Cobertura Sonar global10,2%, sobre denominador diferente dos services instrumentados pelo Vitest. [Resumo exato](analysis-summary.json).

## Achados e triagem

126bugs,187vulnerabilidades e220code smells classificados pelo scanner;18blocker,147critical,239major,129minor. São achados a revisar, não187vulnerabilidades confirmadas.209015linhas não comentadas. Nenhuma regra suprimida nem ocorrência marcada resolvida/aceita. [Triagem por amostra e lote proposto](triage.md).

AvisosUTF8 foram verificados: cinco arquivos válidos contendo U+FFFD intencional. Quatro arquivos novos sem blame devido a LOCAL_WIP. Não foi feito commit só para remover aviso.

## Correções necessárias da integração

- Preflight passou a rejeitar overrides agregados/Java encontrados pela revisão independente.
- Exportador recusou corretamente o contrato antigo; documentação real26.10 confirmou `components` para issues e `project` para hotspots. Corrigido com testes e reanálise.
- Telemetria é configuração de startup: settings API retornou400. Aplicada variável documentada e reinício antes de analisar.
- Grupo default não permite remover usuário; privilégios amplos foram retirados no servidor recém-criado e Browse concedido explicitamente ao usuário de consulta.
- Consulta da tarefa de processamento retornou403 ao usuário Browse; evidência obtida pelo token de análise, sem ampliar permissões do leitor.

## Proveniência e proteção

Sonar image digest `sha256:f95aaa9016dd4e92c7d70691167a6d96dbb5d8acffd61eba1cb4335d364a7840`; PostgreSQL `sha256:839fbb5a4942a7758dd93e18b42ea5649807491a0545b5eeeb8f0b8bb11857a5`. Scanner NPM5.0.2 verificado no registro oficial. Relatórios brutos privados ficam em /tmp/nodeaccess-NA-0085/.sonar-reports; logs do scanner não contêm tokens ativos conforme comparação local sem imprimir valores. Segredos fora do Git, diretório0700/arquivos0600 e proprietário jeferson. `.scannerwork` também protegido0700.

Evidências de execução locais: /tmp/na0085-baseline-coverage.log, /tmp/na0085-baseline-coverage-second.log, /tmp/na0085-baseline-timeout-isolated.log, /tmp/na0085-sonar-tests-final.log, /tmp/na0085-independent-tests-final2.log, /tmp/na0085-scanner-final.log. Resumos duráveis estão neste diretório; logs temporários não são arquivo permanente. Instância/volumes permanecem disponíveis ao usuário; nenhum recurso de outras stacks removido.

## Rotina normal e tabela — continuação autorizada

Ran:31 testes dos scripts/integrador PASS, incluindo falha de cobertura, task ausente/inconsistente, export concorrente, hotspots pendentes e segregação dos tokens. Revisão independente realizada com correções revalidadas. Harness `node tools/sonarqube/table-review.cjs` cobre filtros, detalhes, vazio, teclado e mobile com3capturas. `npm run validate:sonar` preserva falha da cobertura e exige análise atual; nenhum gate verde sem condições supera esses controles. Integração das frentes e reanálise são registradas na NA0089. Estado de publicação: apenas commits locais autorizados; homologação humana pendente.

## Resultado integrado atual

A tabela integral, correções por domínio, baseline contextual revisada e resultados posteriores estão na [NA-0089 — integração](../NA-0089-sonar-integration/README.md). Os números anteriores deste documento são a baseline histórica, não o estado final. As branches NA0086/87/88 preservam cada lote e sua evidência própria.
