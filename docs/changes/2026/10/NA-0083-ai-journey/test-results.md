# NA-0083 — Evidências de validação local

Resultado ampliado: **PASS_WITH_WARNINGS**, em 2026-10-30T10:30:02-03:00. Validação local; homologação operacional continua pendente.
Branch: `feature/NA-0083-20261030-ai-journey`.
Base e HEAD: `f4a44b4b7ae87a8f688b1246d9e52a31f9a104bc`.
Código testado: working tree `/tmp/nodeaccess-NA-0083`, ainda sem novo commit.
Documentação canônica: `/home/jeferson/projects/NodeAccess-current/docs/`.

Fingerprint histórico anterior à ampliação (44 arquivos, superado pelo candidato abaixo):
`7e3030642e64280f03f918c3ac61ddc0d7e4a6258c6c3252dd5edc589457e697`.
Cálculo: caminhos ordenados de git diff + untracked, concatenando caminho UTF-8,
byte nulo, conteúdo e byte nulo. Identifica o candidato local, não substitui
validação de um futuro commit/CI. Novas alterações invalidam a evidência correspondente.

## Matriz anterior — 2026-10-30T09:53:17-03:00

| Estado | Check | Resultado / alcance |
|---|---|---|
| Ran | Baselines anteriores às edições | Planejamento 16 testes; backend 13; frontend 24; instalador 10, todos aprovados. Há sobreposição entre suites, não somar como testes únicos |
| Ran | `npm run test:ai-journey:core` | **122/122**, 11 arquivos: jornada, auth/tenant, CAS, monitor, cotas, instalador assistido, payload/hash, readiness, resposta atrasada e isolamento |
| Ran | Regressão integrations/providers/usage/router/worker drain | **61/61**, 14 arquivos; inclui testes que também pertencem à suite principal |
| Ran | Instalador assistido, revisão independente | **40/40**, 2 arquivos; Bash/Python executados com Docker/HTTP/capacidade simulados, sem download/instalação real |
| Ran | Backend, revisão independente | **50/50**, 8 arquivos direcionados; CAS, lease, opt-in, orçamento, limite solicitado ao provider e defaults preservados |
| Ran | Frontend direcionado | **58/58**, 4 arquivos; incluídos na suite principal e validações do wrapper final |
| Ran | `npm run test:ai-journey:web` | Browser desktop/mobile, temas claro/escuro; fluxo configuração→salvar→testar revisão→assistente→resumo→homologar→monitor, pacote apenas baixado; HTTP503 e200 malformado, edição durante teste, expiração, sem reload |
| Ran | `LINT_INCLUDE_WORKTREE=true npm run lint:changed` | **38 arquivos**, zero erros/avisos, exit0 |
| Ran | Builds shared/backend/frontend | Aprovados; tsc/vue-tsc incluídos. Vite mantém avisos de chunk acima de950kB e anotação Rollup em dependência; não houve alteração de bundling |
| Ran | `git diff --check` | Aprovado |
| Ran | Revisões independentes | Backend e instalador PASS_WITH_WARNINGS; frontend revisado pelo root com execução independente do browser e inspeção de captura mobile |
| Skipped | SQL/CAS MySQL e lease Redis reais | Doubles/mocks; não alegar certificação em múltiplas réplicas ou banco real |
| Skipped | Provider, GPU e instalação reais | Decisão explícita do usuário: máquina ainda não definida, preparar fluxo/plano sem instalação real |
| Skipped | Terminal PTY/área útil | Sem alteração de transporte, resize ou área do terminal; resumo e configuração administrativos |
| Manual | Homologação operacional, publicação GitHub/CI e VPS | Pendentes. Nenhum commit, push, PR, merge ou deploy |

## Achados corrigidos durante revisão

- Teste de rascunho/configuração incorreta: frontend separa salvo/rascunho; revisão é verificada antes do teste, e CAS descarta resposta concorrente sem sobrescrever configuração nova.
- Digest Ollama: fixture inicial exigia prefixo sha256, diferente do exemplo oficial de tags. Corrigido para aceitar digest hexadecimal válido e testar o formato real documentado.
- Consumo automático: limite de saída solicitado ao provider de rede e reserva da cota mensal antes do I/O; orçamento esgotado/indisponível não consulta provider.
- Payload inválido: frontend rejeita resposta malformada e verifica SHA-256 do script antes do download, com erro/retry locais.
- Reindentação excessiva removida. Wrapper de teste movido para serviço novo para não modificar o serviço legado nem contornar warnings. Avisos finais de formatação corrigidos pontualmente; regras de lint preservadas.

## Evidências reproduzíveis

Ambiente: Linux, Node24.21.0, npm11.12.1, Python3 disponível. Dependências via npm ci;
Prisma generate e build shared executados no checkout isolado. Browser headless
existente selecionado explicitamente; APIs e identidades são fixtures sintéticas.

Logs: `/tmp/na0083-core-tests.log`, `/tmp/na0083-regression-tests.log`,
`/tmp/na0083-final-lint.log`, `/tmp/na0083-backend-build.log`,
`/tmp/na0083-frontend-build.log`, `/tmp/na0083-independent-browser.log`,
`/tmp/na0083-independent-browser-light.log`, `/tmp/na0083-installer-independent.log`.
Capturas: `/tmp/na0083-independent-browser/` e `/tmp/na0083-independent-browser-light/`.

Browser: iniciar Vite e informar FRONTEND_BASE; execução usou
`http://127.0.0.1:5183` e `PLAYWRIGHT_EXECUTABLE_PATH=/root/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell`.
Servidor Vite temporário encerrado após validação. Artefatos temporários não são CI publicado.

## Limites e recuperação

Instalação assistida não copia/executa automaticamente em outro host. Não recebe
credenciais nem instala Docker/drivers. RAM/VRAM mínimas não garantem memória livre,
capacidade real do modelo ou desempenho. API Ollama fica em loopback; acesso remoto
precisa de rota protegida separada. Cancelamento do pacote não promete rollback de
operações já aceitas pelo Docker; recursos existentes não são removidos.

Monitoramento é opt-in pós-homologação da revisão, somente observação. Agendamento
é best-effort com timeout/backoff e páginas de até10 tenants por ciclo, sem SLA de
cadência. Consome a cota mensal configurada; sem cota definida, o limite é frequência/
timeout/saída solicitada. Testes sintéticos não são conversas do assistente nem
certificação do fluxo de resumo. Opt-out descarta resultado pendente e impede novas
verificações; não desfaz uma chamada já iniciada. Logs administrativos seguem o
padrão best-effort existente; aprovação também fica persistida na configuração.

Sem migração nova. Para recuperação, desativar o monitoramento e reverter a frente;
metadados journey ficam no JSON da integração. Não remover recursos de IA remotos
por rollback do NodeAccess. NA-0081/NA-0082 foram preservadas.

## Ampliação WSL — 2026-10-30T10:30:02-03:00

Pedido autorizado: testes e simulações mais profundos, incluindo containers locais descartáveis. Base/HEAD permanecem os mesmos; nenhuma publicação. Fingerprint atual de **51 arquivos** alterados/novos fora de docs e README, pelo método descrito acima:
`c6e86d546878581d3c85767c9c4faa3b8f434b304fa468afc9d8f41f0078aa04`.

| Estado | Check | Resultado e evidência |
|---|---|---|
| Ran | Baseline e core após correção do instalador | **122/122**,11arquivos; `/tmp/na0083-expanded-baseline.log`, `/tmp/na0083-expanded-core.log` |
| Ran | MySQL/Redis reais, repetição independente | **15 cenários**, incluindo5rodadas de20reservas concorrentes com limite5, CAS16escritores, tenant/mês, opt-in, opt-out durante chamada, lease/token e Redis indisponível. `/tmp/na0083-data-plane-independent.log` |
| Ran | HTTP + browser com backend/SQL reais | **15 cenários**,12chamadas reais da UI; JWT/guards, save/test,409concorrente,503/recuperação, JSON/modelo/output inválidos, homologação simulada, monitor on/off, download. `/tmp/na0083-http-journey-real.log` |
| Ran | Instalador real Linux/Docker/Ollama/CPU | **10 cenários**, download frio, digest, geração, idempotência, retomada, porta estrangeira, volume alheio, alteração de plano, flock. `/tmp/na0083-installation-real-fixed/report.json`; script SHA `f588e967547f590ec73ee43cf9be74b32b0bb2f18f7521a2eeed132b0447b0a1` |
| Ran | Correções cota/jornada/worker | **21/21**,3arquivos, repetidos independentemente; `/tmp/na0083-expanded-corrections-final.log`, `/tmp/na0083-independent-corrections.log`. Há sobreposição com core; não somar como testes únicos |
| Ran | Lint final |40arquivos de aplicação/testes, zero erros/avisos; `/tmp/na0083-expanded-lint-final.log`. Harnesses tools/*.mts não abrangidos pelo ESLint atual; validados pela execução |
| Ran | Build backend final | tsc aprovado; `/tmp/na0083-expanded-build-final.log` |
| Ran | Revisão independente | PASS_WITH_WARNINGS; revisão de diffs/logs HTTP/instalador, reexecução data-plane e unitários; bloqueantes resolvidos |
| Ran | Limpeza | Relatórios emitidos após teardown; containers/volumes descartáveis removidos. `docker ps -a --filter name=na0083-` vazio. Imagem DinD externa permanece em cache |
| Ran | `git diff --check` | Aprovado |
| Skipped | GPU, servidor dedicado, rede remota e soak prolongado | Não necessários para laboratório autorizado; nenhuma VPS acessada |
| Skipped | Bootstrap integral, login/MFA e filas completas de assistente/auditoria | Fluxo administrativo real; adapters chat/resumo com HTTP sintético, sem certificação da fila completa |
| Manual | Homologação humana do ambiente final | A aprovação clicada pelo browser é uma simulação, não aceite humano ou autorização de produção |

O HTTP usa provider/relógio controlados; no browser, endpoints externos à jornada são fixtures. O data-plane usa resposta do provider/elegibilidade simuladas. Já o instalador usou **Ollama0.11.4 + smollm2:135m reais em CPU**, em DinD privilegiado sem mount/socket do host nem portas publicadas. Compartilha kernel WSL; não é máquina virtual. Modelo/versão são fixtures, não recomendações de produção. Schema MySQL criado via Prisma db push, não ensaio de migração histórica.

Capturas: `/tmp/na0083-http-browser/desktop.png` e `mobile.png`; inspeção mobile legível. Procedimento reproduzível, isolamento e limites no [guia do laboratório](../../../../OPERATIONS-ai-journey-lab.md).

### Falhas descobertas e corrigidas

1. **MySQL1213 real:** INSERT IGNORE seguido de SELECT FOR UPDATE exigia promoção de locks compartilhados concorrentes. Upsert sem incremento adquire lock exclusivo desde o início; preserva transação e limite. A mesma carga passou após correção, incluindo100reservas em5rodadas.
2. **Retomada bloqueada pela porta:** após stop, TCP TIME_WAIT disparava PORT_11434_IN_USE. Sondagem com SO_REUSEADDR admite retomada sem permitir listener ativo; ambos os casos foram executados com sockets reais.
3. **Harnesses:** corrigidas expectativa da rede default/bridge, fixture de rollover que não usava tenant esgotado, teardown em falhas de import/fechamento e reporte de limpeza antecipado. Erros de processos não expõem credenciais descartáveis.

Falhas iniciais preservadas em `/tmp/na0083-data-plane-real.log` (a execução posterior pode substituir o log de trabalho) e `/tmp/na0083-installation-real/report.json` (falha real de retomada). O registro durável da reprodução e correção é este documento; não alegar que todo log de tentativa foi retido.

Status: LOCAL_WIP. COMMITTED/PUSHED/PR_OPEN/MERGED/MASTER_SYNCED pendentes; sem commit, PR ou deploy nesta interação.
