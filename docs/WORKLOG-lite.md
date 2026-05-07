# Worklog Lite

Registro curto do andamento recente para manter contexto operacional.

Formato:
- data
- frente
- status atual
- proximo passo natural

## 2026-04-06

### PRDs e contexto
- status atual:
  - criado `docs/PRD-map-lite.md`
  - PRDs secundarios movidos para `docs/prd-archive/`
  - leitura padrao consolidada em `PRD-lite -> PRD-map-lite -> PRD especifico`
- proximo passo natural:
  - manter mapa atualizado quando uma frente mudar de `ativa` para `historico controlado`

### Backend
- status atual:
  - saneamento do `typecheck` do backend concluido
  - `npm run typecheck -w apps/backend` passando
- proximo passo natural:
  - preservar esse estado em novos cortes

### Port forwarding
- status atual:
  - porta preferida x porta ativa implementadas
  - fallback automatico implementado
  - UX do terminal e do painel mostrando forwarding ativo
  - template salvo relacionado ao tunel ativo com mais clareza
- proximo passo natural:
  - refinamentos visuais e contextuais se aparecerem duvidas no uso real

### Sessao compartilhada
- status atual:
  - sessao propria e sessao ao vivo implementadas
  - pedido de controle, grant, deny e revoke implementados
  - owner pode retomar controle
  - auditoria multiusuario enriquecida
- proximo passo natural:
  - retomada do viewer sem novo link
  - refinamentos de UX na transicao de controle

### Dashboard pessoal e admin
- status atual:
  - dashboard pessoal implementado com favoritos, recentes e metricas principais
  - dashboard admin de adocao implementado no primeiro corte com drill-down de usuario
  - contadores de sessoes ativas passaram a limpar sessoes SSH stale antes da exibicao
- proximo passo natural:
  - comparativos com periodo anterior
  - filtros mais ricos

### Sessoes SSH
- status atual:
  - heartbeat persistido por sessao SSH adicionado
  - limpeza recorrente de sessoes stale aplicada em `Inicio`, `Dashboard`, `Sessoes SSH` e limites de sessao
  - auditorias `RUNNING` orfas passam a ser reparadas junto da limpeza recorrente
- proximo passo natural:
  - avaliar job periodico dedicado se houver volume alto ou necessidade de SLA mais curto de limpeza

### Agentes
- status atual:
  - instrucoes de Windows, Linux e macOS melhoradas
  - tela passou a refletir binarios realmente publicados no servidor
- proximo passo natural:
  - exibir suporte/plataforma real por arquitetura quando houver multiplos artefatos
  - melhorar onboarding/diagnostico do agente

### Bastions
- status atual:
  - PRD de bastions criado
  - foco definido em visibilidade de uso, bastion efetivo por host/grupo e reaproveitamento futuro de PEM cadastrada
  - fase 1 de UX implementada:
    - backend expõe bastion efetivo do host e origem (`host`, `group`, `none`)
    - tela de Hosts permite selecionar `Bastion / Jump server` diretamente no host
    - tela de Hosts mostra badge/tooltip com bastion efetivo
    - tela de Bastions mostra uso por hosts diretos, grupos e hosts herdados
    - exclusao de bastion em uso retorna mensagem com contagens de impacto
  - fase 2 iniciada:
    - bastion pode reutilizar PEM cadastrada no sistema via `systemPemKeyId`
    - fluxo legado de colar PEM no bastion foi mantido como opcional
    - terminal, SFTP e teste de conexao usam PEM cadastrada antes da PEM legada
    - terminal diferencia erro no bastion de erro no host final
    - verificação de host key permanece obrigatoria para o host final; trust-store dedicado para bastions ficou para fase de seguranca
- proximo passo natural:
  - completar `PEM + senha` para bastion, se a mesma semantica dos hosts for necessaria
  - implementar trust-store de host key para bastions
  - avaliar migracao assistida de PEMs legadas para PEMs cadastradas

### Snippets e Vault Secrets
- status atual:
  - PRD de snippets criado
  - PRD de Vault Secrets criado
  - decisao consolidada: snippets referenciam secrets, mas nao armazenam senha em claro
  - backend foundation do Vault implementado com schema, API, criptografia, ACL minima e auditoria sem valor sensivel
  - UI minima de Secrets implementada com listagem sem valor, criacao, edicao de metadados, rotacao, revogacao, exclusao definitiva e orientacoes de seguranca
  - snippets agora reconhecem `{{secret:alias}}`, exibem aliases usados e resolvem o valor server-side no gateway SSH com auditoria mascarada
  - cadastro/edicao de snippets valida aliases acessiveis visualmente
  - stdout passa por redaction defensivo em memoria com TTL curto apos uso de secret
  - snippets alertam padroes obvios de segredo literal, como `mysql -pSENHA`, `password=`, `curl -u usuario:senha` e `PGPASSWORD=`
- proximo passo natural:
  - avaliar se alguns alertas devem virar bloqueio por politica

## 2026-04-08

### Tenancy e plataforma
- status atual:
  - separacao inicial entre `ADMIN` do tenant e `platform admin` implementada
  - gestao de tenants adicionada no backend e no frontend
  - tela `Empresas` criada para `platform admin`
  - script de bootstrap para promover o primeiro `platform admin` adicionado
- proximo passo natural:
  - endurecer resolucao pre-login do tenant e revisar isolamento operacional cross-tenant

### Licenciamento e entitlements
- status atual:
  - licenca expandida com `maxHosts`, entitlements por modulo e providers de integracao
  - bloqueio real aplicado para `hosts`, `snippets`, `acessos locais`, `integracoes`, `agents`, `secrets` e `feedback`
  - configuracao da licenca passou a ser editavel pela UI de `Configuracoes`
  - dashboard admin ganhou resumo de licenciamento do tenant
- proximo passo natural:
  - distinguir futuramente entitlements comerciais de toggles operacionais do tenant

### Feedback
- status atual:
  - modulo completo de feedback implementado com envio pelo usuario, inbox admin e resposta curta
  - feedback pode ser habilitado ou desligado por tenant via entitlement
  - exclusao de feedback passou a ser `soft delete` com `quem` e `quando`
  - tela admin recebeu busca, contexto do feedback e tendencia recolhida por periodo/status
  - terminal passou a expor feedback na barra de acoes, sem botao flutuante intrusivo
- proximo passo natural:
  - adicionar notificacao/badge para usuario quando houver atualizacao de status ou resposta

### UX e operacao
- status atual:
  - dashboard pessoal esclarece janela movel de `ultimos 30 dias` e tendencia em `4 periodos`
  - gestao de usuarios ganhou `transfer list` para grupos, copia de grupos de outro usuario e resumo de associacoes
  - hosts respeitam limite de licenca tambem no botao de criacao
  - documentacao operacional expandida com `DEPLOY-lite` e PRDs novos para playback, onboarding de agentes, tenancy, licensing e feedback
- proximo passo natural:
  - seguir refinando onboarding de agentes e automacoes operacionais por tenant/integracao

## 2026-04-22
- tela administrativa de playbooks preparada para o conceito de `steps`, ainda salvando em `commands` por compatibilidade
- documentado backlog para evolucao futura de `steps` no backend e posterior suporte governado a `script`

### MCP
- status atual:
  - PRD de MCP consolidado com foco em `MCP Server` read-only como primeiro corte
  - backlog inicial quebrado para hosts, dashboards, sessoes, auditoria e diagnosticos
  - direcao registrada para evolucao futura de tools governadas e autonomia controlada, sem shell arbitrario
  - modulo backend inicial implementado com discovery, auth por JWT ou token tecnico estatico, allowlist por capability e rate limit basico
  - guia operacional inicial criado com exemplos via `curl`
  - tokens MCP persistidos por tenant, tela admin, uso rapido e logs filtrados por token implementados
  - ponte JSON-RPC implementada para discovery, resources e tools iniciais
  - `ActionRun` conectado ao MCP com resources de leitura e tools governadas para solicitar, cancelar e aprovar
- proximo passo natural:
  - ampliar governanca por token/capability com politicas mais finas
  - avaliar `reject_action_run` e filtros/resource views por status
  - aproximar ainda mais o payload do protocolo MCP completo

### Acesso SSH operacional por IA
- status atual:
  - direcao consolidada para acesso SSH por IA com sessao tecnica, modos de acesso e policy
  - decisao registrada para nao expor shell livre diretamente ao provider ou ao MCP
- proximo passo natural:
  - modelar `ActionRun` e policy de aprovacao
  - separar dominio de acao do dominio de diagnostico

### Diagnostic Playbooks
- status atual:
  - catalogo inicial de 4 playbooks low-risk implementado no dashboard do host
  - `DiagnosticRun` com execucao real em runner SSH isolado para hosts `DIRECT`
  - persistencia de comandos, status, truncamento e redaction implementada
  - detalhe da execucao implementado com saida por comando
  - resumo por IA assincrono implementado com risco, confianca, achados e proximos passos
  - regeneracao do resumo por IA implementada sem rerodar o playbook
  - dashboard do host mostra status da execucao, status da IA, risco resumido e filtros rapidos
  - ajuda contextual implementada no dashboard do host e no detalhe da execucao
  - guia operacional curto criado para escolha de playbook e leitura de estados
- proximo passo natural:
  - ampliar runner para rotas via agent
  - adicionar exportacao de resultado
  - criar visao administrativa do catalogo e das execucoes
