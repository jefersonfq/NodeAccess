# PRD — Comparativo Termy e evolução operacional do NodeAccess

Data: 2026-10-29. Estado: roadmap proposto; primeira frente implementada e validada localmente na NA-0082, ainda sem publicação. Base analisada: `f4a44b4b7ae87a8f688b1246d9e52a31f9a104bc`.

## Objetivo e fontes

Orientar evolução por resultado operacional: acessar, colaborar e comprovar a auditoria. A comparação usa o [site público do Termy](https://www.termy.one/), consultado em 29/10/2026, e documentação/código do NodeAccess. As capacidades anunciadas pelo concorrente não foram testadas. Não inferir segurança, desempenho, conformidade ou superioridade a partir de marketing. Evidências locais não certificam a configuração de cada instalação.

## Comparativo

| Dimensão | Termy: anúncio público | NodeAccess: situação encontrada | Oportunidade |
|---|---|---|---|
| Acesso | SSH, Web, WinBox e RDP no navegador | SSH/Telnet, acesso web, RDP/VNC e SFTP; WinBox nativo não confirmado | Avaliar WinBox se a prioridade comercial for ISP/MikroTik |
| Auditoria | PTY, captura web e vídeo gráfico, replay e exportação | Auditoria SSH, replay e metadados; operação depende de flags, licença, política e storage | Tornar saúde e falhas explícitas; gravação gráfica exige projeto próprio |
| IA | Assistência contextual e análise pós-sessão | Integrações, assistente e resumo opcionais, dependentes de configuração e readiness | Completar a experiência de configuração até evidência de uso |
| Colaboração | Compartilhamento, transferência e passagem de plantão | Compartilhamento/controlador e supervisão; transferência formal e handover não confirmados | Acrescentar aceite, autoria e contexto de continuidade |
| Produtividade | Snippets, macros, execução em lote, split e broadcast | Snippets/macros e terminal dividido documentados | Validar jornadas reais antes de ampliar ferramentas |
| Governança | Permissões temporárias por tempo/execuções e administração assistida | Tenants, ACL, JIT e integrações corporativas | Concessões explícitas e revogáveis; IA propõe, administrador aprova |

Referências locais: `docs/PRD-lite.md`, `docs/PRD-multi-protocol-access-lite.md`, `docs/PRD-snippets-lite.md`, `apps/backend/src/modules/settings/settings.service.ts`, `apps/backend/src/modules/integrations/integration-readiness.ts`. Ausência de confirmação significa lacuna de evidência, não prova de inexistência.

## Plano por prioridade

| Ordem | Entrega | Resultado esperado | Critério para avançar |
|---|---|---|---|
| 1 — NA-0082 | Saúde dos recursos e proteção de deploy | Administrador distingue flag, configuração e evidência operacional | Estados/falhas/isolamento testados e homologação do painel |
| 2 — NA-0083 | [Jornada completa de IA](PRD-ai-journey-lite.md) | Provider/modelo/validação, assistente e resumo pós-sessão compreensíveis | Resumo vinculado à evidência, falhas visíveis; hipóteses separadas de fatos |
| 3 — corte 3A LOCAL_WIP NA-0084 | [Passagem de plantão](PRD-shift-handover-lite.md) | Notas vinculadas a host/sessão/auditoria, prioridade, responsável e próximo passo | Recebedor aceita; histórico e permissões preservados; integração Jira opcional |
| 4 | Transferência e concessões temporárias | Continuidade com aceite e revalidação de ACL, atribuição de ações | Revogação, expiração, concorrência e autoria verificadas |
| 5 | WinBox e gravação gráfica | Atender demanda comercial comprovada | Descoberta específica: runtime, isolamento, retenção, custo e segurança |

Cada etapa posterior exige seu próprio escopo e aprovação. Não há compromisso de prazo nem implantação automática do roadmap. Uma demonstração deve mostrar acesso → colaboração → auditoria → recuperação de falha.

## Saúde dos recursos — requisitos da primeira entrega

Público: administradores do tenant e da plataforma. O painel deve deixar claro que os dados de uso pertencem ao tenant atual; não é um inventário global de tenants.

Cobertura: auditoria SSH, resumo por IA, resumo automático, assistente local, SSH Gateway nativo e MCP. A habilitação efetiva considera flags e entitlements existentes; uma flag global não substitui política do tenant.

| Estado | Significado |
|---|---|
| Desabilitado | Flag, licença ou política impede uso; apresentar motivo específico |
| Não configurado | Habilitado, mas falta configuração obrigatória |
| Operacional | Evidência positiva válida para o caminho avaliado, com origem e horário |
| Degradado | Falha comprovada ou divergência API/gateway |
| Desconhecido | Evidência ausente, expirada ou impossível de consultar; nunca transformar isso em sucesso |

Mostrar motivo, próxima ação, horário da observação e último sucesso quando existente. Nunca usado não equivale a falha. Último uso MCP não comprova execução bem-sucedida de ferramenta; autenticação JWT não exige token MCP dedicado. Configuração de IA deve reutilizar a regra existente de readiness e expiração, sem consultar provedores ao abrir o painel.

Para auditoria, usar metadados persistidos com escopo de tenant, sem acessar comandos/conteúdo. Evidência histórica não garante disponibilidade atual. A proteção de storage e gateway deve explicitar validade/limitações; heartbeat não pode renovar artificialmente a idade de uma observação. Divergências entre API e gateway não devem ficar ocultas.

**Política confirmada pelo usuário:** auditoria indisponível gera alerta crítico e recomendação de correção, mantendo o acesso SSH e a política de admissão atuais. Não implementar fail-closed nesta frente.

## Interface e segurança

Componente próprio nas configurações, preservando detalhes de ambiente existentes. Carregamento, erro com retry, atualização manual, dados expirados e estados vazios devem ser explícitos. Textos e ícones complementam cores; foco visível e leitura em telas pequenas. Não alterar área útil do terminal.

Endpoint administrativo de leitura `GET /api/v1/settings/feature-health`, tenant obtido exclusivamente da identidade autenticada. Não expor credenciais, URLs privadas, paths, comandos, prompts ou erros brutos. Diagnóstico indisponível não deve reiniciar a aplicação nem interromper sessões. Sem sondagens ou latência adicional no transporte SSH.

## Proteção operacional

Update e rollback devem comparar o ambiente real dos containers com a configuração Compose candidata antes de pull, migrações ou recriação. Impedir regressão true → false das seis flags e exigir exceção explícita por nome quando a desativação for intencional. Erro de inspeção/configuração não é confirmação de segurança. Instalação sem containers existentes não tem estado anterior para comparar.

O guard usa Python 3 com biblioteca padrão para ler JSON com segurança; documentar o pré-requisito. Operação e exceções: [guia do guard](OPERATIONS-feature-health-guard.md). Logs devem conter somente nomes de recursos/serviços e mensagens controladas, sem imprimir o ambiente. Comandos Docker manuais ou automações externas que não chamam esses scripts não ficam protegidos automaticamente.

## Validação e limites

Testar estados, expiração, ausência de provider, drift, falhas e recuperação; autorização, isolamento entre tenants e ausência de segredos; respostas fora de ordem e mudança de tenant; layout desktop/mobile; regressão do deploy com mocks, incluindo exceções e erro de Docker. Executar typecheck, lint e build pertinentes e revisão independente.

Simulações locais não substituem homologação na VPS ou validação de providers reais. Sem deploy, publicação GitHub ou migração nesta frente. Evidências e limitações efetivas serão mantidas em [plano](changes/2026/10/NA-0082-resource-health/plan.md) e [registro](changes/2026/10/NA-0082-resource-health/implementation.md).

## Contrato operacional da NA-0082

A interface está em Configurações do tenant e da plataforma. Nos dois casos os eventos consultados pertencem ao tenant atual; o listener SSH nativo e as falhas de infraestrutura são sinais da instalação. A disponibilidade de hosts continua sujeita às ACLs existentes.

A consulta reaproveita o resultado do healthcheck de storage já existente e o heartbeat dos gateways observados; não inicia testes de provider nem grava arquivos. O snapshot visual expira em até 60 segundos, o heartbeat geral em 45 segundos e a observação de storage em 60 segundos. IA/MCP exigem operação recente (janela de cinco minutos); IA também exige readiness válido. Resumo automático exige job com origem automática. Uma fila vazia não prova falha: sem evidência de execução o estado permanece não confirmado.

Falhas de persistência capturadas no repository/publisher registram somente timestamp em memória, preservando retorno/rejeição e a política das sessões. Durante cinco minutos geram estado degradado; depois, sem uma gravação posterior, permanecem desconhecidas. A passagem do tempo ou um healthcheck de diretório positivo não basta para confirmar recuperação. O sinal é conservador para toda a instalação e não revela qual tenant teve erro.

Limitações explícitas: metadados e teste do diretório não certificam leitura/playback de cada arquivo; memória de falhas não é histórico durável; o registry não descobre gateways que nunca publicaram heartbeat. O heartbeat nativo legado não identifica múltiplas instâncias, portanto seu estado em HA permanece não confirmado. Configuração do listener pode sobrescrever a flag global; essa divergência aparece no diagnóstico, sem mudar sua semântica.

Homologação após uma publicação autorizada: abrir Configurações, atualizar o diagnóstico, conferir tenant e horário; usar uma sessão SSH elegível, encerrá-la e verificar sua auditoria; validar providers explicitamente nas integrações e conferir uma operação real de cada fluxo habilitado. Não usar somente flags ou capturas do painel como prova de gravação. Falhas simuladas de storage/Redis pertencem a ambientes descartáveis, não à VPS em uso.

Atualização de 30/10/2026: etapa2 implementada e validada localmente na NA-0083, com preparação assistida de Ollama e monitoramento pós-homologação opt-in. Sem instalação real; execução SSH automática permanece extensão planejada. Publicação/homologação das frentes seguem pendentes.

Atualização de30/10/2026: fase3 com corte 3A implementado e validado localmente na NA-0084: pendências com aceite e central de notificações; homologação humana/publicação pendentes. Cortes3B/3C continuam propostos. A NA-0083 posteriormente recebeu laboratórios reais no WSL (MySQL/Redis, API/browser e OllamaCPU descartável); continua sem implantação em servidor definitivo.

Evolução NA-0084: quadro consolidado tenant/grupo, concessões de leitura, relatório CSV, prazos e resumos em dashboards implementados e validados localmente. [Capturas e UX](changes/2026/10/NA-0084-shift-handover/evolution-ux.md); [evidências](changes/2026/10/NA-0084-shift-handover/evolution-test-results.md). Continua pendente homologação humana e publicação.
