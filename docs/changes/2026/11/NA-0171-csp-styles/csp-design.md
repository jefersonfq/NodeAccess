# CSP de estilos — desenho e limites

A política autoriza elementos `style` somente da própria origem ou com nonce criptográfico da resposta. A exceção `style-src-attr 'unsafe-inline'` permanece explícita para atributos de layout; não é autorização de elementos `style` arbitrários. O experimento Chromium com atributos bloqueados gerou violação em NaiveUI no login; Monaco também usa atributos para posições, seleções e linhas. ZAP deve avaliar a política completa; eventual alerta residual não deve ser marcado automaticamente como falso positivo.

## Nonce e entrega do documento

`docker/csp/document.js` atende apenas o documento SPA. Usa 32 bytes de `crypto.getRandomValues`, substitui o placeholder Vite e preenche a variável usada no header da mesma resposta. Ausência do placeholder ou erro de aleatoriedade retorna 503 sem HTML. Não existe fallback para timestamp, request_id ou nonce fixo. As imagens nginx utilizadas já incluem o módulo njs; configurações completas o carregam, e fragmentos HTTP dependem do carregamento no contexto principal.

`index.html` não responde 304 e usa `Cache-Control: no-store`. Assets conservam cache versionado e não recebem nonce no header. A exceção de `/api/v1/web-access/proxy` preserva a política dos documentos remotos. O service worker muda a geração do cache, não armazena HTML mesmo em fetch programático, ignora HTML previamente cacheado e retorna texto inerte quando a navegação está offline.

## Emissores de CSS revisados

NaiveUI/css-render e xterm instalados não expõem API suficiente de nonce. Patches restritos adicionam a leitura de `meta[property="csp-nonce"].nonce` somente nos emissores conhecidos. O manifesto mantém SHA256 de cada arquivo original e quantidade exata de substituições. Mudança de conteúdo ou desaparecimento de emissor num pacote instalado falha explicitamente no postinstall; instalação exclusivamente backend pode não conter essas bibliotecas.

Monaco passa de loader CDN para pacote local `0.55.1`, carregado sob demanda junto dos workers Vite, e patches em `domStylesheets.js` e `contextview.js`. O runtime é importado somente ao abrir o editor. O helper compartilhado de preload do Vite fica em chunk próprio para não antecipar Monaco no login; o harness exige zero requests de editor/runtime/CSS/workers antes da abertura. Nenhuma interceptação global de `createElement`, MutationObserver ou autorização automática de elementos desconhecidos é usada. Remover os patches quando as respectivas bibliotecas oferecerem API nativa adequada; upgrades exigem revisão dos novos emissores.

`script-src` continua sem unsafe-inline/eval e agora usa somente a própria origem. Zod detecta suporte a Function em runtime e o browser bloqueia a tentativa, mantendo o fallback; o harness registra especificamente essa violação conhecida, sem ampliar a política.

## Validação e manutenção

- `npm run test:csp:web`: estilos negativos, documento real, cache/nonces, editor real, busca, worker, temas/reabertura e WebSocket real por nginx. Exige fixture `csp-ws-fixture.cjs` disponível em `/ws/csp-probe`.
- `node --test docker/csp/document.test.mjs scripts/dependency-patches/csp-styles.test.mjs tools/frontend/service-worker-csp.test.mjs`: falha fechada, idempotência e cache.
- `RUN_CSP_PROBE_REAL=true node --test tools/frontend/csp-probe-real.test.cjs`: bloqueio de download do módulo local em Chromium.
- `.github/workflows/frontend-csp.yml`: HTTP e HTTPS com certificados descartáveis, módulo njs montado, pacote fixado e terminal sobre a build.
- `tools/deploy/engineering-security-headers-harness.py`: quatro perfis nginx e preservação de headers/exceções. Não substitui a validação da imagem Kubernetes com usuário não root.

Os testes de interface e transporte existentes continuam necessários. Não há probes nem comandos adicionados ao uso normal do terminal. A migração local aumenta os assets servidos pela aplicação (chunk Monaco final observado: 4,27 MB, gzip 1,10 MB); o aviso de bundle é mantido.

## Referências primárias

- [Vite html.cspNonce](https://vite.dev/config/shared-options.html#html-cspnonce).
- [njs Web Crypto](https://nginx.org/en/docs/njs/reference.html#crypto).
- [nginx 1.30.6 request_id e fallback RNG](https://raw.githubusercontent.com/nginx/nginx/release-1.30.6/src/http/ngx_http_variables.c).
- [Monaco — discussão oficial de estilos inline](https://github.com/microsoft/monaco-editor/issues/271).

## Sanitização do editor

Monaco0.55.1 inclui DOMPurify3.2.7 vendorizado no ESM. O override restrito para DOMPurify3.4.17 é acompanhado de patch SHA256 do import em domSanitize.js para o pacote npm; somente atualizar o lock não removeria o código vulnerável do bundle. A biblioteca fica no chunk lazy do editor. O harness verifica versão corrigida presente e versão antiga ausente no JavaScript entregue, e testa sanitização real sem CSP para evitar mascarar XSS.

Referências: [release oficial 3.4.17](https://github.com/cure53/DOMPurify/releases/tag/3.4.17) e [advisory IN_PLACE](https://github.com/cure53/DOMPurify/security/advisories/GHSA-mrv2-3pqr-j5jr).
