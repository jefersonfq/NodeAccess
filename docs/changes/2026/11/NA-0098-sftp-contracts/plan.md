---
change_id: NA-0098
title: Testar contratos de configuracao e diagnostico de SFTP
type: test
status: in-development
created_at: 2026-11-03T15:57:28-03:00
base_branch: chore/NA-0089-20261103-sonar-integration
base_sha: 4a77f7139600e70aa612e753418978d9b31b10ae
branch: test/NA-0098-20261103-sftp-contracts
owner: NodeAccess
planner: Codex
risk: medium
---

# NA-0098 — Contratos de SFTP

## Contexto e situação anterior

O SftpService apresenta 155 linhas descobertas no baseline no baseline legado. Ele autoriza acesso, abre SSH/SFTP e executa operações de arquivos e metadados.

## Problema e objetivo

Validar operações de arquivo e ciclo de vida das conexões, preservando os limiares globais de cobertura.

## Escopo

Somente testes: serviço, criptografia e streams reais; persistência, trial e transporte SSH simulados. Sem alteração de produto, kernel ou VPS.

## Critérios de aceitação

- [x] Credenciais, escopo, ACL e rejeição de acesso validados.
- [x] Operações de arquivo, metadados, truncamento e erros validados.
- [x] Conexão direta, bastion, trial e fechamento de conexões validados.
- [x] Lint, typecheck e revisão independente registrados.

## Estratégia técnica

Exercitar APIs públicas com criptografia e streams reais. Simular ssh2, persistência, trial e provedor de segredos; verificar configuração, callbacks, erros e fechamento de conexões.

## Riscos e mitigações

Não representa prova do protocolo SSH, filesystem de servidor remoto, atomicidade ou permissões reais. Assertivas verificam comportamento do serviço e efeitos nas fronteiras.

## Matriz de testes e evidências

Ran: 42 novos testes mais 5 existentes, 47 aprovados. Cobertura dirigida: 202/202 linhas, 68/69 funções e 145/151 branches. Lint, typecheck e revisão independente aprovados. Ver implementation.md.

## Baseline

SHA 4a77f7139600e70aa612e753418978d9b31b10ae. Nenhuma alteração de produto neste lote.

## Rollback ou recuperação

Reverter o arquivo de testes. Nenhuma migração ou persistência real.

## Aprovação

Decisão: GO_WITH_RISKS. Trabalho necessário ao pedido autorizado das quatro pendências, com testes e simulações; preservar limiares e fronteiras externas.
