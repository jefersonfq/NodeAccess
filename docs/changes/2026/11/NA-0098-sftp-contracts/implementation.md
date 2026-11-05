# NA-0098 — Registro de implementação

## Pedido e objetivo

Ampliar a cobertura real dos contratos SFTP no trabalho autorizado das quatro pendências SonarQube.

## Implementação

SHA base: 4a77f7139600e70aa612e753418978d9b31b10ae. Branch isolada `test/NA-0098-20261103-sftp-contracts`. Novo arquivo `apps/backend/src/modules/sftp/sftp-contracts.service.test.ts`; nenhuma alteração de produto.

42 novos testes exercitam ACL/tenant/role, password/PEM/passphrase/1Password, conexão direta e bastion, trial, listagem, bytes de download/upload, criação, exclusão, substituição, metadados, checksum e truncamento em 1 MiB. Criptografia e streams são reais; transporte SSH e outras fronteiras externas são simulados.

## Validação

Ran: 47 testes aprovados (42 novos e 5 existentes); 202/202 linhas (100%), 68/69 funções (98,55%) e 145/151 branches (96,02%). Suite repetida após formatação. ESLint e typecheck backend aprovados com shared compilado.

Revisão independente: PASS_WITH_WARNINGS; reproduziu 47 testes e confirmou assertivas observáveis. Não demonstra protocolo SSH real, filesystem remoto, atomicidade ou permissões do servidor. Erro de upload e callback de monitor não estão integralmente medidos; nenhuma alegação de cobertura total de funções/branches. Percentuais dirigidos não aprovam o gate global.

Primeira execução não carregou shared ainda não compilado; depois a fixture usava perfil inexistente linux. Corrigidos ambiente e fixture para server_ssh, sem alterar regras de produto ou expectativas de segurança.

## Recuperação

Reverter apenas arquivo de teste. Sem migração, instalações ou acesso a hosts reais.

## Pendências

Integrar na NA-0093, consolidar cobertura e SonarQube. Gates globais continuam pendentes.

## Diário de interações

### 2026-11-03T16:18:00-03:00 — Contratos SFTP

Selecionado módulo com lacuna mensurada. Criados testes de APIs públicas preservando implementação e limites de cobertura.

### 2026-11-03T16:27:00-03:00 — Revisão independente

Concluídos 47 casos, lint/typecheck e revisão. Registrados limites de simulação e cobertura dirigida; próximo passo é consolidação, sem alteração de limiares.
