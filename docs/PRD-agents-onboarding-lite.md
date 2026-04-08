# PRD Agents Onboarding Lite

## Objetivo
Simplificar a instalacao, ativacao e validacao de agentes nas maquinas dos usuarios, reduzindo dependencia de passos manuais e suporte operacional.

## Problema
Hoje o fluxo de agentes ainda exige conhecimento tecnico demais para o usuario final:
- criar agente
- copiar token
- entender qual binario baixar
- executar comando correto por sistema operacional
- saber se o agente realmente conectou

Isso aumenta erro de setup, especialmente em:
- Windows
- usuarios que nao entendem CLI
- ambientes com VPN, proxy ou firewall local

## Resultado Esperado
O usuario deve conseguir sair de:
- `Nao tenho agente`

para:
- `Agente online e pronto para uso`

em poucos passos, com linguagem clara e validacao visivel.

## Principios
- reduzir texto tecnico desnecessario
- separar claramente instalacao, execucao e validacao
- nao depender de conhecimento previo de terminal
- orientar por sistema operacional
- manter token seguro e exibido uma unica vez

## Fluxo Recomendado
### 1. Criacao do agente
Ao criar um agente, abrir onboarding guiado imediatamente.

Etapas:
1. nomear o agente
2. exibir token uma unica vez
3. escolher sistema operacional
4. mostrar forma recomendada de instalar/executar
5. validar quando o agente ficar online

### 2. Escolha de modo de instalacao
Oferecer dois caminhos explicitos:
- `Executar agora`
  - bom para teste rapido
- `Instalar como servico`
  - recomendado para uso continuo

### 3. Instrucoes por plataforma
#### Windows
- texto claro: o agente e um executavel de terminal, nao aplicativo com janela
- oferecer:
  - comando PowerShell
  - comando CMD
  - script `.ps1` opcional
- no futuro:
  - instalador `.msi`
  - servico do Windows

#### Linux
- oferecer:
  - binario
  - script de instalacao
  - unidade `systemd`
- UX recomendada:
  - `baixar`
  - `instalar`
  - `habilitar servico`
  - `validar online`

#### macOS
- oferecer:
  - binario
  - script de instalacao
  - configuracao `launchd`
- explicar permissao inicial quando o sistema bloquear primeira execucao

## MVP Recomendado
### Frontend
- wizard pos-criacao do agente
- seccoes por sistema operacional
- botoes:
  - `Copiar token`
  - `Copiar comando`
  - `Baixar binario`
  - `Validar agente`
- status visual:
  - `Aguardando execucao`
  - `Conectando`
  - `Online`
  - `Erro ao conectar`

### Backend
- endpoint simples de health/diagnostico do agente
- retorno minimo:
  - `online`
  - `lastSeenAt`
  - `version` quando disponivel
  - `hostname` quando disponivel
  - `platform` quando disponivel
  - `lastErrorReason` quando disponivel

### Agent
- enviar metadados minimos no handshake:
  - versao
  - hostname
  - plataforma
- manter heartbeat simples

## UX Recomendada
### Tela principal de agentes
Separar visualmente:
- `Baixar e instalar`
- `Meus agentes`
- `Diagnostico`

### Linguagem
Preferir textos como:
- `Baixe o agente para sua maquina`
- `Execute este comando no PowerShell`
- `Instale como servico para manter o agente ativo`
- `Aguardando conexao do agente`
- `Agente conectado e pronto para uso`

Evitar:
- termos muito internos
- linguagem excessivamente tecnica no primeiro contato

## Diagnostico Minimo
O usuario deve conseguir responder:
- o agente esta online?
- qual maquina esta conectada?
- quando foi o ultimo contato?
- o token foi aceito?
- houve erro de rede, proxy ou firewall?

## Sinais Visuais Recomendados
- verde: online
- amarelo: configurado mas aguardando conexao
- vermelho: erro ou offline
- mensagem curta com acao sugerida

Exemplos:
- `Agente online`
- `Aguardando voce executar o agente nesta maquina`
- `Nao foi possivel conectar. Verifique VPN, proxy ou firewall`

## Evolucao Recomendada
### Fase 1
- wizard pos-criacao
- comandos separados por SO
- validacao de conexao simples

### Fase 2
- instalacao como servico:
  - Windows Service
  - `systemd`
  - `launchd`

### Fase 3
- scripts/guias baixaveis
- instaladores nativos:
  - `.msi`
  - `.deb`
  - `.rpm`
  - `.pkg`

### Fase 4
- auto-update
- fleet management basico

## Fora de Escopo Inicial
- auto-update do agente
- assinatura de binarios
- console completo de fleet management
- politicas avancadas por tipo de agente

## Arquivos Provaveis
- frontend:
  - `apps/frontend/src/views/AgentsView.vue`
  - `apps/frontend/src/services/agent.service.ts`
  - `apps/frontend/src/locales/pt-BR.json`
  - `apps/frontend/src/locales/en.json`
- backend:
  - `apps/backend/src/modules/agents/agent.routes.ts`
  - `apps/backend/src/modules/agents/agent.service.ts`
  - `apps/backend/src/modules/agents/agent.gateway.ts`
  - `apps/backend/src/modules/agents/agent.registry.ts`
- agent:
  - `apps/agent/src/index.js`
  - `apps/agent/package.json`

## Proximo Corte Recomendado
1. wizard pos-criacao do agente
2. validacao `online/offline` com metadados minimos
3. comandos e instrucoes separados por sistema operacional
4. instalacao como servico em fase seguinte
