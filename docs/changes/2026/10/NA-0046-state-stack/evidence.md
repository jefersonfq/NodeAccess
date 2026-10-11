# NA-0046 — MySQL e Redis

Imagens locais: `nodeaccess-mysql:8.4.12-1` e `nodeaccess-redis:8.2.10-1`, construídas por `docker/state.Dockerfile` a partir de bases fixadas por digest. A tag mysql:8.4.12 não estava publicada no Docker Hub; foi usado o registro oficial Oracle, com mysqld 8.4.12 confirmado. Bibliotecas do SO atualizadas; mysql-shell removido por não ser necessário para servidor/dump. MySQL executa como UID/GID 999, preservando o proprietário dos volumes do Docker Official MySQL anterior.

## Incompatibilidades encontradas e corrigidas

- Scripts forçavam mysql_native_password. O helper compartilhado usa caching_sha2_password e foi executado contra o banco real. O preflight detecta contas antigas antes de migrar.
- Oracle usa UID 27; o primeiro ensaio falhou ao ler o volume UID 999. A imagem derivada preserva UID 999 e repetiu a migração com sucesso.
- MySQL ignorou a configuração de teste por permissão 0777; arquivo local corrigido e empacotamento já normaliza para 0644. O teste agora exige READ-COMMITTED carregado da configuração montada.
- A imagem Oracle não inclui conf.d automaticamente. Arquivo adicional de inclusão carrega a configuração existente e os overrides HA.
- Backup/restauração de arquivos executa explicitamente como root em containers administrativos temporários para preservar permissões, enquanto o servidor MySQL permanece sem root.

## Testes aprovados

`test:stack:upgrade:real`: banco 8.0.46 novo com todas as migrations, usuário/host/tenant, JSON Unicode, bcrypt e segredo AES-GCM. Upgrade físico para 8.4.12; migrations reaplicadas sem duplicação; contagem de todas as tabelas preservada; valores, relacionamentos, timestamps e descriptografia iguais. Rollback de transação e erros Prisma P2002/P2003 preservados. Dump comprimido restaurado em OUTRO volume 8.4.12 e também em OUTRO volume 8.0.46 para demonstrar retorno sem downgrade do volume atualizado.

Redis: AOF/RDB 7 -> 8.2.10 preserva string Unicode, TTL, hash e sorted set. NX/PX, liberação Lua condicionada ao proprietário e publicação/assinatura aprovados.

`test:ha:mysql-rejoin`: replicação A -> B, fencing de A, promoção de B, escrita em B e retorno de A como réplica preservando dados. `test:stack:guards`: seis cenários aprovados, incluindo recusa de downgrade mesmo com autorização de upgrade e bloqueio de contas mysql_native_password. Sintaxe shell e diff verificados.

Workflow `stack-compatibility.yml` preparado para repetir o ensaio em PRs relevantes; não executado no GitHub nesta etapa. Recursos Docker do ensaio são aleatórios e exclusivos, removidos ao terminar; nenhum volume existente foi utilizado.

## Scan e triagem

Redis: zero Critical/High após atualizar libs; restam 3 Medium de BusyBox (mesmo CVE em três pacotes) e 1 Low de Redis, sem correção indicada pelo scanner. MySQL: zero Critical, 2 High e 9 Medium brutos, todos referentes a variantes FIPS de pacotes Oracle. Não declarar zero achados de imagem.

Os dois High são comparações com RPMs FIPS de epoch 10. A imagem contém openssl-libs 1:3.5.8-1.0.1.el9_8 e gnutls 3.8.10-9.el9_8, sem o sufixo FIPS. As notas oficiais identificam explicitamente a mudança de epoch e as correções nas versões anteriores da linha normal: [OpenSSL](https://linux.oracle.com/errata/ELSA-2026-50075.html), [GnuTLS](https://linux.oracle.com/errata/ELSA-2026-50346.html). A classificação como falso positivo de canal/epoch é uma inferência dessa comparação; preservar dados brutos e não excluir genericamente novos achados. Resumo com versões/avisos em image-scan.json; relatórios integrais em /tmp/nodeaccess-0046-grype-*-final.json.

## Implantação futura

Continuar somente após ensaio com backup da instalação real. A autorização local não executou implantação. O preflight de scripts install/update/rollback bloqueia mudança de série MySQL ou major Redis sem STATEFUL_UPGRADE_APPROVED=true; exige remover contas mysql_native_password na origem e recusa downgrade. Antes da janela, execute o helper configure-mysql-auth.sh pelo container antigo para converter a conta da aplicação, e revise as demais contas com o administrador do banco. Não apagar containers antigos antes do preflight. Instalações com dados mas sem containers e comandos diretos `docker compose up` exigem conferência operacional; o guard protege os scripts oficiais, não toda chamada ao Docker.

Os testes usam dados sintéticos e não substituem a conferência de plugins, tamanhos e credenciais da base real. Guacd intacto. Base de retorno: security/NA-0045-20261008-frontend-build (22daf49).
