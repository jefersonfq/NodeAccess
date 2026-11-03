---
change_id: NA-0091
title: Recuperação e renovação segura da instância SonarQube local
type: chore
status: in-development
created_at: 2026-11-03T15:20:00-03:00
base_branch: chore/NA-0089-20261103-sonar-integration
base_sha: 4a77f7139600e70aa612e753418978d9b31b10ae
branch: chore/NA-0091-20261103-sonar-recovery
owner: Codex
planner: Codex
risk: medium
issue: null
---

# NA-0091 — Continuidade SonarQube local

## Contexto e situação anterior

Instância isolada em localhost:9000 e PostgreSQL17.11; runtime fora do Git. Backup/restore e renovação de tokens ainda não foram ensaiados. Tokens restritos têm validade de 30 dias. Análise de outra frente pode estar ativa.

## Problema e objetivo

Provar recuperação independente do projeto, histórico e permissões; criar backup privado verificável e fluxo de tokens com sobreposição e verificação antes de revogar. Não depender de sysctl persistente não autorizado.

## Escopo

Inclui scripts Sonar, testes, backup PostgreSQL/configurações privadas, manifest sem segredos, restore em volumes/stack novos, renovação local coordenada e agendamento fora do repo. Exclui scanner, produto/VPS, volumes originais, alteração de gates/permissões e configuração persistente do kernel.

## Critérios de aceitação

- [x] Backup com permissões privadas, checksums e manifest sem valores de credenciais; corrupção/arquivos inseguros recusados.
- [x] Restore real usa stack/volumes exclusivos e loopback, preserva projeto/histórico/revisões/permissões; originais permanecem íntegros.
- [x] Rotação gera tokens restritos de 30 dias, verifica novos antes da troca/revogação, falhas preservam tokens anteriores e não expõem segredo.
- [x] Agendamento instalado/configurado em runtime fora do Git com execução segura e status verificável, sem sysctl persistente.
- [x] Testes negativos e evidências reproduzíveis, documentação canônica, revisão independente e commits locais recuperáveis.

## Estratégia técnica

pg_dump custom consistente online; configurações e credenciais em backup privado, checksum SHA256 e inventário sanitizado. Restore somente em namespace aleatório e imagens locais fixadas, Elasticsearch novo reindexado. Tokens renovados com credenciais administrativas lidas de arquivo privado, estado transacional de sobreposição e expiração monitorada. Agendamento não invoca shell com segredos nem aceita destino externo.

## Riscos e mitigações

Backup contém dados privados/credenciais: raiz0700 e arquivos0600, nenhum dump versionado. Restore consome recursos: limites Docker, bindloopback, cleanup próprio. Tokens: coordenar janela com root e verificar acesso antes de retirar antigos. Downgrade/produção não fazem parte deste ensaio.

## Matriz de testes e evidências

Unitários para paths, checksums, permissões, falhas e datas; APIs falsas para falha de rotação; pg_dump/pg_restore e Sonar reais em stack descartável; comparação de histórico/projeto/permissões; agendamento/status. Evidências sanitizadas no registro, logs e backups privados fora do Git.

## Baseline

Base 4a77f7139600e70aa612e753418978d9b31b10ae. Runtime Sonar26.10/PostgreSQL17.11 existente; porta9000loopback. Documentação oficial confirma hotbackup e restauração com reindexação. Nenhuma mutação operacional antes do plano.

## Rollback ou recuperação

Reverter scripts/commits não altera dados originais. Remover apenas stack de ensaio identificada. Rotação falha antes da publicação mantém tokens anteriores; snapshot privado de credentials permite recuperação enquanto tokens antigos não revogados. Agendamento pode ser desabilitado separadamente.

## Aprovação

Decisão: GO_WITH_RISKS. Usuário autorizou executar as quatro pendências fim a fim; root delegou continuidade/backup/restore/tokens. Autorização inclui commits locais, não publicação/merge. Rotação real exige coordenação operacional com root, sem nova confirmação do usuário.
