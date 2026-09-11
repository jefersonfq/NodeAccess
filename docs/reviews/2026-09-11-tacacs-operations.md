# TACACS+ — diagnóstico operacional, carga e laboratório de equipamento

## Entrega

- Diagnóstico do processo independente até a API administrativa e a interface, com separação entre configuração habilitada e estado observado. Contadores exibidos são exclusivos do tenant autenticado.
- Heartbeats no Redis, identificação de atualização atrasada, banco indisponível e operações saturadas/demoradas. Falha de monitoramento preserva a política de acesso.
- Histórico de métricas limitado em memória; atualização da interface independente dos formulários, com retry e preservação de campos.
- Endpoint local de prontidão/vida/métricas, healthcheck no Compose e watchdog para encerrar processos com operação AAA permanentemente pendente. Reinício depende do supervisor; o Compose já possui política de restart.
- Laboratório SSH real com CLI de equipamento simulada e cliente Python TACACS+ independente; falhas e recuperação de dois listeners AAA.
- Carga sustentada opt-in, com banco real e fases de operação normal, erro/timeout e recuperação.

Não há migração nova nesta etapa, ativação para clientes existentes ou publicação em produção. A alteração de telemetria não acrescenta consultas TACACS+ ao SSH comum.

## Validação

- Suíte focada: 137 testes em nove arquivos, incluindo os 129 anteriores e oito testes de diagnóstico/isolamento/watchdog.
- Typecheck shared/backend/frontend e build backend aprovados.
- UX em navegador: estados de saúde, falha HTTP, retry, remoção de confirmação antiga de disponibilidade, campos preservados, teclado/mobile e os cenários anteriores do cadastro de rede.
- Watchdog com daemon compilado e proxy de banco congelado: prontidão HTTP 503, capacidade retida, encerramento com código 1 e nenhuma confirmação AAA; MySQL real permaneceu disponível.
- Redis real: ausência de heartbeat, observação disponível, réplica atrasada, recuperação, falha de banco e encerramento do listener.
- Daemon compilado: cliente independente + MySQL + observação publicada pelo daemon chegando à rota administrativa com escopo de tenant.
- Emulador: sete cenários SSH/AAA, incluindo recusa sem fallback, configuração autorizada, revogação na sessão aberta e encerramento real do listener primário.
- Carga de aproximadamente dois minutos: 2.733 pedidos com quatro clientes. A fase de falhas exerceu 181 erros e 181 timeouts; os 1.026 pedidos da recuperação terminaram sem erro e respeitaram permissões/recusas. Ao final de cada fase, zero conexões e operações pendentes.

Evidências sanitizadas: [JSON de validação](./2026-09-11-tacacs-operations.json).

## Limites práticos

O simulador valida o fluxo, não dialetos ou firmware de fabricante. Seus dois servidores AAA compartilham processo e banco; não houve homologação de HA entre máquinas. O watchdog foi validado com o executável compilado e falha real de transporte em um proxy descartável. O reinício automático por um supervisor de produção não foi exercitado nesta etapa.

Dois minutos de carga não comprovam ausência de vazamento de memória, SLA nem capacidade para 300 usuários. O harness permite estender a execução até 30 minutos. Medições de CPU/RSS cobrem o processo Node do laboratório, sem os subprocessos Python ou MySQL. O crescimento de RSS observado durante a execução é registrado no JSON, sem concluir estabilidade de longo prazo.

Grupos/conjuntos reutilizáveis de comandos, simulador administrativo de políticas, retenção/exportação de auditoria, TLS, redes de clientes sobrepostas e homologação por fabricante permanecem como etapas posteriores. Esta entrega executa a próxima etapa recomendada: observabilidade, carga/recuperação e laboratório de equipamento.

## Arquivos e operação

Backend: `tacacs-metrics.ts`, `tacacs-health.ts`, `tacacs-server.ts`, `tacacs-main.ts`, serviço/rotas de rede e container de dependências. Frontend: `TacacsHealthCard.vue`, integrado ao cadastro de rede. Laboratório: `tools/network-access/health-live.mjs`, `device-emulator.mjs`, `soak.mjs`, `live.mjs` e `ux.cjs`.

Consulte o [guia operacional](../guides/network-access-tacacs.md#saúde-diagnóstico-e-recuperação-operacional) para variáveis, endpoints e execução dos testes.

Laboratório encerrado: API/frontend isolados e daemon de teste parados; tenants temporários removidos pelos testes; proxy de falha fechado. Observações de saúde remanescentes expiram em até 60 segundos. Instâncias principais não foram reiniciadas.
