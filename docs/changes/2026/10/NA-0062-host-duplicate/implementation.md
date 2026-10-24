# NA-0062 — Registro da implementação

## Pedido e objetivo
Implementar fim a fim duplicação de hosts após avaliação aprovada, com testes unitários, E2E, simulações e Playwright.

## Implementação
Base SHA: 66444a9dd4c167453004bb6089278548bdd2c0d9.
Workspace contém mudanças de outras frentes; branch de trabalho herdada feat/NA-0060-snippets-review preservada para não trocar a base de trabalho compartilhada. Nenhum commit ou publicação.
HostsView adiciona Duplicar host aos dois menus, busca cadastro completo, abre formulário novo e somente cria por POST após revisão. Fonte de duplicação identificada no formulário. Helper host-duplicate.ts usa lista explícita de campos; links viram objetos independentes, manuais, sem IDs e metadados do provedor. Senha local, identidade, confiança e permissões específicas não são copiadas. Nome limitado preservando sufixo; IP obrigatório vazio; porta preservada. Referências indisponíveis não podem ser removidas silenciosamente pelo saneamento do formulário. Destino e credenciais continuam validados pelo backend existente.
Manual Hosts atualizado; português e inglês; scripts test:host-duplicate e test:host-duplicate:web.

## Validação
Ran: npm test — 225 arquivos passaram, 10 opt-in ignorados; 1964 testes aprovados e 37 ignorados.
Ran: testes específicos de transformação/HostService/rotas — 51 testes passaram (11 novos de transformação). Cobrem referências, independente do original, omissão de identidade/credenciais locais, protocolos e pastas; backend existente cobre tenant, ACL do destino e acesso a secrets.
Ran: Playwright duplicação — seis combinações claro/escuro × 390/768/1440 passaram. Casos: botão direito e ações, falha 403 ao carregar origem e retry, nenhum rascunho no erro, IP vazio bloqueado, campos/vínculos preservados, novo POST, original intacto, 403 ao salvar preservando rascunho, clique duplo gerando uma só requisição, Cancelar sem escrita.
Ran: cenários separados sem capacidade de criação e pasta pessoal indisponível passaram, sem escrita. HTTP/WebSocket simulados, não constituem validação em servidor de produção.
Ran: typecheck frontend passou; lint do helper sem erros. Build frontend passou (aviso de chunk vendor-ui acima do limite permanece). Regressão do formulário original em desktop passou: 8 gravações e 2 testes de conexão simulados.
Ran: test:manual 2 Node +18 Vitest passou; manual:capture passou (manual, 60 estados de compartilhamento e dois ciclos de tenant).
Manual: capturas de duplicação em /tmp/nodeaccess-host-duplicate; rodada adicional estabiliza capturas aguardando mensagens desaparecerem.
Evidências: /tmp/host-duplicate-*.log e /tmp/nodeaccess-host-duplicate*/results.json.
Skipped: SSH/PTY real e escrita contra hosts reais; sem alteração de terminal/transporte. Sem homologação humana inferida.

## Recuperação
Reverter somente os arquivos/trechos NA-0062, preservando demais frentes. Nenhuma migration, dependência ou configuração nova. Hosts já criados permanecem cadastros normais e não dependem da interface de duplicação.

## Pendências
Sem pendência de implementação. Limites: não copia senha local, histórico, confiança, ACL específica nem token de compartilhamento; referências de macros são compartilhadas, links fixos precisam revisão.

## Diário de interações
### 2026-10-23T08:34:38-03:00 — Implementação autorizada
Pedido de implementação integral atendido com helper de cópia explícita, integração aos dois menus, proteção contra referência perdida e simulações detalhadas. Preservadas outras alterações locais. Nenhum host real foi criado; testes de navegador usam fixtures. Próximo passo: concluir checagens finais e disponibilizar para uso.

### 2026-10-23T08:35:46-03:00 — Fechamento e revisão visual
Build, typecheck, lint do helper, suite geral, 51 testes específicos e Playwright passaram. Matriz inicial completa em 6 combinações; repetição final em 4 combinações após estabilizar screenshots e preservar sufixo no nome longo também passou. Cenários sem criação e referência indisponível passaram. Inspecionadas capturas de duplicação claro/escuro, desktop/mobile e as cinco imagens do manual. manual:check-reviewed e git diff --check passaram; hash Hosts atualizado após revisão. Sem teste em produção, commit ou publicação.
