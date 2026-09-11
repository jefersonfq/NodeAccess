# Túneis SSH — revisão funcional e resiliência

Escopo: `/forwardings`, `TunnelManager.vue` no terminal e ciclo de vida de `TunnelService`.

## Correções

- Auto-start pendente acompanha o encerramento da sessão: fechar a aba durante consulta de configurações ou abertura SSH não deixa túnel órfão ao concluir. Estado temporário de cancelamento é removido ao terminar a operação.
- Reuso entre abas continua limitado ao mesmo usuário, tenant, host e regra; última aba encerra o túnel compartilhado.
- Listagem e fechamento via controller incluem tenant, além do proprietário.
- ACL é revalidada depois da abertura SSH/listener. Revogação durante startup impede registro do túnel e fecha os recursos já abertos.
- `close` do transporte também remove o túnel; handlers são registrados antes de aguardar auditoria. Se SSH cair nesse intervalo, criação retorna erro em vez de sucesso com um recurso já encerrado.
- Consultas antigas no gerenciador não substituem configurações/presença após troca de host. Resposta de salvamento antiga também não modifica a nova tela.
- Túneis manuais sem ID de configuração são associados pela porta solicitada, bind e destino, evitando mostrar “Start” para um túnel já aberto. Porta efetiva continua sendo a referência para uso.
- Abertura/salvamento/fechamento repetidos recebem guardas de operação pendente nos pontos afetados.
- Erros de carregamento têm aviso e nova tentativa; falha de fechamento preserva o estado ativo. Após fechamento confirmado, a remoção local independe do sucesso da consulta seguinte.
- Erros transitórios de `/forwardings` e `/tunnels` são tratados localmente, sem recarregar toda a aplicação. Autenticação permanece obrigatória.

## Evidências

```bash
npm run test:forwardings:core
npm run test:forwardings:real
FRONTEND_BASE=http://127.0.0.1:5190 npm run test:forwardings:web
FRONTEND_BASE=http://127.0.0.1:5190 npm run test:terminal-experience:web
npm run typecheck -w apps/backend
npm run typecheck -w apps/frontend
npm run build -w apps/frontend
```

- **39 testes core aprovados:** concorrência entre abas, cancelamento antes/durante abertura, isolamento de usuário/tenant, ACL negada/revogada durante startup, queda no transporte, falha durante auditoria, agente obrigatório offline e classificação de recuperação HTTP autenticada.
- **1 teste SSH/TCP real aprovado:** servidor SSH e destino echo descartáveis em loopback, transferência de bytes/Unicode, porta ocupada com fallback e listener indisponível depois do fechamento. Requer permissão para bind local; não usa credenciais nem servidores externos.
- **Playwright aprovado:** erro 503/retry, erro SSH/retry, porta efetiva, fechamento com falha/retry, resposta antiga após troca de host, associação de túnel manual à configuração e parada no gerenciador. A página `/forwardings` é real; o gerenciador Vue é montado com seus providers para controlar a troca de host. API é simulada nesse ensaio.
- **Experiência completa do terminal aprovada:** queda/reconexão simulada, saída de socket antigo descartada, SFTP pendente limpo, presença encerrada imediatamente e verificações existentes de layout/interação.

Typecheck de frontend/backend e build de produção passaram. A build apresentou somente os avisos de Browserslist desatualizado e tamanho de chunks.

Captura: `/tmp/nodeaccess-forwardings-manager.png`.

## Avaliação geral e pendências

1. **Topologia:** porta nasce no servidor/processo NodeAccess. Copiar `127.0.0.1:porta` não cria um túnel no computador do usuário. Bind `0.0.0.0`, quando escolhido, expõe o listener às interfaces do servidor; o padrão 127.0.0.1 foi preservado e testado.
   Túneis manuais são independentes da sessão do terminal: o endpoint de criação não recebe `sessionId`. O fechamento da última aba se aplica aos túneis de auto-start associados às sessões; túneis manuais exigem encerramento explícito ou término do runtime.
2. **Bastion e identidade SSH:** `TunnelService.buildConnectConfig` é um fluxo independente e não implementa o bastion efetivo nem `hostVerifier` do fluxo principal do terminal. A revisão não certifica equivalência de política de conexão/host key. Recomenda-se unificar essa política antes de ampliar suporte a topologias dependentes de bastion. Não foi adicionada uma implementação parcial desses mecanismos.
3. **API/gateway e múltiplas instâncias:** registros de túneis são mapas em memória por processo. Reinício perde runtime; processos separados e réplicas exigem roteamento/coordenação do proprietário do túnel. Não houve ensaio distribuído nem mudança de arquitetura nesta revisão.
4. **Atualização de presença externa:** as telas ainda dependem de eventos/consultas existentes e nova tentativa/reabertura; esta revisão não adiciona sincronização distribuída nem polling novo. O aviso informa quando a atualização falha.
5. **Escala do seletor:** `/forwardings` continua buscando até 500 hosts para o formulário; paginação/busca remota desse seletor é uma evolução separada.
6. **Limites de certificação:** ensaio real cobriu SSH direto. Caminhos de agente online, private access, bastion, proxy web, MySQL real e implantação distribuída não foram certificados ponta a ponta. Agente obrigatório offline e ACL foram testados com doubles.

Não houve deploy. Nenhuma migration foi necessária. O transporte do terminal/PTY e suas regras de resize não foram alterados; o teste real novo exercita o forwarding SSH/TCP diretamente.


## Complemento

As correções posteriores para booleanos, presença compartilhada, bastion, confiança SSH e registro distribuído estão em [forwardings-completion](2026-09-09-forwardings-completion.md), incluindo limites operacionais e validação adicional.
