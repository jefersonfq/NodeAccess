# Feedback Lucien — implementação e validação

Data: 2026-09-10. Escopo: nove itens da avaliação (a solicitação original repetiu o número 6).

## Fluxos entregues

| Item | Comportamento |
| --- | --- |
| HOSTS21 | Preservar seleção, busca principal/lateral e página em sessionStorage por usuário/tenant; URL explícita tem precedência. Filtro removido/inacessível retorna a Todos quando inventário carrega com sucesso. |
| PORTFOWARDING | Em Túneis SSH, abrir túnel e escolher “Disponibilizar na minha máquina”. Selecionar agente pessoal online e porta livre. Endereço fica em 127.0.0.1 no agente, independentemente da rota até o host. |
| SECRETS1 | Consumidores separados por títulos visíveis Hosts e Snippets; secret com apenas snippets não aparece como sem uso. |
| TERMINAL25 | Erros REST SFTP 502/503/504/rede não ativam recarga global; painel mantém tratamento local. Negação de permissão continua sendo 403. A captura sugere recuperação global, mas a causa histórica no Proxy2 exige logs daquele instante. |
| AVISOS1 | Aviso de backend recuperado expira em 6 segundos e é removido na navegação. |
| HOSTS22 | Menu de contexto e botão acessível abrem edição de nome/cor; PATCH exige gerenciador de hosts, escopo de tenant e cor hexadecimal. Renomear preserva ID/associações e trata nomes duplicados. |
| AGENT7 | “Pausar novas conexões”, mantendo atuais; “Retomar novas conexões” para reabrir. |
| AGENT8 | Diferenciar vínculo explícito de uso dinâmico; sessões no banco também impedem indicar revogação segura. Publicação local em uso entra na contagem da instância. |
| Supervisão | Permissão própria no editor de usuário, sem herdar automaticamente de admin ou “ver sessões abertas”. Tela Supervisão de sessões, justificativa, saída somente leitura, registro de início/fim. |

## Atualização e limites

1. Aplicar `20260910150000_session_supervision` pelo fluxo de migrações. A coluna `users.can_supervise_sessions` começa false.
2. Reiniciar API/gateway e publicar o frontend atualizado.
3. Reconstruir e distribuir agente 1.5.0 para publicação local; versão anterior continua no fluxo de acesso existente. Esta tarefa não publica binários nem instala agentes nos computadores de clientes.
4. Em Administração → Usuários → Editar, salvar a permissão específica de supervisão. Esse controle tem salvamento próprio e auditoria; usuários novos podem recebê-lo após criação.
5. Informar a política organizacional de monitoramento. O operador não recebe aviso a cada acompanhamento; isso não remove o dever organizacional de transparência.

Supervisão inicial cobre novas saídas de sessões SSH web, com dimensões do terminal do operador. Não inclui histórico anterior, RDP/VNC, SSH nativo, input, transferência de arquivos, tomada de controle ou captura de clipboard. Redis transporta saída entre processos; falha de autorização, expiração ou buffer excedido fecha observação. Permissão revogada pelo endpoint fecha via evento distribuído; alterações externas de identidade/ACL são verificadas antes da próxima entrega e, em inatividade, em até aproximadamente 2 segundos.

A publicação local exige que o runtime que possui o túnel alcance a conexão autenticada do agente pessoal. Não há encaminhamento novo de publicação entre runtimes; quando não há túnel/agente local elegível, a operação falha explicitamente. Não substitui roteamento/sticky routing do deployment. Somente 127.0.0.1; sem fallback automático de porta no agente e sem acesso por agente de outro usuário. Limites por agente: 16 listeners e 64 conexões locais; buffers limitados. Fechar túnel ou WebSocket do agente fecha listeners/conexões. Manutenção bloqueia novas publicações.

O protocolo de frames existente foi endurecido para exigir a mesma instância de agente proprietária da conexão; controle/dados de outro agente são ignorados mesmo com connectionId válido.

## Validação rápida

- Hosts: selecionar pasta/tag, pesquisar, navegar e voltar; testar link explícito e filtro removido. Editar tag via botão direito e teclado; validar permissão negada e duplicidade.
- Secrets: abrir consumidores com hosts+snippets e com apenas snippets; conferir vazio real.
- Recuperação: gerar flag de recuperação em laboratório e conferir expiração/navegação; simular 503 SFTP e confirmar ausência de reload.
- Agente: pausar/retomar sem interromper sessão; consultar impacto com sessão no banco e zero conexões no registry.
- Túnel: publicar porta livre no agente pessoal, conectar cliente TCP real, testar porta ocupada, outro usuário/tenant, desconexão e fechamento.
- Supervisão: conceder permissão explicitamente, justificar, observar novas saídas sem participante extra; enviar input indevido deve fechar somente o observador. Revogar permissão e verificar fechamento e logs. Confirmar recusa para tenant/host fora do escopo.

## Evidências

- Testes unitários direcionados para tags, impacto, recuperação SFTP e autorização da supervisão.
- Teste com sockets TCP reais do listener do agente (relay e porta ocupada).
- Teste integrado real aprovado: supervisão recebe saída; tentativa de input fecha observador; revogação fecha observação; início/fim auditados; SFTP em diretório proibido retorna 403 e SSH permanece utilizável; agente pessoal publica porta e transporta banner SSH; fechar túnel fecha a porta do agente. Relatório da execução em `/tmp/nodeaccess-lucien-e2e-report.json`.
- Navegador real: expiração do aviso, SFTP 503 sem reload, edição de tag no menu e restauração da seleção e da busca ao retornar a Hosts aprovados. Suíte `test:secrets-vault:web` aprovada (incluindo consumidores hosts/snippets e mobile).
- O sshd descartável precisou permitir `AllowTcpForwarding yes` para o teste de encaminhamento; a configuração inicial bloqueava o canal. Isso não era falha da publicação local.
- `npm run test:terminal-experience:web`: aprovado no Chromium local.
- `HOST_ID=7085 FRONTEND_BASE=http://127.0.0.1:5174 npm run test:terminal-pty:real`: aprovado em container descartável, `top` e `htop`, sem divergência PTY/xterm. Relatórios em `/tmp/nodeaccess-terminal-pty-real` desta execução.
- Incidente histórico do Proxy2: sem acesso aos logs da ocorrência; não atribuir definitivamente a causa à permissão do diretório.

## Ampliação de testes de UX

Cenários adversos, comandos reproduzíveis, correções encontradas e roteiro de avaliação com usuários: [TESTING-lucien-feedback-ux.md](TESTING-lucien-feedback-ux.md). Os testes novos usam dados simulados e complementam a validação SSH real anterior.
