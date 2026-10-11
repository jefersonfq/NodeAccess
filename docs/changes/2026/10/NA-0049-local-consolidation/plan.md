---
change_id: NA-0049
title: "Consolidar a revisão local e preparar entrega por PR"
type: chore
status: ready-for-review
created_at: 2026-10-09T10:20:55-03:00
base_branch: security/NA-0048-20261008-container-stack
base_sha: de65fea9c327980e9ab2148a2be0147009a673bc
branch: chore/NA-0049-20261009-local-consolidation
owner: Jeferson Quintana
planner: Codex
risk: medium
---

## Contexto e situação anterior
A revisão NA-0039 a NA-0048 já tem commits separados e foi validada localmente.
O usuário autorizou consolidar na pasta Linux nova, commitar, publicar no GitHub
e seguir por PR até master. Jira foi esclarecido como integração do produto;
não há ticket externo a atualizar.

## Problema e objetivo
Registrar a migração do workspace e a configuração de desenvolvimento, preservar
os pontos de retorno e preparar a integração da cadeia revisada em master.

## Escopo
Documentação e controle de entrega. Nenhuma alteração de código de aplicação,
dependências, guacd, produção ou regras de proteção do GitHub nesta mudança.
A migração e os ajustes locais de configuração já foram executados; credenciais,
dados de execução, dumps e arquivos .env continuam fora dos commits.

## Critérios de aceitação
- [x] Histórico NA-0039 a NA-0048 preservado; pasta ativa no Linux identificada.
- [x] Migração, backup/restauração e inicialização local registrados com limites.
- [ ] Commit documental validado no SHA final, sem segredos ou dados locais.
- [ ] Branches publicadas e PR confirmado no GitHub.
- [ ] Checks/revisões e homologação exigidos pelo repositório verificados.
- [ ] PR mesclado; master local sincronizada e visível na pasta de trabalho.

## Estratégia técnica
Consolidar sobre a ponta local explicitamente validada, sem reescrever commits.
A referência em cache origin/master é 45bd05ad6e102dc7d48ecffed0a20323854b0d4e; ela NÃO equivale a uma
consulta atual ao GitHub. Fetch falhou por DNS em 09/10/2026. Antes de publicar,
atualizar a referência, avaliar divergências e integrar com preservação do
histórico. Não realizar merge direto na master protegida.

## Baseline
Aplicação no SHA de65fea9c327980e9ab2148a2be0147009a673bc. A mudança NA-0049 é somente documental.
Comparar o diff e executar governança/status da mudança no SHA final. Os testes
da aplicação no baseline estão registrados em evidence.md; não apresentá-los
como nova execução após este commit. CI e revisão do PR ainda são pendentes.

## Matriz de testes e evidências
Governança, estado de entrega, revisão independente do diff e TypeScript no SHA
final. Referências históricas e limites em evidence.md; publicação/CI permanecem
pendentes até acesso autenticado ao GitHub.

## Riscos e mitigações
O checkout histórico Linux contém trabalho anterior sem commit; não sobrescrever
nem limpar. Preservar branches, backup e cópia histórica até a comparação final.
Ausência de acesso ao GitHub impede confirmar base atual, PR, checks e merge.
Persistem as pendências de segurança e release já registradas em NA-0048.

## Rollback ou recuperação
A branch security/NA-0048-20261008-container-stack permanece no baseline.
Usar uma nova worktree para comparar ou recuperar; não usar reset destrutivo.
O banco local recebeu migration já versionada após dump íntegro; rollback do Git
não desfaz DDL. Produção não foi atualizada.

## Aprovação
Decisão: GO_WITH_RISKS para preparar e commitar a consolidação local, conforme solicitação
explícita de 09/10/2026. Publicação e PR também autorizados pelo usuário. Merge
depende dos gates do repositório e da verificação efetiva no GitHub.
