# NodeAccess: roteiro de apresentacao comercial

## Objetivo
Material base para montar uma apresentacao comercial ou proposta executiva do NodeAccess.

O foco e explicar o problema, o valor, os diferenciais e um roteiro de demonstracao sem entrar em detalhe tecnico excessivo.

## Slide 1 - Titulo
**NodeAccess**

Acesso SSH centralizado, seguro e auditavel para times tecnicos.

Mensagem de apoio:
- terminal web
- SSH Gateway nativo
- MFA, permissao e auditoria
- colaboracao controlada

## Slide 2 - Problema
O acesso SSH em empresas costuma ficar distribuido demais.

Pontos:
- cada usuario configura seu proprio cliente SSH
- senhas, chaves e bastions ficam espalhados
- pouca visibilidade sobre acessos realizados
- onboarding de novos usuarios e lento
- suporte remoto depende de compartilhamento informal de tela, comando ou senha
- acessos pontuais de terceiros exigem criar credenciais permanentes ou compartilhar senhas

## Slide 3 - Impacto no negocio
Essa fragmentacao cria risco e custo operacional.

Pontos:
- dificuldade de auditar acessos sensiveis
- offboarding mais arriscado
- perda de tempo para localizar hosts e credenciais
- investigacao de incidentes mais lenta
- padroes diferentes entre equipes
- sem rastreabilidade de acessos pontuais de terceiros

## Slide 4 - Solucao
O NodeAccess cria uma camada unica para acesso operacional SSH.

Pontos:
- acesso via navegador
- acesso via cliente SSH nativo passando pelo gateway
- MFA e permissao antes da conexao
- credenciais do host protegidas no servidor
- trilha de auditoria centralizada
- acesso temporario por link para terceiros, sem entregar credencial

## Slide 5 - Como funciona
Fluxo simplificado:

```
Usuario
  -> NodeAccess
  -> MFA, permissao, auditoria
  -> Bastion, credencial e host final
```

Mensagem:
O usuario acessa com rapidez; a empresa mantem controle.

## Slide 6 - Recursos principais
- Terminal SSH web.
- SSH Gateway para cliente nativo.
- SFTP e arquivos.
- Bastion/jump host.
- Hosts pessoais, de equipe e globais.
- Acessos locais (port forwarding SSH) com configuracao por host.
- Snippets pessoais e de equipe.
- 1Password por referencia.
- Google SSO e Google Workspace (provisionamento e desativacao automatica).
- Acesso JIT (Just-In-Time): link temporario com PIN, expiracao configuravel e revogacao em tempo real.
- Favoritos, recentes e preferencias por usuario.
- Logs administrativos e auditoria de sessao.
- Sessao compartilhada com controle bidirecional e revogacao pelo owner.
- Dashboard pessoal com atividade, hosts favoritos e recursos mais usados.
- Dashboard administrativo de adocao: usuarios ativos, hosts mais acessados, uso por recurso.
- Webhooks de saida: 11+ tipos de evento com assinatura HMAC, retry e historico de entrega.
- Webhooks de entrada: recepcao de eventos externos (monitoramento, CMDB, ITSM) com validacao e idempotencia.

## Slide 7 - Diferenciais
- Nao e apenas terminal web: e governanca de acesso SSH.
- Permite usar cliente SSH nativo sem entregar credencial do host ao usuario.
- Une produtividade, auditoria e seguranca no mesmo fluxo.
- Suporta colaboracao assistida sem compartilhar senha.
- Acesso JIT para terceiros: contratados, auditores e resposta a incidentes sem criar usuario ou expor credencial permanente.
- Plataforma de integracao bidirecional via webhooks: emite eventos para sistemas externos e recebe notificacoes de monitoramento, CMDB e ITSM.
- IA governada por token MCP: acoes remotas auditadas com politica de permissao, sem acesso livre ao ambiente.
- Prepara base para compliance, automacao controlada e certificacoes de seguranca.

## Slide 8 - Exemplo de uso via gateway
O usuario pode conectar pelo cliente SSH:

```bash
ssh -p 2222 'usuario_nodeaccess@host'@gateway
ssh -p 2222 'usuario_nodeaccess@usuario_host@host'@gateway
```

O NodeAccess:
- autentica o usuario
- exige MFA quando configurado
- valida permissao
- resolve o host cadastrado
- abre a conexao com a credencial protegida
- registra auditoria

## Slide 9 - Acesso JIT: terceiros sem credencial permanente
Fluxo de acesso temporario:

```
Owner cria link -> define expiracao e PIN opcional
  -> envia link ao terceiro
  -> terceiro acessa sem criar usuario
  -> revogacao imediata se necessario
  -> auditoria completa do acesso
```

Casos de uso:
- contratado ou consultor externo com acesso pontual
- auditor que precisa inspecionar ambiente por algumas horas
- equipe de suporte de fornecedor durante incidente
- onboarding assistido sem expor credenciais internas

## Slide 10 - Beneficios para a empresa
- Menos credenciais espalhadas.
- Mais rastreabilidade.
- Menor risco no offboarding.
- Padrao unico para acesso SSH.
- Melhor suporte entre times.
- Acesso de terceiros sem risco de credencial permanente.
- Visibilidade de adocao e uso via dashboards administrativos.
- Integracao com sistemas externos via webhooks sem desenvolvimento customizado.
- Base para compliance e governanca.

## Slide 11 - Beneficios para o time tecnico
- Menos configuracao local.
- Acesso mais rapido aos hosts.
- Busca, favoritos e recentes.
- Terminal web ou cliente SSH nativo.
- SFTP e acessos locais no mesmo ambiente.
- Snippets de equipe para comandos recorrentes.
- Colaboracao em sessao ao vivo com controle bidirecional.
- Dashboard pessoal com historico de atividade e recursos mais usados.

## Slide 12 - Demonstracao sugerida
Ordem recomendada:
1. Login com MFA.
2. Dashboard pessoal: atividade recente, favoritos, recursos usados.
3. Lista de hosts e favoritos/recentes.
4. Conexao SSH web.
5. SFTP ou acesso local.
6. Sessao compartilhada com pedido de controle e revogacao pelo owner.
7. Criacao de link JIT com PIN e expiracao; acesso como convidado; revogacao.
8. Logs/auditoria do acesso (incluindo registro do convidado JIT).
9. Dashboard administrativo de adocao.
10. Conexao via SSH Gateway pelo terminal nativo.
11. Exemplo de evento de webhook disparado e entrega com assinatura.

## Slide 13 - Integracao com sistemas externos
O NodeAccess emite eventos em tempo real para sistemas externos:

Exemplos de eventos de saida:
- `ssh_session.started` / `ssh_session.ended`
- `host.created` / `host.updated` / `host.deleted`
- `action_run.approved` / `action_run.completed`
- `diagnostic_run.completed`
- `mcp_interactive_ssh_session.opened`

Exemplos de uso:
- notificacao no Slack ao abrir sessao em host critico
- registro automatico em ITSM ao iniciar acesso
- disparo de pipeline de auditoria ao encerrar sessao
- integracao com n8n, Zapier, Make ou sistema proprio

O NodeAccess tambem recebe eventos externos:
- alertas de monitoramento associados a hosts
- atualizacoes de CMDB com metadados de criticidade
- notificacoes de ITSM para correlacao com incidentes

## Slide 14 - Roadmap de valor
Proximas evolucoes que reforcam valor comercial:
- aliases curtos de hosts no SSH Gateway
- playback textual de sessao SSH (replay de terminal com timeline de comandos)
- relatorios de auditoria e compliance com exportacao
- SSH CA/certificados de curta duracao
- expansao de eventos de webhooks e inbound completo
- fase 3 do dashboard de adocao: filtros por grupo e insights de onboarding

## Slide 15 - Posicionamento
NodeAccess centraliza e audita o acesso SSH da empresa sem tirar velocidade dos times tecnicos.

## Slide 16 - Perguntas para qualificacao comercial
- Quantos usuarios acessam servidores por SSH hoje?
- Quantos hosts ou ambientes precisam ser acessados?
- Existe exigencia de MFA, auditoria ou compliance?
- Como e feito o offboarding de acessos SSH?
- As credenciais ficam em cofres, arquivos locais ou compartilhadas entre times?
- Existe uso de bastion/jump server?
- O time precisa de suporte assistido ou sessao compartilhada?
- A empresa prefere acesso via browser, cliente SSH nativo ou ambos?
- Terceiros (contratados, auditores, fornecedores) precisam de acesso pontual hoje? Como e feito?
- Existe interesse em integrar eventos de acesso com sistemas de monitoramento ou ITSM?

## Slide 17 - Proposta de piloto
Piloto sugerido:
- 10 a 30 usuarios tecnicos
- 20 a 100 hosts representativos
- MFA habilitado
- logs e auditoria ativados
- demonstracao de SSH web, SSH Gateway, SFTP e sessao compartilhada
- ao menos um caso de uso de acesso JIT com terceiro
- ao menos uma integracao de webhook com sistema externo
- avaliacao por 2 a 4 semanas

Indicadores do piloto:
- tempo ate primeira conexao
- quantidade de acessos via NodeAccess
- reducao de configuracoes locais
- feedback dos usuarios tecnicos
- qualidade dos logs para auditoria e suporte
- numero de acessos JIT realizados sem credencial permanente
- eventos de webhook entregues e integracoes ativadas
