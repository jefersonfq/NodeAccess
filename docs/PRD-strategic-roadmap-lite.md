# PRD Lite - Roadmap Estrategico de Valor

Versao curta para orientar modulos futuros que aumentam o valor do NodeAccess frente a ferramentas de acesso, PAM e Zero Trust.

## Objetivo
- posicionar o NodeAccess como plataforma de acesso operacional seguro
- aumentar diferenciacao alem de terminal web e SSH Gateway
- priorizar modulos com valor comercial, seguranca, auditoria e produtividade
- manter foco em operacao real de times de infraestrutura, suporte, NOC, DevOps e SRE

## Posicionamento desejado
O NodeAccess deve evoluir de `terminal web + gateway SSH` para uma camada central de acesso operacional:
- acesso seguro
- credenciais protegidas
- auditoria forte
- colaboracao controlada
- automacao com governanca
- contexto operacional e IA assistiva

O diferencial desejado nao e competir apenas por protocolo, mas por fluxo de trabalho: o usuario tecnico consegue operar rapido, enquanto a empresa ganha controle e rastreabilidade.

## Referencias de mercado observadas
Ferramentas como Boundary, Teleport, StrongDM e solucoes PAM modernas reforcam alguns vetores de valor:
- acesso just-in-time
- session recording/replay
- credential injection
- certificados ou credenciais efemeras
- catalogos dinamicos de infraestrutura
- acesso a multiplos protocolos, como SSH, banco de dados e Kubernetes
- auditoria centralizada
- integracao com identidade, cofre e fluxos de aprovacao

O NodeAccess pode se diferenciar sendo mais pragmatico, mais simples de operar e mais proximo da rotina diaria de suporte/infra.

## Modulos estrategicos recomendados

### 1. Just-in-Time Access
Permitir que usuarios solicitem acesso temporario a host, grupo, ambiente ou acao.

Valor:
- reduz privilegio permanente
- melhora compliance
- cria trilha de pedido, aprovacao, duracao e justificativa

Escopo inicial:
- pedido de acesso por host/grupo
- aprovacao por admin ou responsavel
- TTL curto
- revogacao manual
- auditoria administrativa

### 2. Credential Injection e credenciais efemeras
Manter credenciais do host fora da maquina do usuario e injeta-las somente durante a sessao.

Valor:
- reduz vazamento de senha/PEM
- melhora offboarding
- permite rotacao e credenciais de curta duracao

Evolucao:
- credencial cadastrada ou 1Password como base atual
- senha temporaria ou OTP no futuro
- integracao com Vault/CA quando fizer sentido
- nunca retornar segredo em payload comum ao frontend

### 3. SSH CA e certificados curtos
Emitir certificados SSH de curta duracao por usuario, host, grupo e politica.

Valor:
- substitui chaves permanentes
- facilita revogacao
- melhora rastreabilidade
- permite compatibilidade com OpenSSH

Escopo recomendado:
- CA do NodeAccess ou integracao com CA externa
- validade curta
- principals por usuario/host
- auditoria de emissao e uso
- rollout opcional por grupo de hosts

### 4. Session Replay e resumo inteligente
Evoluir auditoria para replay pesquisavel e resumo assistido.

Valor:
- acelera investigacao
- melhora suporte e revisao de incidentes
- gera evidencia para compliance

Escopo:
- replay textual/event-based
- timeline de comandos
- filtros por risco, host, usuario e comando
- resumo por IA:
  - o que aconteceu
  - comandos criticos
  - risco
  - proximas acoes sugeridas

Referencia relacionada:
- `docs/PRD-session-playback-lite.md`
- `docs/PRD-session-audit-ai-lite.md`

### 5. Policy Engine de comandos
Criar politica para permitir, alertar, bloquear ou exigir aprovacao conforme comando, host, grupo, usuario e ambiente.

Valor:
- reduz risco operacional
- permite modo somente leitura em producao
- cria governanca sem bloquear todos os fluxos

Exemplos:
- bloquear `rm -rf /`
- exigir aprovacao para `systemctl restart`
- alertar comandos com senha/token inline
- permitir apenas comandos de leitura em hosts sensiveis

Referencia relacionada:
- `docs/PRD-session-command-policy-lite.md`

### 6. Catalogo dinamico de infraestrutura
Sincronizar hosts automaticamente de fontes externas.

Valor:
- reduz cadastro manual
- melhora aderencia em ambientes grandes
- mantem inventario atualizado

Fontes futuras:
- AWS, Azure, GCP
- VMware/Proxmox
- Kubernetes nodes
- NetBox/CMDB
- agentes NodeAccess
- tags e grupos automaticos

Escopo inicial recomendado:
- importar/sincronizar de uma fonte simples
- marcar origem do host
- permitir override manual controlado
- logs de sync

### 7. Runbooks operacionais
Evoluir snippets/macros para runbooks com variaveis, passos, aprovacao e auditoria.

Valor:
- padroniza diagnostico e operacao
- reduz erro humano
- melhora onboarding de novos tecnicos
- transforma automacao em fluxo governado

Exemplos:
- diagnostico de disco
- validar servico
- coletar logs
- restart controlado
- checklist pos-deploy

Referencia relacionada:
- `docs/PRD-snippets-lite.md`
- `docs/PRD-terminal-macros-lite.md`

### 8. Database Access
Adicionar acesso auditado a bancos de dados.

Valor:
- amplia mercado alem de SSH
- compete melhor com plataformas de acesso moderno
- centraliza logs de queries e autorizacao

Alvos:
- PostgreSQL
- MySQL/MariaDB
- Redis

Escopo inicial:
- proxy ou conexao via navegador
- credenciais protegidas no NodeAccess
- auditoria de queries quando tecnicamente viavel
- permissao por usuario/grupo

### 9. Kubernetes Access
Adicionar acesso controlado a clusters Kubernetes.

Valor:
- atende DevOps/SRE/cloud-native
- centraliza auditoria de `kubectl`, logs e exec
- amplia a plataforma para ambientes modernos

Escopo inicial:
- catalogo de clusters
- acesso a pods/logs
- exec controlado
- permissao por namespace
- auditoria de comandos

### 10. Access Review e recertificacao
Modulo para revisar periodicamente quem tem acesso a hosts, grupos, segredos e recursos.

Valor:
- compliance
- reducao de privilegios antigos
- evidencia para auditoria interna

Escopo:
- campanhas de revisao
- responsavel por grupo/ambiente
- aprovar, remover ou justificar acesso
- relatorio exportavel

## Ordem recomendada de investimento
1. Just-in-Time Access
2. Session Replay + resumo inteligente
3. Policy Engine de comandos
4. SSH CA / credenciais efemeras
5. Catalogo dinamico de hosts
6. Runbooks operacionais
7. Database Access
8. Kubernetes Access
9. Access Review / recertificacao

## Criterios de priorizacao
Priorizar modulos que:
- reduzem risco sem travar operacao
- aumentam auditoria e rastreabilidade
- melhoram adocao diaria por tecnicos
- ajudam venda para empresas com compliance
- reaproveitam capacidades ja existentes do NodeAccess
- podem ser entregues em cortes pequenos e reversiveis

Evitar modulos que:
- exigem reescrever terminal, auth ou sessao sem necessidade
- dependem de infraestrutura complexa antes de provar valor
- tornam a ferramenta pesada para o publico atual
- prometem automacao sem guardrails

## Diferencial estrategico
O NodeAccess pode ocupar um espaco pragmatico entre ferramentas simples de terminal web e plataformas PAM/Zero Trust mais pesadas:
- mais governanca que um bastion tradicional
- mais produtividade que um PAM classico
- mais simples de operar que plataformas enterprise muito amplas
- mais integrado ao dia a dia tecnico com snippets, runbooks, SFTP, acessos locais, SSH Gateway e IA contextual

## Mensagem de produto
NodeAccess centraliza, governa e audita o acesso operacional sem tirar velocidade dos times tecnicos.
