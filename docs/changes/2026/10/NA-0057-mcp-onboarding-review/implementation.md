# NA-0057 — Registro da avaliação

## Pedido e objetivo
Reavaliar MCP e viabilidade de preparar configuração para o usuário copiar e colar
no agente. Priorizar compatibilidade real, UX e proteção das credenciais.

## Implementação
Base: 1755022aa2e8d884ddf295e3e2470acfdcb5ad24. Branch:
`docs/NA-0057-20261013-mcp-onboarding-review`, estado LOCAL_WIP.
Assistente extraído em McpAgentSetup.vue; gerador mcp-agent-setup.ts e probe
mcp.service.ts com proteção de segredo e estados de erro. View descarta respostas
assíncronas de tenant/modal anteriores. Backend mcp-http.ts/routes/controller/service
implementa contrato stateless, normalização antes da autorização e filtro de hosts.
Testes unitários/HTTP/navegador e OPERATIONS-mcp-lite.md atualizados. Sem dependência
nova no produto; SDK e runtime de validação foram preparados somente em /tmp.

## Validação
Ran: 76 testes MCP, HTTP loopback, SDK e smoke CLI, navegador desktop/mobile,
typecheck e build. Evidências e limitações precisas em test-results.md.
Ran: lint novo/probe aprovado; lint amplo falha por dívida preexistente comprovada
na base. Skipped: sessão interativa com inferência Codex/Gemini, produção/SSH/banco real.
Gemini CLI real conectou no smoke test com configurações descartáveis.
Revisão independente: PASS_WITH_WARNINGS. Homologação humana não realizada.

## Recuperação
Código local preservado na branch; sem commit, push, PR ou deploy. Nenhuma migration
ou configuração real de agente alterada. Base/checkpoint NA-0056 preservados;
recuperar em checkout separado e, após eventual merge, reverter por PR.

## Pendências
Homologação humana, uso interativo Codex e checks no futuro SHA
antes de publicar. Lint legado amplo registrado, sem expansão da frente para
refatorar módulos inteiros. OAuth/SSE persistente e outros clientes fora do escopo.

## Diário de interações
### 2026-10-13T16:03:32-03:00 — Reavaliação e configuração pronta
Usuário pediu avaliação de melhorias MCP e onboarding por copiar/colar. Identificado
guia existente com JSON genérico usado para Claude/Gemini e lacuna de initialized
no servidor/probe. Executadas 5 suítes/32 testes com sucesso. Registrada proposta
de assistente por agente/shell, validação somente leitura e limites de segurança.
Próximo passo: implementação funcional da proposta em frente controlada quando
solicitada; revisão não foi apresentada como correção já implementada.

### 2026-10-14T09:42:59-03:00 — Recuperação após queda da sessão
Usuário solicitou identificar onde o trabalho parou. Conferidos status, histórico
local, diff e arquivos novos da NA-0057; HEAD permanece na base 1755022.
O plano registra aprovação anterior para implementar e testar. Preservadas as
alterações locais do assistente por agente/shell e do probe; nenhum código de
produto alterado nesta interação. Backend HTTP ainda sem alterações locais.
Ran: inspeção Git e documental. Skipped: testes, build, navegador e clientes reais
nesta recuperação; os 32 testes acima pertencem à avaliação inicial e não validam
o código parcial atual. Não consultado estado remoto nesta interação.
Limitação: diário anterior não registrava a implementação já iniciada; o ponto
exato da interrupção não pode ser comprovado. Próximo passo: validar o frontend
parcial, completar contratos HTTP backend e executar as validações previstas
antes da revisão independente. Sem commit, push, PR ou deploy nesta interação.

### 2026-10-14T11:37:42-03:00 — Retomada autorizada e implementação
Usuário autorizou implementação fim a fim com testes e simulações. Completados
transporte HTTP stateless, ping/initialized, headers/origens/versões, preservação de
ID e presets por agente; corrigidos labels do assistente após teste navegador.
Revisão independente encontrou bypass por espaços entre guard e dispatch; aplicado
trim consistente e regressões. Consulta do onboarding agora cruza allowedHostIds.
Protegidos carregamentos e criação contra respostas de contexto/modal anterior.
Ran até este checkpoint: 75 testes MCP (7 suítes) incluindo SDK 1.27.1 por HTTP real,
Claude Code 2.1.296 Connected com configuração temporária e leitura de preset Codex
0.162.0; typecheck e build frontend aprovados antes do último ajuste de concorrência.
Navegador desktop/mobile aprovado antes desse último ajuste; revalidação em curso.
Skipped: Gemini CLI real (ausente), sessão interativa Codex, produção/SSH/migrations.
Ambiente padrão Node 20.20.2, abaixo de engines do projeto: resultado local não
substitui CI no runtime suportado. Nenhum segredo/configuração real foi gravado.
Próximo passo: concluir regressões de concorrência, revisão independente e registro
final das evidências. Sem commit, push, PR ou deploy.

### 2026-10-14T11:51:52-03:00 — Evidência consolidada
Implementação e testes locais concluídos; detalhes em test-results.md.
Node 24.21.0 preparado isoladamente para eliminar a limitação do runtime inicial.
Revisão independente sem bloqueadores nos novos fluxos. Simulações de criação
atrasada e troca de tenant aprovadas em desktop/mobile. Lint amplo investigado
contra base, mantendo dívida anterior explícita; novos arquivos e probe sem erros.
Estado LOCAL_WIP, visível no workspace atual. COMMITTED/PUSHED/PR_OPEN/MERGED/
MASTER_SYNCED não executados nesta frente; remoto não consultado nesta retomada.
Próximo passo: homologação da experiência e autorização de commit/publicação,
caso desejada, com checks repetidos no SHA candidato.

### 2026-10-14T11:59:42-03:00 — Revisão adicional de UX e configuração
Usuário pediu avaliação de melhorias MCP, poluição visual e assertividade das
instruções. Aplicada skill frontend em modo review-only; sem edição de produto.
Ran: inspeção de código e navegador Chromium com fixtures do harness, viewport
1440x900 e 390x900. Reprodução confirmada: editar endpoint, abrir criação de token
e cancelar faz o guia retornar ao endpoint padrão, perdendo a configuração.
No preset Codex/Bash local, guia expõe três blocos de código e seis botões; conteúdo
medido após animação tem cerca de 1423px desktop e 2048px mobile. Capturas apenas
em /tmp/na0057-mcp-*.png, com dados simulados. Não são métricas de produção.
Achados: cadastro Codex duplicado (TOML/comando), CTA de conexão com menor destaque
que criação isolada, muitas ações de logs e cards introdutórios antes da tabela,
três alerts no ambiente local e resultado de probe sem síntese que diferencie
servidor testado de conexão real do agente. Campo editado não corresponde ao
destino do probe por proteção de credenciais; tornar os dois destinos explícitos.
Proposta priorizada: preservar endpoint no retorno da criação; apresentar um método
de cadastro recomendado por agente com alternativa secundária; resumir estado
MCP e agrupar logs; dar resultado global do teste com próximo passo e detalhes.
Homologação Gemini real/Codex interativo permanece pendente. Skipped: novas suítes
unitárias/build (revisão sem mudança funcional). Próximo passo: implementar as
correções localizadas e atualizar harness para preservação do endereço e feedback.

### 2026-10-14T12:45:02-03:00 — Refinamento UX implementado
Usuário aprovou implementar os cinco ajustes revisados com testes/simulações.
Guia reorganizado em cadastrar/iniciar/confirmar; Codex usa cadastro por comando
com arquivo como alternativa, avisos locais consolidados, teste opcional com
destino explícito, resumo conclusivo sem afirmar conexão do agente e detalhes
expansíveis. Endpoint preservado no retorno de criação/cancelamento e reabertura,
reiniciado ao trocar tenant/baseURL; segredo continua descartável. Tela principal
com CTA Conectar agente, auditoria agrupada e resumo compacto; perfis permanecem
na criação. Correção necessária de UX: removido empty state duplicado e distinguido
filtro vazio de ausência de tokens. Texto local esclarece que localhost refere-se
à máquina do agente.
Ran: baseline 36 testes; revisão independente PASS; simulações em desktop/tablet/
mobile incluindo cancelamento/sucesso, respostas atrasadas, isolamento, teclado,
clipboard, resumo success/skipped/error e rejeição de chamadas ao endpoint externo.
Gemini CLI 0.64.0 instalado apenas em /tmp; teste real de handshake Connected com
preset gerado passou após confiar exclusivamente no diretório descartável. Falhas
iniciais eram no harness (saída stderr e pasta não confiável), não foram ocultadas.
Orientação de confiança Gemini incluída no guia. Nenhuma configuração real de
agente alterada, nenhum pedido de inferência/SSH ou dependência nova do produto.
Typecheck e build aprovados; rodada final após ajustes em curso, consolidar em
test-results.md. Persistem dívida de lint legado e homologação humana/Codex
interativo. Estado LOCAL_WIP; sem commit/push/PR/merge/deploy.

### 2026-10-14T12:50:19-03:00 — Validação final concluída
Concluída a rodada final do refinamento autorizado, sobre o mesmo SHA base
1755022aa2e8d884ddf295e3e2470acfdcb5ad24. Fluxos afetados: guia de conexão,
configuração de agentes, testes do servidor e gestão/auditoria de tokens MCP.
Ran: 76 testes em 7 suítes, incluindo SDK/Claude/Gemini com servidor de teste;
simulações Playwright desktop/tablet/mobile; typecheck completo; lint dos arquivos
novos/componentes e serviços cobertos; revisão independente final PASS. Build
frontend final aprovado em 28,73s, com aviso conhecido de chunk vendor-ui acima
 de 950 kB. git diff --check aprovado. Evidências em test-results.md.
Limitações: dívida de lint legado, homologação humana e sessão interativa Codex
com inferência permanecem fora da validação concluída. Próximo passo: revisão do
WIP pelo mantenedor. Estado LOCAL_WIP; nenhum commit, publicação ou deploy.

### 2026-10-14T13:16:13-03:00 — Revisão de densidade de capabilities
Pedido: avaliar cobertura e sugerir redução de espaço em /mcp-tokens.
Revisão de UX sobre SHA base 1755022aa2e8d884ddf295e3e2470acfdcb5ad24 + WIP:
coluna renderiza todas as capabilities como tags com wrap; formulário também
repete descrição no corpo e tooltip. Sugestão: coluna Permissões com contagem,
sinalização visível de acesso sensível e botão acessível para lista completa;
herança do ambiente deve permanecer explícita, sem sugerir ausência de acesso.
No formulário, agrupar por módulo, permitir busca e manter seleção/risco claros.
Arquivos revisados: McpTokensView.vue e test-results.md. Sem alteração funcional.
Validação: inspeção de código e evidências anteriores; nenhuma nova execução de
testes/build nesta revisão. Cobertura existente é de integração com infraestrutura
simulada e navegador com APIs simuladas, não homologação de produção/persistência.
Próximo passo sugerido: ajuste localizado da coluna, com simulação de muitas
permissões, herança, teclado e mobile. Sem commit/publicação.

### 2026-10-14T15:28:13-03:00 — Permissões compactas implementadas
Pedido: implementar fim a fim a revisão de densidade em /mcp-tokens. Mesmo SHA
base 1755022aa2e8d884ddf295e3e2470acfdcb5ad24 + WIP na frente NA-0057.
IN_PLAN: nova coluna Permissões com contagem, modal de detalhes, shell/alto risco
visíveis e herança explícita; componente McpPermissionSummary.vue integrado na view.
Criação/edição compartilham McpCapabilitySelector.vue com busca, módulos recolhíveis,
contagem global, riscos e descrições acessíveis por teclado. Removidos helpers e
estilos exclusivos do seletor anterior. Documentação OPERATIONS-mcp-lite atualizada.
NECESSARY_CORRECTION identificada na revisão independente: permissões selecionadas
sem metadados precisam ser inspecionáveis/removíveis; grupo próprio e risco não
informado adicionados sem remover seleção automaticamente. Prompts já selecionados
preservam metadados; busca não altera payload. Nenhuma mudança de backend ou acesso.
Ran: 36 testes de serviços frontend, lint estrito dos dois componentes, diff-check
aprovados; typecheck completo aprovado e build em execução. Browser/revisão final
em curso, registrar resultado ao concluir. Estado LOCAL_WIP, sem commit/deploy.

### 2026-10-14T15:42:17-03:00 — Permissões compactas: validação concluída

Ran: matriz final Playwright PASS em 1440x1000, 768x1024 e 390x844, incluindo
guia anterior. Resumo com 22 permissões medido em 89,58px nas fixtures; shell,
alto risco, risco desconhecido e herança explícitos. Modal Enter/Escape, foco
restaurado, scroll contido, grupos por teclado, busca preservando seleção e
payloads POST/PATCH, remoção de permissões desconhecidas validados. Zero pageerror
ou overflow do documento; tabela mantém scroll horizontal próprio.
Falha inicial do harness no uncheck de item removido corrigida para clique e
asserção de ausência; nenhum teste suprimido. APIs simuladas.
Ran: 36 testes frontend, typecheck completo, lint dos dois componentes, build final
29,09s, node --check do harness e diff-check aprovados. Revisão independente PASS.
Log /tmp/na0057-permissions-browser.log; capturas
/tmp/na0057-permissions-{table,details,create}-{1440,768,390}.png.
Executor inspecionou visualmente tabela desktop e formulário mobile. Vite isolado
encerrado. Manual: homologação humana. Skipped: nova rodada CLI/banco/SSH/terminal,
sem mudanças nesses fluxos. Preservar chave desconhecida na UI não garante aceitação
no backend; validação de catálogo existente permanece.

Estado LOCAL_WIP na mesma branch e base 1755022aa2e8d884ddf295e3e2470acfdcb5ad24.
Sem commit/push/merge/deploy. Próximo passo: revisão do WIP pelo mantenedor.

### 2026-10-22T09:05:00-03:00 — Diagnóstico adicional do MSI e SmartScreen

Pedido: analisar captura do formulário SmartScreen e gerar/validar MSI deste checkout. Registro adicional, sem alteração do escopo funcional MCP. Base SHA: 1755022aa2e8d884ddf295e3e2470acfdcb5ad24.

Ran: inspeção da captura e documentação oficial Microsoft; leitura dos scripts de build/assinatura e operação Windows; consulta via PowerShell da presença das configurações (sem imprimir valores). Windows acessível, Node/npm/.NET encontrados; WiX e signtool não encontrados no PATH, ferramentas isoladas ausentes. Nenhum MSI existente em apps/agent/dist. Certificado, thumbprint e chaves de release não configurados no processo Windows consultado.

Ran: execução de build-msi.ps1 deste checkout pelo PowerShell Windows, saída 1 no guard de assinatura obrigatória, antes da compilação. Não foi gerado MSI nem ativado modo unsigned. O script prepare-agents.mjs exige checkout nativo Windows e importação para Linux/WSL; documentação de operação contém orientação antiga sobre geração direta via WSL e assinatura opcional.

Limitações: captura mostra formulário, sem alerta original; assinatura do arquivo publicado e reputação não verificadas. Sem instalação, publicação, mudanças de código ou testes de runtime. Próximo passo: disponibilizar configuração segura de assinatura e ferramentas em checkout Windows correspondente, gerar/importar e verificar Authenticode/hash. Segredos não devem ser enviados na conversa. Recuperação: somente esta entrada documental foi acrescentada; WIP existente preservado.

### 2026-10-22T09:35:20-03:00 — Nova captura: reputação de download no Edge

Inspeção visual da nova captura confirmou aviso de arquivo normalmente não baixado no painel Downloads do Edge, com opções Manter e Relatar este arquivo como seguro. Evidência de reputação insuficiente, não de detecção explícita de malware; assinatura e integridade do MSI continuam não verificadas. Orientação: validar origem/hash e assinatura antes de manter/instalar; compra de certificado não é pré-requisito para diagnosticar este aviso. Captura contém credencial de registro: recomendar revogação/substituição se ativa, sem transcrever seu valor. Nenhum build, instalação, envio à Microsoft ou mudança de código nesta interação. Base permanece 1755022aa2e8d884ddf295e3e2470acfdcb5ad24. Próximo passo: validar o artefato efetivamente baixado.

### 2026-10-22T09:46:00-03:00 — Build isolado e revisão estrutural do MSI

Pedido: gerar pacote, analisar estrutura/dependências e melhorar a distribuição sem regressões. Base SHA: 1755022aa2e8d884ddf295e3e2470acfdcb5ad24. WIP MCP preservado; sem commit/publicação.

Implementação: corrigido sourceDigest em apps/agent/installer/windows/artifacts.mjs para incluir packages/shared/src/data/agent-diagnostics.json, dependência real de connection-health.js. Antes, alterações nesse catálogo não invalidavam um pacote antigo. Acrescentado teste de regressão e atualizados fixtures Windows, Unix e release. Adicionado tools/agent/review-windows-package.ps1: inspeção somente leitura de inventário, versão, hashes, Authenticode e custom actions; opção RequireSigned. Corrigida documentação OPERATIONS-agent-windows-installer.md sobre versões das ferramentas, assinatura obrigatória e build Windows/WSL. Sem alteração de runtime, UI, autenticação ou transporte.

Ran: novo teste falhou antes da correção (16/17) e passou depois. Suite final de contrato, artefatos, assinatura, plataformas e release: 24/24. npm audit --workspace apps/agent --omit=dev: zero vulnerabilidades reportadas; npm ci isolado com lockfile, incluindo ferramentas do agente: zero vulnerabilidades reportadas. Dependência direta runtime ws 8.22.0; empacotador @yao-pkg/pkg 6.23.0; aviso de depreciação prebuild-install transitivo da ferramenta, sem atualização forçada.

Ran: build Windows isolado usando Node 24.21.0 oficial com SHA-256 conferido, npm 11.19.0 e WiX 4.0.6. Node 20/npm 9 preexistentes causaram falha inicial; não foram alterados globalmente. A primeira cópia isolada omitiu o catálogo compartilhado e falhou no smoke do EXE; cópia corrigida antes da geração final. Modo unsigned restrito ao processo de laboratório. MSI 2.0.0 gerado (29.577.216 bytes), sete arquivos esperados, EXE e MSI NotSigned. Relatório e pacote em imgs_debug/msi-review-2.0.0, fora de apps/agent/dist e do Git.

Ran: MSI upgrade read-only PASS; desktop identity/lifecycle PASS; 11/11 testes nativos com executável empacotado (configuração, falhas e diagnóstico). Inspeção rejeitou assinatura ausente quando obrigatória e versão esperada incorreta. Validação cruzada Windows/Linux do pacote copiado contra fontes atuais PASS; git diff --check PASS. Relatório package-review.json contém hashes e inventário. MSI SHA-256: dbbb2a5de900a7cfe0ca2e43caa080d33cd8e66eaea8bbc98e04403bd6b5490e.

Limitações: sem instalação/upgrade real em máquina descartável, varredura antivírus ou teste de reputação online; não houve envio à Microsoft. Testes não provam ausência de toda regressão. O pacote de laboratório tem confiança de atualização vazia e não serve como release assinada. A mudança de sourceDigest invalida manifestos anteriores para o checkout novo nas três plataformas; regenerar os artefatos ao preparar release, sem editar manifestos manualmente. Nenhuma dependência foi atualizada e nenhum lockfile foi alterado.

Recuperação: reverter apenas os arquivos desta revisão, preservando WIP anterior. Artefatos são isolados e não foram instalados nem publicados. Próximo passo: validar ciclo de instalação/upgrade em Windows descartável antes de qualquer distribuição e preparar assinatura de produção quando disponível. O aviso de baixa reputação do Edge pode continuar; não é corrigido pelo checksum ou por esta mudança de proveniência.


### 2026-10-22T10:09:47-03:00 — Revisão de cadastro e edição de hosts

## Revisão de UX do formulário de hosts

Pedido: avaliar cadastro/edição, capturar telas, simular configuração com seções recolhidas e comparar com abas. Aplicada skill frontend-full-cycle-agent em modo UX Designer/review-only. Sem alteração de código de interface; revisão solicitada, não implementação.

Base SHA: 1755022aa2e8d884ddf295e3e2470acfdcb5ad24. Inspeção localizada em HostsView.vue (modal a partir de 7136, expansão/scroll a partir de 3010). WIP anterior preservado.

Ran: Playwright/Chromium existente contra frontend local; contexto isolado, APIs simuladas e WebSocket bloqueado. Cenários: edição e PATCH, criação e POST, preenchimento com senha fictícia não registrada em payloads de evidência, organização/descrição, abertura do seletor de rota, seções recolhíveis, tentativa de formulário vazio, teste de conexão com sucesso e falha, salvamento. Nenhum host ou serviço real foi alterado/conectado. Viewports 1440x1000, 768x1024 e 390x844. Zero pageerrors; modal fechado após salvar. Capturas e medidas em imgs_debug/hosts-ux-review; simulation.json com payloads sanitizados; keyboard.json com evidência de foco/DOM. Harness temporário /tmp/nodeaccess-hosts-ux-review.cjs e /tmp/nodeaccess-hosts-keyboard.cjs.

Achados: desktop com 700px de área útil tem 957px de conteúdo inicial na edição e 3043px com seis seções abertas; mobile chega a 3955px para 567px úteis no cenário expandido. Acesso e organização mistura perfil/SO, ACL, pastas pessoais, descrição, tags e macro. Expansão usa scroll programático, chegando a ocultar o cabeçalho da seção. Roteamento fica separado do teste de conexão. Explicações de ACL/organização repetidas; ação desabilitada de habilitar bastion no cadastro; ID técnico ocupa faixa inteira. Tab percorreu dois ciclos sem alcançar cabeçalhos: DOM dos cabeçalhos sem controle focável/role/aria-expanded. Inputs principais sem label associado ou aria-label/labelledby na inspeção. Não foi executado leitor de tela nem auditoria automatizada de contraste.

Recomendação: quatro abas fixas (Conexão, Acesso, Organização, Recursos), com ações fixas, estado preservado, erros levando à aba/campo e resumo da pasta/ACL. Separar ACL de organização pessoal, macros de organização, reunir rota e conexão; reduzir texto redundante sem ocultar regras de acesso. Priorizar teclado e labels. Abas reduzem busca e rolagem; não prometer redução universal de cliques. Não aplicado redesign nesta interação.

Limitações: validação frontend com fixtures, sem backend/SSH real; integração 1Password desativada e admin simulado, não matriz completa de protocolos/permissões. Sem testes de regressão/build por não haver mudanças funcionais. Manual integrado não foi alterado, pois nenhum fluxo do produto mudou. Próximo passo: implementação localizada, se solicitada, com testes de preservação de dados/validação/teclado e atualização do manual. Recuperação: apenas esta entrada documental e evidências locais foram acrescentadas.


### 2026-10-22T10:17:19-03:00 — Referências de mercado e proposta de navegação por abas

Pedido/decisão: usuário concordou com conexão como apresentação padrão e pediu nova avaliação de formato/estilo com referências de mercado. Mantido modo review-only da skill frontend-full-cycle-agent; não solicitado redesign implementado.

Ran: consulta às fontes oficiais MobaXterm (https://mobaxterm.mobatek.net/documentation.html), Devolutions RDP entry (https://docs.devolutions.net/rdm/knowledge-base/how-to-articles/rdp-session-entry), Microsoft RDCMan (https://learn.microsoft.com/en-gb/sysinternals/downloads/rdcman) e NN/g Tabs, Used Right (https://www.nngroup.com/articles/tabs-used-right/). Conferidas capabilities locais em packages/shared/src/protocols/access-protocol.capabilities.ts e condicionais de HostsView.vue. Sem nova execução de navegador nesta interação; evidências anteriores continuam em imgs_debug/hosts-ux-review.

Recomendação refinada: Conexão como primeira aba selecionada ao abrir cadastro/edição normal; cabeçalho compacto preserva contexto do host nas demais abas. Quatro abas em ordem estável: Conexão, Acesso, Organização, Recursos. Conexão reúne destino, autenticação e rota; Acesso reúne ACL e host key SSH; Organização contém perfil/SO e organização visual; Recursos reúne macros, túneis e links aplicáveis. Campos condicionais por protocolo e capacidades reais; RDP/VNC oferecem teste TCP, não sessão gráfica web; Telnet sem campos PEM/bastion SSH e aviso de ausência de criptografia. Credenciais/porta não podem ser silenciosamente perdidas ao trocar protocolo; não introduzir campos backend inexistentes.

Estilo proposto: navegação superior de uma linha, indicador ativo por peso e sublinhado, contraste legível em abas inativas, controles existentes e cor primária atual; modal confortável no desktop, tela cheia no mobile com abas acessíveis sem quebra em duas linhas. Rodapé de ações estável, validação levando à aba/campo, resumo de ACL para evitar erro de escopo oculto. Formulário simples pode salvar sem visitar abas opcionais. Referências demonstram padrões familiares, não comprovam ganho de adoção do NodeAccess.

Limitações: avaliação documental/heurística, sem teste com usuários e sem protótipo novo. Próximo passo: validar proposta com tarefas de cadastro SSH, alteração de rota, ACL e troca de protocolo, medindo conclusão, tempo, erros e navegação; só então afirmar benefício observado. Sem alterações no frontend/manual/build. Base SHA permanece 1755022aa2e8d884ddf295e3e2470acfdcb5ad24; recuperação restrita a esta entrada documental.
