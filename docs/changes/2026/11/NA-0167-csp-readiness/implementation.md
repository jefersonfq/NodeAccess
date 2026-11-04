# NA-0167 — Registro da implementação

## Pedido e objetivo
Concluir o CI de segurança autorizado, com diagnóstico verificável.

## Implementação
Base SHA ae062494453585d5fec49da60786fb62257a6490. Investigação confirmou dois defeitos de prontidão: erro de loader era aceito como condição suficiente para prosseguir, e `window.editor` podia resolver o elemento DOM `id=editor`. Novo helper `csp-probe.cjs` mantém estado loading/ready/error e instância em namespace próprio, rejeita falhas explicitamente e verifica métodos/ausência de nodeType. Timeout de 45000 ms preservado. Harness mantém verificações de edição, worker, WS/WSS e bloqueios CSP. Diagnósticos de falha limitados a fase, categorias, códigos conhecidos, status HTTP e no máximo 32 eventos; sem URLs, headers ou mensagens brutas. `.github/workflows/frontend-csp.yml` inclui os novos arquivos no filtro de caminhos, para que alterações futuras no helper também acionem o gate. Nenhum CSS, produto ou política Nginx alterado.

## Validação
Ran no worktree `/tmp/nodeaccess-NA-0167`, base acima + diff LOCAL_WIP:
- Baseline HTTP anterior à edição: harness CSP completo passou localmente. CDN indisponível não foi reproduzido espontaneamente; não é causa comprovada do CI.
- Build reutilizado da integração após `git -C /tmp/nodeaccess-NA-0093 diff --exit-code ae062494453585d5fec49da60786fb62257a6490 -- apps/frontend packages/shared docker/nginx.http.conf docker/nginx.https.conf package-lock.json` retornar zero. Cópia de dist somente para worktree167; raiz não modificada.
- `PLAYWRIGHT_EXECUTABLE_PATH=/root/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome FRONTEND_BASE=http://127.0.0.1:18667 REPORT_PATH=/tmp/na0167-csp-http.json node tools/frontend/csp-security-playwright.cjs`: passou. HTTPS equivalente em 18668 com `CSP_SELF_SIGNED=1`: passou; `/tmp/na0167-csp-https.json`. Ambos usam Nginx de produção inalterado, Monaco/CDN reais, edição, worker, WS/WSS e inline/eval bloqueados, sem mock positivo.
- `RUN_CSP_PROBE_REAL=true ... node --test tools/frontend/csp-probe.test.cjs tools/frontend/csp-probe-real.test.cjs`: 8 passaram, zero skips. Falha CDN injetada apenas no negativo Chromium; sob CSP real retorna LOADER_UNAVAILABLE e não confunde DOM com editor.
- Mesmos testes sem opt-in: sete contratos Node passaram, um real explicitamente skipped. Casos: DOM collision, loader ausente, AMD erro, criação erro, marcador ready inválido, timeout original e redaction.
- Harness completo com Chromium isolado configurado `--host-resolver-rules=MAP cdn.jsdelivr.net ~NOTFOUND`: exit1 esperado. `/tmp/na0167-csp-cdn-unavailable.json` confirma fase editor-load, LOADER_UNAVAILABLE e categoria monaco/ERR_NAME_NOT_RESOLVED sem URL. Isso prova diagnóstico do erro controlado; não estabelece causa do CI.
- ESLint dos quatro arquivos JS: passou com zero avisos; `git diff --check`: passou. Inventário de cobertura descobre helper e ambos testes automaticamente.
- Runtime Node host: `/tmp/na0093-owned-runtime/bin/node`; fixture WS Docker usa imagem local Node24.21.0-alpine, diferente do24.22.1 do CI. Nginx1.30.5-alpine, Chromium informado pela orquestração, rede `na0167-csp`, containers próprios com CPU/memória/pids limitados. Certificado HTTPS descartável local.
Planned: revisão independente, validação Sonar integrada e CI final. Nenhum pipeline completo executado por este implementador.

## Recuperação
Branch isolada, sem tocar recursos de produção.

## Pendências
Sincronização de documentos/planilha canônica pela orquestração, Sonar e CI do candidato final. Revisão independente recebida e commit autorizado, conforme entrada abaixo. Causa de carga no CI permanece desconhecida; os próximos erros produzirão diagnóstico seguro. Containers/rede/certificados descartáveis na0167 foram removidos após guardar evidência sanitizada.

## Diário de interações

### 2026-11-04T18:28:36-03:00 — Falhas hospedadas CSP
Job126871774874 expirou45000ms; repetição126874725877 falhou window.editor.getValue is not a function. Harness permite seguir quando probe.error existe e usa global com mesmo nome do idDOM. Causa de carga ainda não comprovada; nenhum relaxamento autorizado.

### 2026-11-04T18:32:54-03:00 — Correção de prontidão e laboratório real

Implementado escopo acima após baseline local. Toda falha de carga encerra o ensaio antes de foco/getValue; estado ready sem métodos válidos ou com nodeType também reprova. Diagnósticos agora persistem em falha. Caso DNS controlado comprovou fail-fast com relatório categórico; positivos HTTP/HTTPS usaram biblioteca real sem interceptação. Todos os diffs IN_PLAN; filtro adicional de caminhos do workflow é necessário para incluir o novo helper no mesmo gate. Orquestração informou validação local da base ae0624944 concluída com exit0; CSP hospedado continua reprovado, sem transferência de aprovação para o patch. Próximo passo: revisão independente, sem commit nesta etapa.

### 2026-11-04T18:34:46-03:00 — Revisão, evidência e autorização de commit

Orquestração recebeu revisão independente `PASS_WITH_WARNINGS` (revisor executou sete contratos Node; opt-in real skipped) e autorizou commit com governança. Positivos locais HTTP/HTTPS exit0, negativo completo DNS exit1 esperado, contratos+negativo Chromium oito PASS, lint exit0. Resumo sem URLs/hosts/segredos em `evidence/csp-local-summary.json`. A coleção cspViolations permanece completa e a asserção rejeita toda violação fora de inline/eval; apenas blockedURI é classificado como other para evitar exposição de URLs. Limite32 aplica exclusivamente ao diagnóstico. Removidos somente containers na0167-csp-http/https/ws, rede na0167-csp, certificado/chave descartáveis e wrapper Chromium negativo, preservando relatórios. Próximo passo: commit, governança no SHA e integração pela raiz. Nenhuma execução de pipeline neste implementador.
