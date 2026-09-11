# Regressão do feedback Lucien: UX e cenários adversos

## Execução reproduzível

Usar o frontend Vite local. As suítes de navegador interceptam a API com fixtures fictícias; a supervisão usa WebSocket simulado. Não cadastrar usuários, hosts ou agentes em ambiente real para executar estes testes.

```bash
FRONTEND_BASE=http://127.0.0.1:5186 npm run test:lucien-feedback:ux
FRONTEND_BASE=http://127.0.0.1:5186 PLAYWRIGHT_EXECUTABLE_PATH=/usr/bin/chromium-browser npm run test:secrets-vault:web
FRONTEND_BASE=http://127.0.0.1:5186 npm run test:forwardings:web
FRONTEND_BASE=http://127.0.0.1:5186 PLAYWRIGHT_EXECUTABLE_PATH=/usr/bin/chromium-browser npm run test:agents:web
npm run test:lucien-feedback:core
npm run typecheck
FRONTEND_BASE=http://127.0.0.1:5186 npm run test:terminal-experience:web
```

A suíte técnica importa a configuração do backend e precisa das variáveis do ambiente de testes. Nesta validação foi executada com `node --env-file=apps/backend/.env node_modules/vitest/vitest.mjs run` e os mesmos arquivos do script `test:lucien-feedback:core`. O listener usa TCP real em loopback e portas efêmeras, sem SSH externo. Para Chromium em outro caminho, definir `PLAYWRIGHT_EXECUTABLE_PATH`.

## Matriz coberta

| Fluxo | Simulações e critérios observáveis |
| --- | --- |
| Supervisão | Título e limites visíveis; vazio sem ação de acompanhar; justificativa vazia/espaços bloqueada; campo acessível por nome; ativação por teclado; motivo enviado na autenticação; saída renderizada; digitação não envia comandos; encerramento explícito; falha de permissão remove lista desatualizada; nova tentativa recupera. |
| Estrutura e responsividade | Supervisão nos temas claro/escuro, desktop 1366×900 e mobile 390×844; página sem overflow horizontal; terminal com rolagem própria; ações visíveis e saída descartada ao encerrar. Capturas revistas visualmente. |
| Permissão administrativa | Falha de consulta não habilita gravação; tentativa posterior recupera; switch tem nome acessível; valor enviado explicitamente; mensagem de sucesso desaparece ao editar novamente. |
| Agentes | Diagnóstico textual, sem depender apenas de cor; zero hosts com sessão ativa não significa ausência de uso; falhas de impacto/manutenção têm feedback local; retentativa; ausência de sucesso para operação rejeitada. Suíte existente atualizada para os nomes novos. |
| Tags | Abertura por teclado; nome e cor acessíveis; duplicidade preserva edição; cancelamento não grava; sucesso preserva ID e atualiza nome/cor. |
| Navegação em Hosts | Seleção e busca retornam após navegação; parâmetros explícitos da URL prevalecem; referência removida e JSON inválido não quebram a página; usuário diferente não recebe a busca do anterior. |
| Recuperação/SFTP | Aviso expira e desaparece na navegação SPA sem recarga; falhas 403/502/503/504 e rede mantêm o documento, usando o interceptor real do frontend. |
| Secrets | Títulos distinguem hosts/snippets; somente snippets não aparece como vazio; nenhum uso remove consumidores anteriores; mantém busca, mobile, erro de rede, proteção de duplo envio e ausência de segredo em storage. |
| Túnel local | Sem agente pessoal elegível impede publicação; outro proprietário/agente de serviço excluídos; portas reservadas, fora do intervalo, decimais e vazias bloqueadas; conflito preserva valores; nova tentativa publica e mostra endpoint. |
| Backend | Permissão explícita; identidade revogada; tenant inativo; sessão encerrada; ACL efetiva na consulta/lista; dimensões inválidas; saída não persistida; limpeza de dimensões; agente desconectado antes da confirmação; rejeição de portas privilegiadas e frames desconhecidos; TCP loopback e porta ocupada. |

## Problemas encontrados e corrigidos

- Campo de justificativa e nome da tag sem nome acessível efetivo no input.
- Lista antiga ainda oferecia acompanhamento após consulta negada.
- Consulta de permissão sem ação para tentar novamente; aviso de sucesso permanecia após nova edição. Respostas atrasadas também são ignoradas ao trocar de usuário.
- Erros das operações do agente escapavam sem feedback no painel. Agora exibem erro local e não disparam sucesso/atualização.
- Porta decimal era aceita pelo botão de publicação. A validação agora exige inteiro também na função que envia; consulta de agentes distingue carregamento de ausência de agentes.
- Texto do Secret sem consumidores citava apenas hosts. Agora informa hosts e snippets.

## Evidências e limites

Execução de 2026-09-10: suíte técnica com 27 testes aprovada; nova suíte de UX com 14 cenários (7 em cada tema) aprovada; Hosts com 4 grupos de cenários aprovado; Secrets com 11 grupos aprovado; encaminhamentos com 17 grupos aprovado; suíte existente de agentes e regressão do terminal aprovadas.

Relatórios locais desta execução: `/tmp/nodeaccess-lucien-ux/report.json`, capturas `supervision-{dark,light}-mobile.png` no mesmo diretório e `/tmp/nodeaccess-hosts-feedback-ux.json`. As outras suítes imprimem o relatório no stdout e retornam código não zero em falha.

Os testes automatizados verificam texto, estrutura, interação e estados. Não demonstram compreensão por pessoas, conformidade integral WCAG ou transporte SSH real. O teste SSH real da entrega anterior está registrado em `OPERATIONS-lucien-feedback-2026-09-10.md`; nesta rodada o transporte SSH não foi alterado.

## Roteiro curto para validação com usuários

Sem explicar previamente a solução, pedir a um operador para:

1. Encontrar um host, navegar para outra tela e retomar a busca; renomear uma tag e explicar quais hosts serão afetados.
2. Dizer onde um Secret está sendo usado quando há apenas um snippet.
3. Explicar o que acontece com uma sessão ativa ao “Pausar novas conexões”, inclusive com zero hosts vinculados.
4. Publicar um túnel local, resolver uma porta ocupada e apontar em qual computador o endereço funciona.
5. Como auditor autorizado, iniciar/encerrar acompanhamento e explicar o limite de somente leitura e a ausência de histórico anterior.

Registrar conclusão sem ajuda, erros, pedidos de explicação, recuperação após falha e interpretação incorreta. Esses resultados humanos permanecem pendentes; não são inferidos dos testes automatizados.
