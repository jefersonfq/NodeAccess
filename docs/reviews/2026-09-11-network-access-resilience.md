# TACACS+ — simulações ampliadas de falha e concorrência

## Escopo

Ampliação dos testes do piloto existente. Nenhuma alteração no fluxo de produção, na interface, no gateway SSH ou nos limites operacionais do servidor TACACS+. As falhas são injetadas apenas nas dependências de teste e em registros de tenants descartáveis.

## Casos novos em TCP real com dependências controladas

Arquivo: `apps/backend/src/modules/network-access/tacacs-resilience.test.ts` (28 casos).

- 24 autorizações sobrepostas, com identidades, IDs de sessão e resultados individuais; oito conversas ASCII simultâneas sem troca de usuário/senha entre sessões.
- PAP, autorização e accounting concorrentes, combinando sucesso, recusa e falha de dependência.
- Rejeição e operação pendente em cada dependência: origem/dispositivo, autenticação, autorização e auditoria. Timeout fecha a conexão, não confirma sucesso e mantém a capacidade ocupada até a operação realmente terminar. Depois, novo pedido válido funciona.
- Limites de conexões e de conexões por origem, liberação de slots, clientes ociosos e cabeçalhos/corpos truncados.
- Fragmentação byte a byte, pacotes agrupados, segundo pacote durante operação pendente e desconexão do cliente antes da resposta.
- Revogação do dispositivo, troca de segredo, cancelamento, ID de sessão incorreto e sequência incorreta durante diálogo ASCII.
- Comprimentos inconsistentes, argumentos em excesso, UTF-8 inválido, caracteres de controle e tráfego malformado concorrente com pedidos válidos.
- Accounting só recebe confirmação após resolver a persistência; encerramento do listener fecha clientes ociosos/pendentes sem confirmar accounting não concluído.
- Limite de tentativas de autenticação expira e permite novas tentativas; autorizações continuam funcionando durante o bloqueio de autenticação.

Os testes usam portas efêmeras em loopback, clientes que acumulam frames TCP e barreiras explícitas para controlar operações pendentes. Timeouts reduzidos de 60/80 ms exercitam os mesmos caminhos sem alterar os valores de produção. A janela de rate limit usa relógio controlado, restaurado após o teste.

## Banco real e cliente independente

`tools/network-access/live.mjs` mantém os cenários anteriores e acrescenta:

- 32 autorizações em ondas de quatro clientes Python independentes, combinando comandos permitidos e negados.
- 12 registros de accounting em ondas de quatro, com IDs distintos e conferência no MySQL: cada evento submetido aparece uma única vez. Isso não promete deduplicação em retransmissões de equipamentos.
- Remoção/substituição de comandos permitidos, preservação da autorização de exec pela ACL e recusa de argumentos adicionais.
- Rotação de senha, bloqueio/desbloqueio do usuário, troca de segredo e desativação/reativação do dispositivo sem reiniciar o listener.
- JSON de política propositalmente corrompido apenas no tenant de teste: resposta de erro de autorização, seguida de recuperação após substituição válida.
- Falha de auditoria injetada em listener auxiliar: PAP retorna erro 7, autorização erro 17 e accounting erro 2; nenhum evento é persistido durante a falha. Após restabelecer a dependência, as três operações retornam sucesso e seus três eventos são persistidos.
- Prazo máximo para o subprocesso Python, para evitar que o laboratório permaneça indefinidamente esperando um cliente travado.

Resultado: **22 verificações integradas aprovadas**, incluindo as 14 anteriores. O processo terminou com código zero após remover os próprios registros e fechar os listeners.

Suíte focada final: **129 testes aprovados em oito arquivos**, incluindo os 28 novos casos de resiliência.

## Execução e limites

```sh
npm run test:network-access
RUN_NETWORK_ACCESS_LIVE=true PYTHONPATH=/caminho/dependencias-python \
  NETWORK_REPORT_PATH=/tmp/nodeaccess-network-resilience-live.json \
  node --env-file=apps/backend/.env --import tsx tools/network-access/live.mjs
```

Requer banco local migrado e `tacacs_plus==2.6` no ambiente Python de teste. Execute um laboratório integrado por vez: o piloto reserva o IP de origem do dispositivo globalmente. Não é necessário acessar a VPN nem o Proxy2.

Evidência sanitizada: [resultados em JSON](./2026-09-11-network-access-resilience.json).

As falhas observadas foram as injetadas, com os resultados esperados; não foi necessário corrigir código de produção nesta ampliação. Os cenários não homologam firmwares, alta disponibilidade, retransmissões com deduplicação, nem capacidade de produção para 300 usuários. A concorrência integrada foi de quatro clientes; a suíte TCP controlada exercitou 24 autorizações sobrepostas. Tempos incluem condições locais e não são SLA ou benchmark de equipamento real.
