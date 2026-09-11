# Túneis SSH — conclusão das correções e validações

## Problemas relatados

- **Switch desligado que iniciava automaticamente:** os SELECTs SQL retornavam `auto_start` e `web_enabled` como números MySQL. O switch exige booleanos. Todos os caminhos de leitura agora normalizam esses campos. A alteração aguarda a resposta persistida, impede cliques concorrentes e preserva o valor anterior quando falha.
- **Contador 3 com dois túneis no painel:** havia snapshots independentes por aba, eventos SSH e consultas do painel. A presença agora é compartilhada, filtrada por host e deduplicada por ID. Todas as abas do mesmo host recebem a atualização confirmada. Eventos antigos não substituem o inventário consultado.

## Alterações complementares

- Consulta de presença a cada 5 segundos enquanto a página está visível, e ao recuperar foco. Uma única consulta em andamento atende os componentes. Falhas mantêm o último estado conhecido e exibem aviso no painel; recuperação substitui o snapshot. Respostas anteriores a uma mutação confirmada são descartadas.
- Abertura e teste de destino conferem a chave SSH confiável do host, com orientação para validar pelo terminal quando desconhecida ou alterada. Bastion segue a precedência existente do terminal: conexão por agente já estabelecida tem prioridade; sem agente, usa o bastion configurado. Credenciais PEM com passphrase são suportadas.
- Keepalive SSH, limpeza ao desconectar e timeout de 5 segundos no teste do destino. Um canal recebido depois do fechamento do cliente TCP é encerrado.
- Registro Redis de instâncias, snapshots com validade de 15 segundos e atualização a cada 3 segundos. A API lista túneis do gateway e encaminha o encerramento ao processo responsável. Só confirma sucesso após a resposta desse processo; isolamento por usuário/tenant é verificado também no proprietário. Falha de consulta é indisponibilidade, não lista vazia.
- O seletor de hosts consulta as páginas necessárias, respeitando o tamanho efetivo informado pela API; não para nos primeiros 500 hosts.

## Validação executada

- `npm run test:forwardings:core`: 52 testes, incluindo booleanos SQL, concorrência entre abas, ACL, usuário/tenant, falhas, timeout, expiração e snapshots atrasados.
- `npm run test:forwardings:real`: 2 cenários parametrizados com SSH/TCP reais — direto e bastion. Cada cenário cobre chave desconhecida/alterada/confiável, teste de destino, tráfego Unicode, porta ocupada, encerramento manual e desconexão remota.
- `npm run test:forwardings:redis:real`: integração com Redis descartável e subscribers independentes, descoberta, isolamento e encerramento confirmado. Namespace exclusivo removido ao terminar.
- `npm run test:forwardings:web`: 12 cenários no navegador, incluindo persistência do switch, falha ao salvar, abertura/fechamento, atualização externa, porta alternativa e troca de host com resposta atrasada.
- `npm run test:terminal-experience:web`: cenário real de interface com evento duplicado e contagem **2 → 1 → 0**, painel consistente, além de reconexão, resize, autocomplete, teclado, clipboard e mobile.
- `npm run test:terminal-pty:real`: host SSH descartável 7078; `top` e `htop`, sem achados de dimensões/resize. Primeira saída observada em 30 ms e 44 ms, respectivamente, nesta execução local.
- `session-close-live.cjs`: fechamento da sessão pelo X e redução confirmada da presença ativa.
- Typecheck de frontend/backend e build frontend aprovados. O build mantém o aviso de chunk `vendor-ui` acima de 950 kB (981,15 kB), já observado antes desta alteração.

Host, containers SSH/Redis, Chromium e arquivos temporários de credenciais removidos após a validação.

## Limites operacionais

- Atualize **API e gateway** para o mesmo pacote; ambos precisam do mesmo Redis. Versões antigas não publicam seus túneis no novo registro. Não há migration de banco nesta alteração.
- Túneis continuam sendo listeners TCP no servidor/processo que os criou. O registro distribuído não migra sockets, não recria conexões após reinício e não transforma `localhost` em endereço global do cluster. Compartilhamento automático entre abas continua limitado à mesma instância; abas em gateways diferentes podem criar listeners distintos, agora visíveis e controláveis.
- Proxy web continua usando seus túneis locais e exige o roteamento/afinidade previstos na implantação. Não foi certificado um cluster completo com balanceador nem agente Windows/Private Access real nesta rodada.
- A chave conferida é a do host de destino. A política de confiança do bastion permanece igual à do terminal existente.
- Desativar “auto iniciar” altera próximas conexões; para encerrar um túnel já aberto, use “Parar”. Na queda de um processo, a remoção remota pode levar até a validade do registro mais o intervalo de consulta da interface.
