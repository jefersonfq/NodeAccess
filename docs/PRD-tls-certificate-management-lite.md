# PRD Lite - TLS e Certificados de Deploy

## Problema

Hoje o deploy de producao assume:
- `frontend` sempre sobe com `443`
- o container Nginx sempre exige:
  - `certs/fullchain.pem`
  - `certs/privkey.pem`
- `install-nodeaccess.sh` e `update-nodeaccess.sh` falham se esses arquivos nao existirem

Isso cria atrito operacional alto:
- bloqueia primeira instalacao simples
- exige preparo previo de certificado mesmo em ambiente interno ou piloto
- mistura obrigatoriedade de HTTPS com obrigatoriedade de ter certificado pronto no host

## Objetivo

Permitir deploy inicial mais simples sem perder a direcao segura de HTTPS em producao.

## Principios

- HTTPS continua sendo o modo recomendado para producao
- o produto nao deve obrigar certificado manual no primeiro `up`
- a automacao de certificado deve nascer no servidor/deploy, nao na UI, no primeiro corte
- a UI pode orientar, diagnosticar e refletir estado TLS, mas nao deve assumir toda a emissao/renovacao de cert automaticamente logo de inicio

## Direcao recomendada

### Fase 1 - Tornar TLS configuravel no deploy

Adicionar modo de operacao explicito:
- `TLS_MODE=off`
- `TLS_MODE=provided`
- `TLS_MODE=selfsigned`
- futuro:
  - `TLS_MODE=letsencrypt`

Comportamento:
- `off`
  - sobe somente em `80`
  - sem redirect para `443`
  - indicado para:
    - laboratorio
    - rede interna controlada
    - reverse proxy externo ja terminando TLS
- `provided`
  - comportamento atual
  - exige `fullchain.pem` e `privkey.pem`
- `selfsigned`
  - gera certificado autoassinado local
  - sobe `443` com aviso operacional claro
  - indicado para:
    - POC
    - ambiente interno
    - bootstrap inicial

### Fase 2 - Automacao assistida no servidor

Adicionar script operacional para TLS:
- `scripts/deploy/configure-tls.sh`

Capacidades desejadas:
- gerar self-signed
- validar certificado manual existente
- opcionalmente preparar fluxo de Let’s Encrypt

Importante:
- o fluxo Let’s Encrypt deve ser tratado como operacao de servidor
- depende de:
  - DNS valido
  - porta 80 publica
  - dominio correto
- por isso nao deve nascer como botao “magico” na UI

### Fase 3 - Observabilidade e UX na plataforma

A UI pode expor:
- estado atual do acesso web:
  - `HTTP`
  - `HTTPS manual`
  - `HTTPS self-signed`
  - `HTTPS automatico`
- validade e expiracao do certificado
- origem:
  - manual
  - self-signed
  - letsencrypt
- alertas:
  - expirando
  - invalido
  - ausente

Mas sem assumir no primeiro corte:
- emissao ACME completa dentro da UI
- upload de certificado diretamente para o banco
- escrita de arquivos sensiveis pelo browser no host

## O que nao recomendo como primeiro corte

### Certbot / Let’s Encrypt controlado direto pela UI

Nao e o melhor primeiro passo porque:
- exige acesso ao filesystem do host
- exige DNS/porta 80 corretos
- exige renovacao recorrente
- cria superficie operacional e de seguranca maior

Faz mais sentido:
- script de servidor
- runbook claro
- UI apenas refletindo status

### Upload de certificado para dentro da plataforma como fonte primaria

Nao recomendo no primeiro corte porque:
- aumenta responsabilidade do app sobre material privado de TLS
- exige escrita confiavel em volume compartilhado
- adiciona risco de segredo sensivel fora do fluxo natural do host

Se um dia entrar:
- deve usar storage/volume seguro
- audit trail
- validacao forte
- permissao estrita de admin

## Solucao de menor risco

### Deploy sem certificado obrigatorio

Implementar:
- `TLS_MODE=off|provided|selfsigned`
- dois templates/configs Nginx:
  - `nginx.http.conf`
  - `nginx.https.conf`
- `install-nodeaccess.sh` e `update-nodeaccess.sh` passam a:
  - validar certs apenas quando `TLS_MODE=provided`
  - gerar self-signed quando `TLS_MODE=selfsigned`
  - pular check de certs quando `TLS_MODE=off`

### Self-signed assistido

Adicionar script:
- `scripts/deploy/generate-self-signed-cert.sh`

Comportamento:
- gera `fullchain.pem` e `privkey.pem` locais
- usa `openssl`
- inclui `CN` e SAN basicos a partir de `APP_URL`

## Regras de produto e seguranca

- em producao exposta a internet, `TLS_MODE=off` deve gerar alerta forte em `doctor`
- `selfsigned` deve ser aceito como bootstrap, mas com aviso operacional claro
- `provided` continua sendo o padrao recomendado para producao controlada
- Let’s Encrypt automatico so deve entrar quando houver fluxo robusto de renovacao

## Impacto esperado

### UX operacional

- reduz atrito de primeira instalacao
- torna PoC e ambiente interno muito mais simples
- evita bloquear deploy por ausencia inicial de certificado

### Seguranca

- mantem HTTPS como direcao recomendada
- nao desloca material privado de TLS para dentro do app sem necessidade
- evita automacao ACME prematura e frágil

## Backlog tecnico sugerido

1. `TLS_MODE` no `.env.example.prod`
2. split de configuracao Nginx por modo
3. `generate-self-signed-cert.sh`
4. ajustar `install-nodeaccess.sh`
5. ajustar `update-nodeaccess.sh`
6. ajustar `doctor-nodeaccess.sh`
7. expor status TLS na UI/admin
8. avaliar `configure-tls.sh` com suporte assistido a Let’s Encrypt

## Decisao recomendada

O caminho certo agora e:
- remover a obrigatoriedade operacional do certificado
- suportar `HTTP`, `HTTPS manual` e `HTTPS self-signed`
- deixar Let’s Encrypt como automacao de servidor em fase posterior
- usar a UI primeiro para diagnostico e orientacao, nao para emissao/gestao completa
