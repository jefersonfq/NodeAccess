# NA-0050 — Evidências e operação local

## Resultado operacional

- Workspace: `/home/jeferson/projects/NodeAccess-current`.
- MySQL: 8.0.45 → 8.4.12; Redis: 7.4.8 → 8.2.10, ambos saudáveis.
- Projeto Compose `nodeaccess`, volumes originais `nodeaccess_mysql_data` e
  `nodeaccess_redis_data`; binds de MySQL/Redis agora somente em 127.0.0.1.
- Guacd 1.5.5 preservado; IDs e início dos containers dos outros projetos conferidos.
- Backup privado: `backups/NA-0050-pre-upgrade/`, arquivos 0600/diretório 0700,
  incluindo configurações, dados locais, inspeções de containers, dump e volumes frios.
- Dump restaurado em MySQL 8.4 isolado: 98 tabelas, 41.238 registros e digest dos dados
  idênticos. Mesma paridade conferida no MySQL atualizado antes de iniciar aplicação.
- Cópias físicas restauradas em volumes descartáveis nas imagens antigas, com
  verificação de dados; cópia Redis também migrada para 8.2.10 e comparada por tipo.
- O primeiro comparador Redis foi corrigido após rejeição no ensaio de retorno;
  os relatórios finais substituem a comparação inicial inválida.
- `npm run dev` executado como jeferson com Node 24.21.0/npm 11.12.1:
  API 3000 e gateway 3001 com readiness 200; frontend 5173 com HTTP 200.
- Prisma: todas as 146 migrations aplicadas.

## Scripts revisados e corrigidos

- Revisão de `scripts/`: caminhos pessoais antigos ausentes; raiz da release
  derivada da localização do script, compatível com a pasta Linux.
- `docker-compose.yml`: nome estável do projeto evita instalação paralela ao mudar pasta.
- `build-release.sh`: versões atuais já estavam selecionadas; corrigidas substituições
  dos nomes opcionais de imagens backend/frontend/MySQL/Redis/guacd no pacote.
- `prepare-agents.mjs`: Linux/WSL orienta importação de artefatos Windows assinados,
  pois npm.cmd não funciona em cwd UNC e chaves com path Linux não são paths Windows.
- Testes de proveniência geram chaves descartáveis, preservando exigência real de assinatura.

## Validação

| Classificação | Check | Resultado |
|---|---|---|
| Ran | Backup lógico/físico, checksum e restauração isolada | Paridade comprovada |
| Ran | Atualização MySQL/Redis e preservação de guacd/outros containers | Passou |
| Ran | Guards de upgrade/downgrade, Prisma, assinatura e proveniência | Passou |
| Ran | Empacotamento com fixtures assinadas, cwd externo e espaços no path | Passou |
| Ran | Overrides de imagens e rejeição de manifesto adulterado antes de empacotar | Passou |
| Ran | 12 testes de scripts/artefatos + 12 testes de governança/status | Passaram |
| Ran | Sintaxe dos 65 scripts shell/JavaScript em scripts/ | Passou |
| Ran | Migrations e readiness API/gateway/frontend | Passou |
| Skipped | Build de imagens e release comercial completa | Faltam agentes Windows assinados/chaves de publicação; nenhum bypass |
| Skipped | Nova suíte completa de aplicação e teste de resize/PTY | Sem mudança em aplicação, interface, WebSocket ou transporte SSH |
| Manual | Homologação de login e sessão SSH no navegador pelo usuário | Não inferida dos checks técnicos |

Relatórios privados: `/home/jeferson/nodeaccess-workspace/reports/NA-0050/`.
`validation.json` identifica SHA, diff e resultados; `restore.json`, `upgrade.json`
e `rollback-rehearsal.json` registram as operações anteriores ao commit.
Os checks finais do commit e a revisão independente ficam nos relatórios externos
para não criar um novo SHA apenas para registrar o SHA testado.

## Como desenvolver

```bash
cd /home/jeferson/projects/NodeAccess-current
npm run dev
```

Os containers têm política de reinício e já estão em execução. Se precisar
iniciá-los novamente, com Docker ativo no WSL:

```bash
cd /home/jeferson/projects/NodeAccess-current
sudo docker compose up -d --no-deps mysql redis
```

O usuário jeferson precisa de sudo para Docker. Nenhuma permissão de grupo foi
alterada. Node/npm da toolchain Linux também podem ser usados explicitamente:
`/home/jeferson/nodeaccess-workspace/bin/dev npm run dev`.
Scripts de backup devem ser executados na raiz do projeto ou receber
`ENV_FILE`/`COMPOSE_FILE` absolutos.

## Preparar uma release futuramente

Usar Node 24 e as imagens fixadas. Gerar o agente Windows assinado em checkout
Windows com os mesmos fontes e package-lock.json; importar pelo caminho Linux
`AGENT_WINDOWS_ARTIFACTS_DIR` ou pela release `AGENT_WINDOWS_RELEASE_REPO`.
Fornecer `NODEACCESS_RELEASE_PUBLIC_KEY` para validar e
`NODEACCESS_RELEASE_SIGNING_KEY` para gerar artefatos Linux/macOS, mantendo as
chaves fora do Git. O build Windows exige também identidade Authenticode.
Conferir com `node scripts/release/prepare-agents.mjs --check` antes do pacote.
Ao usar sudo para Docker/build, disponibilizar explicitamente a toolchain e
essas variáveis de caminho no ambiente do processo privilegiado.

O teste usa binários fictícios e chaves descartáveis: comprova empacotamento,
caminhos e gates, não produz release distribuível. Não foi gerada nem publicada
release real nesta mudança. Não usar NODEACCESS_DEVELOPMENT_UNSIGNED para publicação.

## Recuperação

O backup representa o estado anterior à atualização. Restaurá-lo depois de novas
edições descarta os dados posteriores; nesse caso, fazer backup do estado atual
e planejar a recuperação antes de trocar volumes.

1. Parar a aplicação dev e somente MySQL/Redis do NodeAccess.
2. Conferir checksums do `manifest.json` privado e preservar os volumes atuais.
3. Criar novos volumes vazios; extrair `mysql-volume.tar.gz` e `redis-volume.tar.gz`
   neles, preservando UIDs/GIDs. Esse processo foi ensaiado sem portas de rede.
4. Usar os IDs das imagens antigas em `containers.private.json`/`manifest.json` e
   as configurações `.env` preservadas. Manter PEM_ENCRYPTION_KEY e dados de runtime.
5. Apontar um Compose de recuperação para os novos volumes e imagens antigas,
   validar versões, dados e readiness antes de iniciar dev.

Nunca iniciar MySQL 8.0 sobre o volume já convertido para 8.4. A cópia física
anterior ou uma restauração lógica separada é necessária. Referência oficial:
https://dev.mysql.com/doc/refman/8.4/en/downgrading.html

## Entrega Git

Branch `fix/NA-0050-20261009-wsl-dev-stack`, base local
`9be2f73ac28f5af8678c56849f704185ab9059a0`. Visível na pasta Linux atual.
Publicação/PR/merge/sincronização da master continuam pendentes de autenticação
no GitHub. Não houve alteração na produção.
