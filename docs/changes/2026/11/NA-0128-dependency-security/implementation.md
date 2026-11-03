# NA-0128 — Registro da implementação

## Pedido e objetivo

Resolver falha de dependências da PR 59 preservando política all-dependencies.

## Implementação

Base SHA: 8dae9b49a8dab89b9c0a7c4fcb4a29a1d401662d. Worktree `/tmp/nodeaccess-NA-0128`, branch própria. Nenhuma atualização aplicada ainda.

## Validação

Log CI confirmou 19 ocorrências (17 moderate/2 high), runtime 5 (4 moderate/1 high). Consulta npm em andamento; números CI não equivalem a advisories únicos.

## Recuperação

Manifests/lock isolados; não alterar instalação compartilhada.

## Pendências

Inventário, comparação base, atualização mínima, testes e revisão. Workbook/índices coordenados pela integração.

## Diário de interações

### 2026-11-03T19:03:25.238566-03:00 — Escopo e investigação

Plano criado antes de mutações das dependências. Sem redução de política ou aceitação automática de risco; ausência de correção compatível será reportada com evidência.

### 2026-11-03T19:11:00-03:00 — Inventário e escolha do ensaio

Quatro advisories explicam os 19 nós afetados: GHSA-mrwp-f3q8-3g9p (follow-redirects), GHSA-4528-x5fx-h6hg (Joi), GHSA-g3hv-75wg-m249 (minimatch), GHSA-3g3m-2fjr-6pw4 (glob). Versões afetadas já idênticas na base 4a77f713, portanto não introduzidas pela frente Sonar. Fontes primárias: GitHub Advisory Database e metadados/tarballs oficiais npm.

Patches/minor follow-redirects1.16.2 e Joi18.3.1 cabem nos ranges. Consumers latest consultados ainda declaram glob^13 (@fastify/static10.1.8) e minimatch^10 (eslint10.14, config-array0.23.5, typescript-estree8.72.1, typedoc0.28.20). Vue language-core3.3.14 remove minimatch, mas sua atualização major não resolve os outros consumidores.

Após apresentar alternativas à integração, autorizado ensaio isolado de overrides minimatch11.0.1 e @fastify/static→glob14.0.2. Ambos mantêm exports CJS/ESM e engines18/20/>=22; APIs reais consumidas: minimatch(), new Minimatch().match(path, partial), pattern; glob Promise com cwd/absolute/follow/nodir/dot/ignore. O motor de matching v11 mudou profundamente segundo README oficial, logo metadados sozinhos não provam compatibilidade. Não aplicado audit fix --force nem downgrade sugerido automaticamente.

npm11 manteve entradas antigas no lock incremental mesmo após update. Resolução limpa corrigiu mas atualizou111 entradas; ela foi preservada somente em /tmp para diagnóstico. Lock candidato retém as versões originais exceto os quatro pacotes afetados, path-scurry3 exigido por glob e novo @isaacs/nonrecursive-glob-match1.0.3 exigido por minimatch. Três nós Vue antigos removidos. Metadados/integrities desses seis vieram da resolução npm; npm ci isolado valida o grafo. Nenhuma instalação compartilhada alterada.

### 2026-11-03T19:30:09-03:00 — Compatibilidade, rotina e revisão

npm12.2.1 foi necessário para representar corretamente overrides de workspaces no SBOM; npm11.12.1 instalou versões corrigidas mas recusou arestas como inválidas. `security:check` permanece all-dependencies e falha se SBOM inconclusivo. Pin explícito antes de17 instalações em11 workflows; Node24.21.0 mantido e packageManager alinhado, engines/allowScripts sem redução. Instalação final normal npm12 executou postinstall aplicado e instalou684pacotes, seguida de db:generate/shared,11contratos e security:check completo PASS(runtime0/all0/SBOM).

TypeDoc0.28.20latest usa matchOne removido: CLI real falhou antes do patch. Root autorizou correção pequena via postinstall. Guard exige versão e hash integral original, aceita reaplicação idempotente e recusa origem/versão desconhecida; ausência da ferramenta no runtime retorna not-installed. Uma atualização futura de TypeDoc exigirá remover/revisar conscientemente o patch, não apenas substituir hash. API pública partial mantém significado não negado via XOR;143comparações documentam142iguais e1poda de diretório oculto mais cedo, cujos descendentes continuam sem match. Não há promessa de equivalência universal; raiz-only não chega ao callback, **/../ não usado na configuração do projeto. Erro de entrypoint brace reproduziu também na baseline, fora do escopo. CLI real wildcard de pacotes aninhados/exclusões passou; CLI shared gerouJSON com2warnings, sem erros.

As6regressões reais foram promovidas a scripts/dependency-patches/dependency-compatibility.test.cjs; mais5testes do patch/CLI compõem npm run test:dependency-compatibility, chamado pelo securityjob. O coletor normal confirmou descoberta dos2arquivos após staging. CasosDoS têm subprocessos comdeadline3s, HTTP tem deadlines explícitos e cleanup. Duas falhas reais reproduzidas na versão anterior (glob continua leitura apósabort e followredirects envia cabeçalho sintético crossrealm) passam na candidata. Revisor frontend reproduziu6/6; revisor backend reproduziu11/11 e aprovou diff final com limites.

Build completo shared/backend/frontend e typecheck completo passaram com os novos pacotes. Vitest focal108PASS+1skip. Lint global com novo matcher e antigo no MESMOcheckout produziu exatamente481paths e20584diagnósticos iguais; não é alegação de lint global limpo. Após reinstalação, erros unsafe da lista89 decorreram de Prisma não regenerado, corrigido executando procedimento normal db:generate; rerun final de92arquivos (89+3tooling) passou com zero erros/avisos após regeneração.

Dockerfiles ativos receberam somente COPY do hook antesnpmci. Camadas base frontend/backend foram construídas de verdade e executaram hooknot-installed nos subsets. Versões reais backend glob14.0.2/minimatch11.0.1 e frontendminimatch11.0.1/vue-tsc2.2.12 confirmadas. NpmDocker e arquivoNOTE não alterados: install comprovado, sem prometer SBOM npm11. Sem build completo das imagens de produção ou implantação nesta frente. Downloads npm explícitos no CI introduzem dependência do registry e cache npm normal; versão fixada.

Limites: pacotes major transitivos podem diferir em padrões arbitrários; testes representativos não certificam todos consumidores. GitHub hosted CI e scanner da integração ainda pendentes, sem relaxar gates. Workbook/índices continuam coordenados pela frente principal.

### 2026-11-03T19:32:00-03:00 — Fechamento local

92 arquivos passaram no lint final; security:check completo,11contratos e revisão independente final passaram. Evidências e planos sincronizados à pasta canônica. Checkpoints locais preparados para integração; sem merge/publicação ou aceitação automática de riscos. Próximo passo: integração e CI hospedado pela frente principal.
