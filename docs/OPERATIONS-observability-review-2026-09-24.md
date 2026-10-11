# Revisão de observabilidade — 24/09/2026

## Diagnóstico e limites

O coletor executa `docker stats --no-stream --format json` dentro do ambiente da API. Na configuração anterior à correção, a imagem em `docker/backend.Dockerfile` não instalava Docker CLI; o serviço API em `docker-compose.yml` não monta o socket do Docker. Essa configuração impede a coleta. A implantação efetiva de produção não foi inspecionada nesta revisão; nenhuma permissão ou montagem de socket foi adicionada automaticamente.

A mensagem genérica também ocultava timeout de processo (sinal/killed), permissões insuficientes e daemon inacessível. O coletor agora diferencia esses casos e respostas inválidas, sem expor stderr bruto. Saída parcialmente válida preserva as linhas válidas e indica coleta parcial; saída vazia válida continua distinta de falha. Falha de coleta não comprova containers parados.

## Comportamento da interface

- Causa Docker visível sem abrir detalhes; orientações de configuração no painel Containers.
- Atualização com erro mantém a última coleta e indica dados desatualizados. Nova tentativa recupera o estado; HTTP 401/403 elimina o snapshot anterior.
- Carregamento bloqueia novas atualizações pelo botão e preserva os dados exibidos.
- “Carga por núcleo” representa load average dividido pelos núcleos, não utilização de CPU. Pode superar 100%.
- Escopo local, cache e coleta sob demanda explícitos. Ausência de histórico/discos não simula valores saudáveis.
- Backups indicam presença/idade de arquivos, sem garantia de restauração ou integridade.
- Componentes com falha exibem o diagnóstico; rede e I/O Docker são acumulados, não taxas.
- API exige administrador de plataforma, alinhada à restrição já aplicada na rota da tela. Administrador apenas de tenant recebe 403 antes de iniciar coletores.

## Validação reproduzível

```sh
npm run test:observability:core
FRONTEND_BASE=http://127.0.0.1:5178 npm run test:observability:web
npm run typecheck -w apps/backend
npm run typecheck -w apps/frontend
```

O teste web requer frontend iniciado e Chromium em `/usr/bin/chromium-browser`. Usa HTTP/WebSocket simulados, sem consultar ou modificar produção. Evidências em `/tmp/nodeaccess-observability-review/` (JSON e screenshots).

Cobertura: 19 testes do coletor e 6 da política de acesso; navegador em temas claro/escuro, desktop 1440×960 e celular 390×844. Simulações incluem falha inicial 503, perda de comunicação, recuperação, resposta atrasada, cinco causas Docker, ausência de dados, componente degradado e revogação de permissão. Verifica ausência de exceções de página e overflow horizontal. Esses testes não homologam Docker real nem disponibilidade da infraestrutura implantada.

Arquivos principais: `apps/frontend/src/views/admin/ObservabilityView.vue`, `apps/frontend/src/services/observability.service.ts`, `apps/backend/src/modules/observability/observability.service.ts`, `apps/backend/src/modules/observability/observability.routes.ts`. Testes em arquivos adjacentes e `tools/frontend/observability-resilience-playwright.cjs`; fixtures compartilhadas com `observability-cdp-harness.cjs`.

## Docker CLI nas instalações e atualizações

O `docker/backend.Dockerfile` agora instala `docker-cli` nas imagens de desenvolvimento e produção. O script `scripts/release/build-release.sh` usa esse Dockerfile ao gerar a imagem: a próxima release construída incorpora o CLI, inclusive nos pacotes offline. Instalar novamente uma imagem antiga não adiciona o pacote.

O preparo do servidor (`scripts/deploy/prepare-nodeaccess-host.sh`, chamado pelo instalador principal) já instala Docker Engine e CLI quando necessário e autorizado por `AUTO_INSTALL_DOCKER=true`. Essa instalação no host não substitui o CLI dentro do container da API. Não é necessário instalar pacotes a cada inicialização da aplicação.

Validação pontual: instalação real de `openssl docker-cli` em container descartável `node:20-alpine`, consulta de versão e simulação de daemon ausente; suíte `npm run test:observability:core`. Não foi reconstruída a release completa nem alterada a instalação de produção.

O Compose atual não fornece um endpoint Docker à API. Incluir o CLI resolve a ausência do executável; a coleta ainda requer um endpoint autorizado. Acesso ao socket permite operações privilegiadas no daemon, portanto não foi acrescentado implicitamente pelo instalador.
