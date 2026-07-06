# PRD Lite - Security Assessment e Certificacao

Versao curta para orientar varreduras de seguranca, hardening e preparacao do NodeAccess para avaliacao comercial, auditoria e certificacao.

## Objetivo
- criar uma rotina repetivel de avaliacao de seguranca do NodeAccess
- cobrir infraestrutura, aplicacao web, API, WebSocket, SSH Gateway, dependencias, containers e configuracao
- gerar evidencias tecnicas para proposta comercial, auditoria e correcao de vulnerabilidades
- evitar depender de uma unica ferramenta de scan

## Principio
Nessus e recomendado, mas nao deve ser o unico controle.

O NodeAccess possui riscos especificos que scanners genericos nao cobrem completamente:
- isolamento de tenant
- autorizacao por host/grupo/usuario
- sessao SSH via WebSocket
- SSH Gateway nativo
- snippets e secrets
- auditoria e mascaramento de dados sensiveis
- MFA, lockout e rate limit
- expiracao de sessao e revogacao de acesso

## Ferramentas recomendadas

### Nessus / Tenable
Uso:
- varredura de infraestrutura
- portas expostas
- CVEs de sistema operacional e servicos
- TLS/certificados
- misconfigurations
- credentialed scan no host quando permitido
- relatorios de remediacao

Recomendacao:
- rodar scan externo sem credenciais
- rodar scan interno com credenciais no servidor de staging/producao controlada
- separar achados reais de falso positivo

### OWASP ZAP
Uso:
- DAST da aplicacao web
- XSS
- SQL Injection
- path traversal
- command injection
- headers inseguros
- cookies e sessoes
- falhas comuns de formulario/API

Recomendacao:
- rodar baseline scan sem autenticacao
- rodar scan autenticado com usuario comum
- rodar scan autenticado com admin em ambiente staging
- tomar cuidado com active scan em ambiente com dados reais

### Nuclei
Uso:
- checks rapidos baseados em templates
- exposicoes conhecidas
- misconfigurations HTTP
- deteccao de paineis, versoes e endpoints sensiveis

Recomendacao:
- usar em staging e em janela controlada
- manter templates atualizados
- registrar templates usados no relatorio

### SAST e dependencias
Ferramentas sugeridas:
- `npm audit`
- Semgrep
- Snyk, se houver licenca
- CodeQL, se houver pipeline GitHub

Objetivo:
- detectar vulnerabilidades em dependencias
- identificar padroes inseguros no codigo
- revisar uso de criptografia, SQL, auth, secrets e inputs

### Containers e imagens
Ferramentas sugeridas:
- Trivy
- Docker Scout, se aplicavel

Objetivo:
- CVEs em imagens
- pacotes vulneraveis
- configuracao insegura de containers
- usuario root, permisssions e capabilities

### Secrets no repositorio
Ferramentas sugeridas:
- Gitleaks
- TruffleHog, se necessario

Objetivo:
- detectar tokens, senhas, chaves privadas e credenciais acidentalmente commitadas
- validar exemplos `.env` e documentacao

### Host compliance / hardening
Ferramentas sugeridas:
- OpenSCAP
- Lynis
- CIS benchmark da distro quando aplicavel

Objetivo:
- avaliar hardening do servidor Linux
- gerar relatorio de compliance
- orientar ajustes de SSH, firewall, usuario de servico, logs e permissao de arquivos

## Ambiente recomendado para scan
Criar ambiente `staging-security` o mais proximo possivel de producao:
- HTTPS habilitado
- banco separado com dados ficticios
- Redis habilitado
- MySQL habilitado
- gateway SSH habilitado
- SSH Gateway com host de laboratorio
- usuarios de teste:
  - admin
  - usuario comum
  - usuario sem permissao de host
  - usuario bloqueado/inativo
- hosts de teste:
  - host acessivel
  - host sem permissao
  - host via bastion
  - host com segredo/1Password simulado quando possivel

## Escopo minimo de testes automatizados

### Infraestrutura
- portas abertas
- versoes de servicos
- TLS/certificados
- headers HTTP
- exposicao de paineis internos
- Docker e host Linux

### Aplicacao Web/API
- login e MFA
- refresh token
- logout
- controle de sessao expirada
- autorizacao por papel
- autorizacao por tenant
- validacao de inputs
- upload/download quando aplicavel
- rate limit e lockout

### Terminal e WebSocket
- autenticacao no WebSocket
- reconexao
- encerramento ao expirar sessao
- isolamento entre usuarios
- tentativa de acessar sessao de outro usuario
- buffer/saida sensivel
- paste de comandos longos

### SSH Gateway
- login aceito/negado
- MFA aceito/negado
- rate limit por IP e usuario
- host solicitado sem permissao
- host inexistente
- formato de login direto
- auditoria de conexao aberta/fechada

### Snippets e Secrets
- snippets com `{{secret:alias}}`
- snippet com segredo literal detectado
- execucao com secret sem expor valor no frontend
- auditoria mascarada
- tentativa de usar secret sem permissao

### Auditoria
- eventos de login
- eventos administrativos
- sessao SSH aberta/fechada
- comandos e stdin mascarados quando necessario
- exportacao/consulta de logs por permissao

## Testes manuais obrigatorios
Scanners nao substituem testes manuais nos seguintes pontos:
- bypass de tenant
- IDOR em hosts, sessoes, secrets, snippets e grupos
- permissao horizontal entre usuarios do mesmo tenant
- permissao vertical usuario comum vs admin
- uso indevido de WebSocket
- revogacao de usuario durante sessao ativa
- expiracao de token durante sessao SSH
- mascaramento real de secrets em auditoria
- comandos perigosos e politicas de bloqueio

## Pipeline sugerido

### Local/dev
- `npm audit`
- typecheck/testes automatizados
- gitleaks
- semgrep rapido

### Staging
- Trivy nas imagens
- ZAP baseline
- Nuclei
- Nessus externo
- Nessus credentialed quando autorizado
- testes manuais guiados por checklist

### Pre-release
- reexecutar scans criticos
- revisar falsos positivos
- gerar relatorio final
- anexar evidencias:
  - versao
  - commit
  - data
  - ambiente
  - ferramenta
  - configuracao do scan
  - achados
  - correcao
  - rescan

## Saida esperada
Cada ciclo de avaliacao deve gerar:
- relatorio executivo
- relatorio tecnico
- lista de achados por criticidade
- falso positivo documentado
- plano de remediacao
- evidencias de correcao
- resultado de rescan

Criticidades:
- Critico
- Alto
- Medio
- Baixo
- Informativo

## Criterios de aceite para uma versao candidata
- nenhum achado critico aberto
- nenhum achado alto sem justificativa e plano aprovado
- MFA obrigatorio validado
- isolamento de tenant validado
- autorizacao de hosts validada
- secrets nao expostos em API, frontend, logs ou auditoria
- WebSocket e SSH Gateway exigem autenticacao valida
- rate limit/lockout validado nos fluxos criticos
- dependencias sem CVEs criticas conhecidas
- imagens sem CVEs criticas conhecidas ou com mitigacao documentada
- relatorio de scan anexado a versao

## Riscos
- scans ativos podem alterar dados ou derrubar servicos em ambiente produtivo
- scanners podem gerar falso positivo
- scanners podem nao detectar falhas de autorizacao e regra de negocio
- scans autenticados com admin podem executar rotas sensiveis
- logs podem crescer muito durante scan

## Guardrails
- preferir staging para active scan
- nunca rodar active scan destrutivo em producao sem janela e backup
- usar dados ficticios
- criar usuarios especificos de scan
- limitar escopo por URL, IP e horario
- comunicar time operacional antes de scans agressivos
- versionar configuracao dos scans quando possivel

## Proximo passo recomendado
1. criar checklist operacional de scan
2. adicionar scripts locais para:
   - `npm audit`
   - gitleaks
   - semgrep
   - trivy
   - nuclei
   - zap baseline
3. preparar ambiente `staging-security`
4. configurar Nessus com policy externa e credentialed
5. gerar primeiro relatorio baseline
6. corrigir achados criticos/altos
7. executar rescan
