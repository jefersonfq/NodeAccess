---
change_id: NA-0085
title: SonarQube local e remediacao supervisionada
type: chore
status: in-development
created_at: 2026-11-03T13:42:00-03:00
base_branch: master
base_sha: f4a44b4b7ae87a8f688b1246d9e52a31f9a104bc
branch: chore/NA-0085-20261103-sonarqube
owner: NodeAccess
planner: Codex
risk: medium
---

# NA-0085 — SonarQube local e análise supervisionada

- Estado: ready-for-review / LOCAL_WIP para instalação, scanner, exportação e triagem inicial. GO_WITH_RISKS: preparação autorizada pelo pedido de iniciar o roteiro; ajuste de kernel exige confirmação separada prevista no próprio roteiro.
- Data: 2026-11-03, America/Sao_Paulo.
- Branch: chore/NA-0085-20261103-sonarqube.
- Base SHA: f4a44b4b7ae87a8f688b1246d9e52a31f9a104bc (master/origin-master locais coincidem; sem fetch/publicação nesta frente).
- Worktree: /tmp/nodeaccess-NA-0085, para preservar documentação dirty e frentes NA-0081/82/83/84. Docs canônicos em NodeAccess-current/docs.

## Pedido e problema

Executar o roteiro README_SONARQUBE_NODEACCESS_AGENT.md: análise estática local, evidências e correções pequenas supervisionadas. Não existe servidor SonarQube acessível na porta9000. O Docker usa kernel WSL com vm.max_map_count65530, abaixo do requisito524288. Node padrão20 não atende engines; Node24.21.0 já instalado será usado sem atualizar dependências.

## Escopo autorizado

1. Inventário, versões verificadas e Compose versionado/reproduzível com runtime e secrets fora do repositório, bind127.0.0.1, volumes separados e nenhum serviço existente alterado.
2. Configuração de análise do monorepo, fontes/testes separados, exclusões apenas de artefatos gerados, cobertura real sem reduzir thresholds.
3. Scanner NPM fixado, validação local de configuração/credencial e exportador paginado de issues/hotspots/Quality Gate com limites, retries e dados privados ignorados pelo Git.
4. Se requisito do kernel for aprovado, instalar stack local, trocar senha inicial, projeto privado/token de análise restrito, analisar e exportar. Sem aprovação: concluir preparação/testes independentes e registrar bloqueio específico.
5. Triar resultado real; no máximo5correções de baixo risco por lote, sem tocar domínios críticos sem autorização específica. Nova análise necessária para alegar redução de achados.
6. Registrar frente no planejamento vivo e documentação.

Fora: publicação Git/VPS/CI enforcement, alteração de autenticação/RBAC/criptografia/auditoria/tenant do produto, dependências do NodeAccess, sysctl persistente, exposição LAN, remoção de volumes, exclusões para melhorar nota.

## Aceite e validação

- Compose parseia com versões oficiais verificadas, sem credenciais reais no repositório, rede local e persistência.
- Pré-check recusa host remoto, token ausente, Node incompatível, LCOV ausente e condição incompleta; scanner versionado sem parâmetros contendo segredos.
- Relatório pagina corretamente, trata erros/timeout/retry e não aceita redirect com credencial; testes sintéticos independentes e validação real quando servidor disponível.
- Baseline Vitest coverage preserva configurações/thresholds; falhas preexistentes não são ocultadas ou chamadas de PASS.
- Servidor UP, análise processada, Quality Gate e limitações registrados somente quando observados.
- Nenhuma mudança crítica automatizada; revisão independente da frente e testes aplicáveis antes do fechamento técnico.

## Riscos e recuperação

SonarQube consome memória/CPU e usa Elasticsearch; limite do kernel afeta o host, portanto aprovação explícita antes do ajuste. Relatórios contêm caminhos/trechos de código: privados, ignorados pelo Git e sem upload externo. Community Build não implica recursos comerciais de branches/PRs. Cobertura atual só instrumenta services do backend: reportar limite, não excluir frontend do denominador.

Parar apenas o projeto Compose desta frente sem -v. Volumes persistem. Nenhum rollback de banco NodeAccess. Remover configuração/scripts da frente reverte integração; nunca apagar credenciais/volumes silenciosamente.

## Decisão posterior

Usuário autorizou explicitamente o ajuste temporário vm.max_map_count524288 e o início dos serviços. Aplicado sem persistência. Credenciais e runtime ficam em /home/jeferson/services/sonarqube. Baseline instrumentado tem timeout preexistente e cobertura abaixo dos thresholds; não autoriza mudar teste ou domínio crítico. A frente prossegue como inventário real de qualidade, sem promessa de gate verde.

## Fechamento deste corte

Fases1–3 executadas localmente;16testes dos scripts e revisão independentePASS_WITH_WARNINGS. Duas análises reais completas,533achados, gateOK com ressalvas registradas. Baseline de cobertura do produto permaneceFAIL. Fases4–6: lotes de correção, CI e testes complementares seguem planejamento; nenhuma correção crítica ou publicação autorizada por inferência.

## Ampliação autorizada — remediação integral e rotina (03/11/2026)

Usuário autorizou explicitamente todos os achados, commits locais e branches separadas para recuperação. Escopo ampliado: inventário integral consultável/CSV, decisões por ocorrência, correções por domínio, rotina obrigatória SonarQube e testes/simulações/capturas proporcionais. Não há autorização inferida para push, merge da master ou VPS.

Configuração inicial registrada em3aa551378. Frentes filhas sobre esse checkpoint: NA-0086 backend/shared/agent(98achados), NA-0087 frontend(165), NA-0088 tools/scripts(270). Branch de integração separada reunirá os commits para reanálise final sem alterar a branch atual do usuário. Cada merge/lote será reversível no Git; rollback de dados não é inferido.

Aceite adicional: todos533IDs com disposição individual, não apagar originais quando corrigidos; achados novos entram como pendentes. Falsos positivos/contexto esperado exigem evidência específica, não supressão em massa. `validate:sonar` preserva falha de cobertura/testes, verifica taskSUCCESS e análise correspondente antes/depois de exportar, rejeita resultados obsoletos e achados não revisados. Baseline de ocorrências revisadas usa regra/caminho/hash de conteúdo com multiplicidade, não IDs de servidor. Alterações da baseline precisam de revisão independente. GitHubCI testa os validadores; análise real roda localmente com tokens separados, sem fingir que runner remoto alcança WSL.

## Contexto e situação anterior

Não havia SonarQube local no início; primeira análise identificou533achados. O código funcional e as demais frentes foram preservados em worktrees separados.

## Problema e objetivo

Tornar análise/triagem reproduzíveis, registrar todos os achados e impedir que gate verde sem condições oculte falhas reais de testes/cobertura.

## Escopo

Configuração local, inventário consultável, rotina de validação e governança da remediação integral autorizada. Correções funcionais pertencem às branches NA-0086/87/88; integração terá checkpoint próprio.

## Critérios de aceitação

- [x] Instância local privada, scanner e exportação integral validados.
- [x] Tabela preserva533achados originais e permite consulta/CSV.
- [x] Comparação recusa achados novos/duplicados não revisados e falhas de cobertura/testes.
- [ ] Todos os achados com disposição e revisão independente, após integrar as frentes filhas.
- [ ] Reanálise final identifica exatamente o candidato integrado, com prints/regressões aplicáveis.

## Estratégia técnica

Scripts Node sem dependências novas; projetoCommunity local; tokens separados; baseline por regra/caminho/hash de conteúdo e multiplicidade. UI de relatório estática escapada, sem mensagens que possam conter segredos. Documentação canônica em docs do projeto atual.

## Riscos e mitigações

Mudanças em parsers/storage/UX podem afetar operação: branches por domínio e testes negativos/de regressão, revisão independente e integração separada. Relatórios privados não são publicados em Git; tabela sanitizada não contém mensagens/trechos/credenciais. Falha de cobertura permanece explícita.

## Matriz de testes e evidências

Scripts: node:test; tabela: browser desktop/mobile, filtros/teclado/empty e capturas; infraestrutura: Compose/API/políticas de acesso; produto: suites por domínio nas frentes filhas. Histórico e resultados em test-results.md; resultados novos devem registrar limitações reais, sem substituir evidência anterior.

## Baseline

Base f4a44b4b7ae87a8f688b1246d9e52a31f9a104bc;533achados,209015linhas não comentadas, cobertura global10,2%. BaselineVitest instrumentada teve1timeout e cobertura40,91%nos services contra70%exigido. Nenhum threshold alterado.

## Rollback ou recuperação

Branches e commits separados permitem recuperar cada lote. Reverter integração de ferramentas não remove volumes/credenciais do Sonar. Não executar down-v nem restaurar banco do produto como parte de rollback de código.

## Aprovação

Decisão: GO_WITH_RISKS. Usuário aprovou início, ajuste temporário de kernel e, posteriormente, tratamento integral com branches e rotina normal. A autorização de implementação não equivale a homologação humana ou publicação externa. Revisão técnica independente permanece obrigatória.
