---
change_id: NA-0071
title: Permitir PTY nos hosts descartáveis de degustação
type: fix
status: ready-for-tests
created_at: 2026-10-24T17:45:46-03:00
base_branch: master
base_sha: 55a9138d87678bf6e03ddddb1ea9adfcdb7ccc72
branch: fix/NA-0071-20261024-trial-pty
owner: trial_install
planner: root
risk: medium
issue: null
---

# NA-0071 — PTY nos hosts de degustação

## Contexto e situação anterior

O host aceita autenticação SSH, exec e SFTP, mas recusa a solicitação de PTY. A configuração do daemon descarta todas as capabilities e permite apenas SETUID, SETGID e SYS_CHROOT. O OpenSSH precisa atribuir o terminal ao usuário da sessão. O harness anterior não solicitava PTY.

## Problema e objetivo

Permitir shell interativo com PTY e resize reais, preservando o isolamento dos laboratórios.

## Escopo

Inclui provider, seus testes e documentação. Exclui frontend, autenticação, gateway, banco, imagem SSH e implantação remota nesta implementação.

## Estratégia técnica

Adicionar apenas CHOWN à lista explícita de capabilities do container de laboratório e à verificação de configuração efetiva no provider. Atualizar a documentação dessa exceção. Adicionar regressão com shell PTY real, dimensões iniciais e window-change observados por stty, comando e saída; preservar exec/SFTP e testes de isolamento existentes. Não alterar autenticação, frontend, gateway, banco, imagem SSH ou VPS. Não fazer commit antes do gate do orquestrador.

## Critérios de aceitação

- [x] A regressão reproduz a recusa de PTY na base sem CHOWN.
- [x] Com CHOWN, shell interativo, comando e resize reais funcionam.
- [x] A sessão continua UID 1000, CapEff zero e NoNewPrivs 1; filesystem read-only, limites e isolamento continuam validados.
- [x] O provider exige lista exata de capabilities; não introduz privilégios adicionais.
- [x] Recursos descartáveis são removidos pelo harness; nenhuma execução em produção.

## Matriz de testes e evidências

| Critério/risco | Teste | Ambiente | Evidência | Obrigatório |
|---|---|---|---|---|
| PTY e resize | Blackbox RED/GREEN com shell/stty | Docker local descartável | /tmp/na0071-pty-red.log e /tmp/na0071-pty-green.log | Sim |
| Isolamento e policy | Blackbox e 10 testes unitários | Local | /tmp/na0071-unit.log | Sim |
| Integridade do código | Node --check e git diff --check | Local | Execuções registradas no diário | Sim |

Executar sintaxe Node, testes unitários provider e blackbox local completo RED/GREEN. A certificação de terminal via navegador depende de stack e host descartáveis integrados; coordenar com o orquestrador, sem usar produção. Sem alteração de área útil/frontend, a suite visual não é afetada. Evidências locais em /tmp/na0071-*.log, revisão independente antes de commit.

## Baseline

Master e origin/master limpos em 55a9138d87678bf6e03ddddb1ea9adfcdb7ccc72. Imagem local na0068-trial-ssh:test disponível. Reprodução RED antes da alteração confirmou Unable to request a pseudo-terminal. GREEN completo posterior passou; evidências em /tmp/na0071-pty-red.log e /tmp/na0071-pty-green.log.

## Riscos e mitigações

CHOWN amplia a capacidade do daemon root exclusivamente dentro do container descartável; a sessão não-root continua sem capabilities. Não conceder NET_ADMIN/NET_RAW, mounts do host ou Docker socket. Containers já existentes com a configuração antiga devem falhar na validação de drift; não recriar silenciosamente hosts ativos. A atualização operacional precisa considerar os laboratórios existentes.

## Rollback ou recuperação

Reverter via PR restaura o comportamento anterior, inclusive a falha de PTY. Sem migração de dados.

## Mudanças de escopo e decisões

NECESSARY_CORRECTION dentro da entrega 2.1.0 autorizada. Normalização CSI/CR no harness necessária para observar stty sem mudar os valores exigidos; sem ampliação de escopo.

## Aprovação

- Decisão: `GO`
- Aprovado por: orquestrador root, dentro da autorização do usuário para a entrega.
- Aprovado em: 2026-10-24.

GO para implementação: correção necessária explicitamente autorizada dentro da entrega 2.1.0. Aprovação final depende de revisão independente e testes. Classificação: NECESSARY_CORRECTION.

## Revisão independente

Validator trial_review retornou PASS para o escopo CHOWN após revisar diff e RED/GREEN. Acrescentou teste de policy real: lista exata aceita até a execução, CHOWN ausente, NET_ADMIN extra e CHOWN duplicado rejeitados antes de exec. Dez testes unitários passaram. Commit e gates de SHA final permanecem com o orquestrador.
