---
change_id: NA-0083
title: Jornada de IA com preparação assistida e monitoramento após homologação
type: feature
status: tests-passed
created_at: 2026-10-30T09:20:56-03:00
base_branch: master
base_sha: f4a44b4b7ae87a8f688b1246d9e52a31f9a104bc
branch: feature/NA-0083-20261030-ai-journey
owner: root
planner: root
risk: medium
---

# NA-0083 — Jornada completa de IA

## Contexto e situação anterior

Etapa 2 do PRD comparativo. Já existem configuração, teste de geração, assistente e jobs de resumo. Rascunhos não salvos podem aparentar teste válido; ações de resumo ignoram parte da readiness. NA-0082 segue LOCAL_WIP em outro checkout, sem integração presumida.

## Problema e objetivo

Guiar configuração → salvar → validar → usar assistente/resumo → homologar → monitorar. Avaliar e preparar instalação Ollama/modelo em servidor dedicado, sem depender de IA já funcional ou instalar nada na VPS atual.

## Escopo

- Jornada administrativa reutilizando formulários e fluxos existentes; teste somente da configuração salva, validade e próximo passo claros.
- Ações de resumo respeitam preferência e readiness; estado de fila, falha e evidência preservados.
- Preparação assistida pela interface: plano/script Docker determinístico, revisável e sem credenciais; preflight Linux/Docker/capacidade/instalação existente, modelo e imagem explícitos, bind loopback, GPU somente já preparada.
- Homologação explícita vinculada à configuração validada; monitoramento opt-in após homologação, com limites, falhas datadas, desativação e invalidação quando configuração muda. Somente observação, sem reparos automáticos.
- Avaliação documentada da futura cópia/execução SSH automática com hosts/ACL/fingerprint, jobs duráveis, fencing, cancelamento e reconciliação.
- Excluídos desta entrega: execução remota automática de instalação, criação de VM, drivers/GPU/Docker no host, exposição pública, alteração do transporte terminal, merge/deploy real.

## Critérios de aceitação

- [x] Rascunho diferente do salvo não pode ser validado como se fosse a configuração atual.
- [x] Jornada apresenta próxima ação, validade, erros e caminhos para assistente/auditoria.
- [x] Resumos respeitam readiness e escolha efetiva de provider, sem falso sucesso de fila.
- [x] Pacote assistido validado contra injeção e falhas, sem segredos e sem sobrescrever instalação alheia.
- [x] Homologação exige teste válido da configuração salva; mudança relevante invalida aprovação e monitoramento.
- [x] Watchdog não executa antes de homologação/opt-in, respeita tenant/licença/limites e não altera infraestrutura.
- [x] Testes de estados, permissões, isolamento, falhas, simulações de instalação e browser responsivo aprovados.
- [x] Revisão independente, limitações e evidências registradas em docs do projeto atual.

## Estratégia técnica

Componentes e módulo de onboarding pequenos; reusar integration-readiness, testes existentes e registros de integração. Nenhum comando gerado por IA no instalador. Backend mantém homologação e monitoramento ligados a fingerprint da configuração, com exclusão distribuída e worker fora do SSH. Contratos detalhados serão alinhados após inspeção antes de editar aplicação.

## Riscos e mitigações

| Risco | Mitigação | Critério de parada |
|---|---|---|
| Instalação alterar máquina em uso | Pacote revisável sem execução automática, preflight e ownership | Comando automático fora do plano |
| API Ollama exposta sem autenticação | Loopback por padrão; rede privada/proxy protegido a cargo do plano | Publicação indiscriminada de porta |
| Teste de configuração antiga | Fingerprint e invalidação, concorrência coberta | Homologação aceita sobre configuração alterada |
| Watchdog afetar SSH/gerar carga | Opt-in, intervalo/timeout, sem comandos de reparo | Monitoramento no caminho de sessão |

## Matriz de testes e evidências

| Critério | Validação | Ambiente | Required |
|---|---|---|---|
| Configuração/readiness/homologação | Unitários + rotas/auth/tenant | Local isolado | yes |
| Watchdog | Relógio, concorrência, TTL, erros, desligamento | Simulado | yes |
| Instalação assistida | Bash/Docker simulado, injeção, ownership, falhas | Descartável local | yes |
| Jornada | Browser desktop/mobile/erros/rascunho | API simulada | yes |
| Integração | Lint/typecheck/build + revisão independente | Node24 | yes |

## Baseline

Base verificada com fetch em 30/10/2026: f4a44b4b7ae87a8f688b1246d9e52a31f9a104bc. Planejador executou 16 testes existentes de readiness/governança/artefatos, aprovados. Baselines por módulo serão registrados antes das edições.

## Rollback ou recuperação

Sem implantação remota nesta execução. Reverter arquivos da frente; nenhum volume remoto removido. Homologação/monitoramento precisam ser desarmados se a configuração perder validade. Detalhar migração se necessária antes de implementá-la.

## Mudanças de escopo e decisões

Pedido do usuário autoriza etapa2 fim a fim e avaliação de instalador remoto. Implementação começa com preparação assistida: executor SSH existente tem timeout curto e não oferece job durável recuperável; automatização remota é especificada, sem fingir entrega operacional. Linux/Docker com GPU previamente preparada é hipótese inicial; usuário confirmou preparar fluxo/plano sem instalação real porque a máquina ainda não foi definida. Documentos canônicos em NodeAccess-current/docs; código isolado para preservar NA0081/NA0082.

## Aprovação

- Decisão: GO_WITH_RISKS, análise independente backend/frontend/operação.
- Aprovado por: usuário ao solicitar etapa2 fim a fim e avaliação de provisionamento.
- Aprovado em: 2026-10-30, sessão atual.

## Resultado local e evidências

PASS_WITH_WARNINGS; testes/builds/lint e revisão independente concluídos. Detalhes e fingerprint do working tree em `test-results.md`. Sem migração nova. Correções necessárias da revisão: CAS nos testes de configuração, quota mensal antes do monitor, limite de saída solicitado aos providers, formato oficial do digest e rejeição de payloads inválidos. Não alteram transporte ou políticas de execução SSH.

LOCAL_WIP: COMMITTED, PUSHED, PR_OPEN, MERGED e MASTER_SYNCED pendentes. Homologação humana/instalação real não presumidas. Usuário confirmou preparar fluxo e plano sem instalação real. Execução automática SSH permanece extensão especificada, não entregue.

## Ampliação autorizada de testes — 2026-10-30T10:20:30-03:00

Pedido: enriquecer validação fim a fim com simulações e containers descartáveis no WSL. GO_WITH_RISKS: ampliar somente harnesses e correções necessárias comprovadas, sem VPS, publicação ou instalação em servidor do usuário. Cobrir persistência/CAS MySQL real, leases/cotas Redis, HTTP real da jornada e instalação assistida em laboratório isolado quando viável. Fixtures sintéticas não certificam qualidade de modelos ou GPU. Recursos exclusivos e limpeza obrigatória; não compartilhar dados/credenciais ou Docker socket com serviços existentes. Reexecutar baseline core, checks direcionados e revisão independente.

## Resultado da ampliação — 2026-10-30T10:30:02-03:00

Validação técnica PASS_WITH_WARNINGS após revisão independente. Ran:15cenários SQL/Redis,15HTTP/browser,10instalaçãoCPU real,122core e21unitários direcionados (sobreposição). Classificação NECESSARY_CORRECTION: lock exclusivo inicial da reserva mensal e sondagem SO_REUSEADDR, ambos motivados por falhas reproduzidas. Sem expansão do provisionador SSH ou deploy. Limites/gates manuais preservados. Guia: [laboratório WSL](../../../../OPERATIONS-ai-journey-lab.md).
