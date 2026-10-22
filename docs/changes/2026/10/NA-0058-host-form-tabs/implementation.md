# NA-0058 — Registro da implementação

## Pedido e objetivo
Implementar, em nova branch, cadastro e edição de hosts com Conexão aberta por padrão e demais configurações em abas, incluindo testes, simulações e atualização do manual.

## Implementação
Base SHA: 1755022aa2e8d884ddf295e3e2470acfdcb5ad24.
Branch: feature/NA-0058-20261022-host-form-tabs.
Worktree: /tmp/nodeaccess-NA-0058. Estado ao consolidar este registro: candidato local em preparação para commit/PR/merge autorizados pelo usuário. Estados e SHAs finais ficam no PR. O checkout original preserva o trabalho MCP/MSI não relacionado.

HostsView.vue reorganiza campos existentes em Conexão, Acesso, Organização e Recursos. HostFormTabNav.vue contém a navegação acessível com setas/Home/End e foco visível; types/host-form.ts define o contrato. Cabeçalho e ações permanecem visíveis, com rolagem dentro da aba. Mantidos bindings e condicionais dos protocolos. Labels PT/EN, erros locais direcionados à aba/campo, proteção contra envio duplicado e preservação de dados após falha.

Correções necessárias identificadas pelos testes/revisão: nomes acessíveis dos seletores Naive UI, seletor CSS compatível com classes do card, limpeza de erro ao editar/reabrir, foco no link associado inválido. A validação heurística antiga de endereço permanece informativa, evitando bloquear hostnames válidos. A promoção administrativa a bastion aparece apenas na edição, onde a ação é executável.

Harness dedicado, scripts existentes adaptados para abas e comando npm run test:host-form-tabs:web. Manual atualizado e capturas demonstrativas regeneradas pela rotina oficial.

## Validação
Ran:
- Baseline host-secret-credentials-playwright contra frontend original: passou.
- Lint dos três arquivos TypeScript/Vue alterados, com --max-warnings 0: passou.
- Build frontend com vue-tsc --noEmit e Vite: passou; aviso de chunk vendor-ui acima de 950 kB e aviso de configuração Vite existentes no ambiente.
- Vitest apps/frontend/src/services/host.service.test.ts: 2 testes passaram.
- Matriz inicial Playwright: seis combinações claro/escuro × 1440/768/390 px, mobile844; cadastro/edição, teclado, senha/Secret/PEM, protocolos, porta personalizada, sucesso/falha de teste e gravação passaram. Matriz final também passou links/macros, cancelamento→edição, hostname válido, foco dos erros e payloads. Cenário 1440×720 passou; recaptura após contraste final passou em desktop e mobile dark.
- host-backed-bastions: passou; hosts-feedback-ux: oito cenários passaram; host-secret-credentials contra frontend novo: passou, sem senha em payload de Secret.
- test:manual: 18 testes + 2 verificações do compilador passaram.
- manual:capture: passou; cinco capturas revisadas, 60 estados de compartilhamento e dois ciclos tenant.
- test:terminal-experience:web: passou, incluindo mobile, foco, entrada, sessões, destaques e cópia/cola.
- manual:check-reviewed: cinco capítulos atualizados; hash calculado após revisão.
- Revisão estática independente: PASS_WITH_WARNINGS, sem bloqueantes pendentes. Correções reconferidas; ressalvas sobre dependências locais, CI limpo e homologação humana. git diff --check passou.

Evidências locais: /tmp/na0058-*.log, /tmp/nodeaccess-host-form-tabs/results.json, /tmp/nodeaccess-hosts-feedback-ux.json e /tmp/na0058-terminal-experience.json. Não são evidências de um commit novo: o SHA acima identifica apenas a base; a execução cobre o conteúdo LOCAL_WIP.

Ambiente: dependências já instaladas no workspace compartilhadas por symlink, sem alteração de lockfile; Vue 3.5.43, Naive UI 2.45.3, Vite 8.3.4, Playwright 1.64.0. Build final com Node 24.19.0. A primeira execução usou Vite raiz 8.3.4. Nesta rodada foi configurado o binário nested Vite 7.3.7 já instalado no workspace original, correspondente ao lockfile; CI fará instalação limpa. Não houve instalação/atualização de dependências nesta frente.

## Recuperação
Worktree isolado, sem migração nem configuração de produção. Reverter apenas arquivos desta frente. O checkout original permanece preservado. Capturas e simulações usam dados fictícios e APIs/WebSockets interceptados.

## Pendências
Preview homologado pelo usuário, que autorizou o merge e solicitou o polimento final. Checks do candidato e merge/sincronização serão registrados no PR. Não executado PTY real: não houve alteração de resize, transporte SSH ou área útil do terminal. Não executado benchmark completo de hosts-cdp-perf; apenas adaptação do seletor à aba Recursos. Nenhuma garantia de adoção ou ausência absoluta de regressões é inferida.

## Diário de interações

### 2026-10-22T11:14:19-03:00 — Implementação autorizada
Usuário aprovou conexão padrão e abas contextuais e solicitou implementação fim a fim em nova branch. Skills frontend, lifecycle e manual aplicadas. Fetch confirmou base atual; nova branch/worktree criados para preservar WIP não relacionado. Nenhuma autorização de publicação inferida.

### 2026-10-22T11:12:00-03:00 — Implementação e validação
Reorganização, acessibilidade, validação contextual e manual implementados. Simulações encontraram erro residual de endereço e rodapé fora da tela tablet; ambos corrigidos. Revisão independente confirmou preservação de bindings/ações e indicou cobertura adicional de recursos e alturas menores, concluída com aprovação da matriz. Build, lint, testes de serviço, manual e terminal passaram. Próximo passo: homologação humana da entrega LOCAL_WIP.

### 2026-10-22T11:19:08-03:00 — Evidências finais
Matriz enriquecida 6/6, altura720 e recaptura dark2/2 passaram; prints finais inspecionados. Ajuste de contraste dark compilado com Vite e hash do manual revalidado. Evidências consolidadas em imgs_debug/host-form-tabs (ignorado pelo Git), incluindo source-hashes.json para identificar o conteúdo WIP. Harnesses usam APIs/WS simulados; nenhum host de cliente foi alterado. Lint, tipos, build e demais resultados acima referem-se à execução local; homologação e CI limpo continuam pendentes.

### 2026-10-22T11:37:35-03:00 — Desbloqueio para homologação local
Usuário solicitou desbloquear a conta administrativa após excesso de tentativas no preview. Proxy confirmado para backend local porta3000 e banco localhost3306. Removido somente o bloqueio temporário da conta administrativa padrão e zerado contador de falhas; verificados lockedUntil nulo, contador zero, conta ativa e hash de senha preservado. Nenhuma outra conta ou política alterada; nenhum login com senha foi tentado. Próximo passo: usuário repetir login com suas credenciais atuais.

### 2026-10-22T12:10:14-03:00 — Homologação, polimento e merge autorizados
Usuário aprovou o preview e solicitou merge, revisão de alinhamento com prints e transição leve. Causa: itens NFormItem esticados pelo grid centralizavam controles ao lado de textos de ajuda maiores. Aplicado align-items:start somente nos dois grids. Animação CSS de 140ms nos painéis, sem recriar DOM, com prefers-reduced-motion:none. Prints before/after inspecionados; assertions de alinhamento ≤1px e movimento reduzido adicionadas ao harness. Revisão estática independente PASS; manual revalidado. Harness integrado ao CI Manual pilot e artefatos de capturas incluídos. Nenhuma dependência de produto adicionada. CLI oficial GitHub obtida com checksum verificado para usar autenticação existente; SSH também verificado. Próximos passos autorizados: consolidar candidato, executar checks no SHA final, abrir PR, mergear após aprovação dos checks e sincronizar preservando WIP MCP/MSI.

### 2026-10-22T12:13:01-03:00 — Candidato de integração
Build com Vite 7.3.7 e vue-tsc passou; lint de 3 arquivos sem avisos, manual:check-reviewed e diff-check passaram. Matriz de polimento confirmou alinhamento ≤1px e animação desativada por movimento reduzido: desktop/tablet dark passaram, browser encerrou na sequência; mobile dark e os 3 cenários light passaram em reexecuções isoladas. Falha de infraestrutura preservada no registro, sem relaxar asserts. Revisão independente incremental PASS. O candidato será commitado e a matriz completa será repetida no SHA exato, com CI no PR antes do merge. O preview recebeu homologação humana na conversa; não há autorização de deploy/release.
