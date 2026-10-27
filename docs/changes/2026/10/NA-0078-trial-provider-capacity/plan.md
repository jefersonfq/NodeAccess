---
change_id: NA-0078
title: Alinhar capacidade do provisionador de testes
type: fix
status: ready-for-tests
created_at: 2026-10-27T01:12:03-03:00
base_branch: master
base_sha: 84bc6dad1182890f40cd854dd2cc3bb00d8a5637
branch: fix/NA-0078-20261027-trial-provider-capacity
owner: root
planner: root
risk: medium
issue: null
---

## Contexto e situação anterior
Após o operador aumentar o limite do painel para 15, um cadastro confirmado passou de QUEUED para PROVISIONING, mas recebeu RECONCILIATION_RETRY. O provisionador externo manteve limite de dois ambientes e quatro máquinas. Seu validador também restringe a configuração a dez ambientes.

## Problema e objetivo
Permitir a configuração operacional de 15 ambientes, preservando limites explícitos, isolamento e os ambientes existentes. Liberar a reconciliação automática do cadastro pendente sem edição manual de status ou dados pessoais.

## Escopo
Ampliar somente o teto validado de maxActiveTrials de 10 para 20, consistente com o teto existente de máquinas totais. Configurar esta implantação para 15 ambientes e 15 máquinas totais; manter duas máquinas máximas por ambiente no provisionador e os limites menores do perfil da aplicação. Não sincronizar automaticamente capacidade física com alterações do painel.

## Critérios de aceitação
- [x] Configuração de 15 aceita; valores inválidos e acima de 20 recusados.
- [x] Quotas de ambientes, máquinas e sub-redes continuam impedindo sobrealocação.
- [ ] Testes existentes de isolamento/retry e limites passam.
- [ ] Cadastro pendente fica ativo com um host pelo processamento normal.
- [ ] Dois laboratórios anteriores e serviços da aplicação preservados; backup próprio e rollback restrito ao provisionador.

## Estratégia técnica
Alteração mínima em scripts/trial-lab/provider.mjs e regressões de capacidade. Publicação do script pinado e configuração por CAS, backup privado de fonte/configuração/estado, parada graciosa somente do serviço provisionador e retorno com flock existente. Não restaurar estado após novas alocações nem reiniciar containers de usuários.

## Riscos e mitigações
Host com duas CPUs e aproximadamente 3,6 GiB de RAM; cerca de 2,18 GiB disponíveis na inspeção. Cada host mantém 128 MiB/0,25 CPU/PID limitado; 13 hosts adicionais representam teto de 1664 MiB. Isso não certifica desempenho com 15 usuários concorrentes. Rede /24 comporta até 16 sub-redes /28, sujeita a sobreposições detectadas pelo alocador. A configuração operacional permanece explícita e limitada.

## Matriz de testes e evidências
Unitários do provisionador, regressões para 15/20/21 ambientes, quota de máquinas e esgotamento de rede; blackbox local opt-in com Docker descartável; lint/sintaxe e revisão independente. Publicação após gates locais no SHA exato; CI obrigatório antes do merge. Validação remota por consultas e reconciliação normal, sem testes de carga em produção.

## Baseline
Master 84bc6dad limpa e atual; script remoto idêntico ao versionado. Dois ambientes ativos, um pendente; provedor 2/4, painel 15. Serviços ativos sem reinícios.

## Rollback ou recuperação
Backup de fonte/configuração/estado e cópia externa antes da troca. Reverter somente fonte/configuração mediante checagem de capacidade ocupada; não rebaixar limites abaixo do uso atual nem restaurar registros de estado que apagariam novos ambientes. Aplicação, banco e hosts não são revertidos.

## Aprovação
Usuário alterou o limite para 15 e relatou bloqueio da preparação. Decisão: GO_WITH_RISKS após revisão independente. Capacidade 15 pressupõe um host por ambiente e não garante desempenho; reinício pode incluir proxy privado vinculado ao provider, preservando API/gateway/labs.
