# NA-0087 — Evidências locais

Ambiente: worktree `/tmp/nodeaccess-NA-0087`, Node 24, Vite em localhost:5197, Chromium headless 1234, APIs e WebSockets simulados. Não representa produção nem homologação humana. Base `3aa5513789d63ef24b3e268c5f2077fde7db616e`.

| Validação executada | Resultado |
|---|---|
| `npx vitest run apps/frontend/src` | 78 arquivos / 742 testes passaram; um teste opt-in ignorado |
| `text-boundaries.test.ts` | 7 testes; equivalência exaustiva curta, 20 mil amostras determinísticas, entradas de 200–500 mil caracteres; limites de 1500 ms preservados |
| ESLint de todos os fontes alterados e helpers novos | Passou, sem avisos |
| `npm run build --workspace @nodeaccess/frontend` | Typecheck e build passaram; aviso existente de chunk UI maior que 950 kB, limite não alterado |
| `npm run test:terminal-experience:web` | Passou: geometria, teclado/mouse, paste, confirmação/cancelamento e modos de terminal |
| `sonar-frontend-review.cjs` | 44 ocorrências de label e 10 controles nativos/autocomplete, cada uma com DOM derivado do fonte, nome acessível, foco e mobile sem overflow; indicador de host real com Enter/Escape |
| `snippets-page-playwright.cjs` | Passou em desktop/mobile; budgets originais mantidos, sem erros browser |
| `platform-settings-playwright.cjs` | Dois perfis, persistência/dependências/falha e reabertura de licença; mobile 390 px e contraste 13,88 |
| `audit-reconstruction-playwright.cjs` | 6 cenários: completo desktop/mobile, parcial, indisponível, retry GET e falha POST; sem erros de UI |
| `observability-resilience-playwright.cjs` | Passou: falhas, disponibilidade, vazio, permissão negada limpa dados, mobile 390 px sem overflow |
| `graphical-compositing-playwright.cjs` | Pixels reais Porter-Duff, restauração de estado e caminhos intercalados passaram |
| `royalts-import-playwright.cjs` | 6 cenários: validação, commit, rollback, rollback parcial, falha de histórico, preview expirado |
| `npm run manual:capture` | Três rotinas passaram; cinco imagens reais de fluxos simulados revisadas visualmente |
| `npm run test:manual` | TAP + 18 testes Vitest passaram |
| `npm run manual:check-reviewed` | Cinco capítulos current; hashes de hosts, terminal e tenants revalidados |
| `git diff --check` | Passou |

Reprodução dos browsers: definir `FRONTEND_BASE=http://127.0.0.1:5197` e `PLAYWRIGHT_EXECUTABLE_PATH` para Chromium disponível. O harness próprio aceita `--workflow <nome>-playwright.cjs` apenas para a lista permitida de simulações existentes e captura suas telas. As fixtures usam dispositions.json sanitizado por padrão; SONAR_ASSIGNED permite apontar inventário original quando necessário. Nenhum conteúdo privado é salvo nas evidências. `MANUAL_EXPECTED_VERSION=dev` corresponde ao build local sem versão de release.

A árvore acessível das 44 ocorrências consta em [dom-label-evidence.json](dom-label-evidence.json). As fixtures usam componentes Naive UI reais e marcação extraída dos arquivos revisados, mas valores sintéticos; não substituem teste de leitor de tela humano. Os dois atributos autocomplete em NInput foram movidos para input-props após o DOM mostrar que não chegavam ao input nativo. NSelect multiple expõe o input de pesquisa quando ativado, por isso o ensaio ativa o seletor antes de verificar nome/foco. Os fluxos reais renderizados da aplicação são cobertos pelos harnesses separados.

Revisão visual: [licença mobile](screenshots/platform-settings-2.png), [snippets mobile](screenshots/snippets-page-1.png), [auditoria completa](screenshots/audit-reconstruction-1.png), [auditoria indisponível mobile](screenshots/audit-reconstruction-4.png), [observabilidade sem permissão](screenshots/observability-resilience-2.png). Labels mantêm hierarquia; checkbox passa a tornar o texto clicável; seletores ganham pesquisa acessível; métricas estáticas deixam Tab. Nenhuma faixa nova foi adicionada ao terminal. Capturas de fixtures são técnicas, não propostas de layout.

Tentativas corrigidas: primeiro teste de email identificou semântica de pontos finais/múltiplos, corrigida antes do passe; fixtures iniciais assumiram spinbutton no NInputNumber, mas DOM real é textbox; ajustado o teste à biblioteca. Captura inicial do manual esperava versão de demonstração inexistente; repetida com versão dev real. Captura de licença no instante da animação foi refeita após estabilização. O harness de auditoria inicialmente procurou Chromium não instalado; repetido com executável disponível, sem instalar dependências. Nenhum limite de teste foi relaxado.

Skipped: PTY real, pois não houve alteração de resize, WebSocket ou transporte SSH. Planned: reanálise Sonar integrada na NA-0089 e homologação humana. Não houve varredura Sonar concorrente nesta frente.
