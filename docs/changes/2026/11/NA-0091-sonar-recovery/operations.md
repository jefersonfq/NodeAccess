# Recuperação e renovação SonarQube — NA-0091

## Contrato operacional

Scripts em `tools/sonarqube/`. Somente instância local `http://127.0.0.1:9000`, projeto `nodeaccess` e containers com labels Compose `nodeaccess-sonarqube`. Não usa a VPS nem executa scanner. Runtime privado `/home/jeferson/services/sonarqube`; nenhum segredo deve ser passado na linha de comando ou copiado ao Git.

Com Node24, executar `node tools/sonarqube/recovery.mjs backup` cria backup privado de PostgreSQL custom, extensões, Compose, `.env`, credenciais e snapshot lógico. `verify <backup>` valida conjunto exato de arquivos, SHA256, proprietário, permissões e ausência de links simbólicos. O manifest contém nomes/checksums/contagens/imagens imutáveis, sem valores de credenciais. O backup inteiro é sensível: não publicar, anexar ao PR ou transportar sem proteção equivalente.

`rehearse <backup>` restaura em volumes novos, imagens locais fixadas pelo ID e rede bridge exclusiva. PostgreSQL não publica porta; Sonar publica apenas `127.0.0.1` com porta dinâmica. Elasticsearch inicia sem índices anteriores e reindexa o banco restaurado. O ensaio compara projeto, visibilidade, análises/revisões, issues abertas, hotspots e permissões globais/do projeto. Todos os recursos são rotulados e removidos no `finally`; originais não são montados nem removidos. A rede bridge permite saída; ela não é um sandbox contra código malicioso em plugins. Somente backups confiáveis da própria instância devem ser restaurados. Imagens devem estar disponíveis localmente; o script não faz pull.

Pré-requisito temporário do kernel: `vm.max_map_count >= 524288`; o ensaio verifica e falha se insuficiente. Não instala configuração persistente nem altera o kernel.

## Tokens

`node tools/sonarqube/token-maintenance.mjs check` valida ambos os tokens sem imprimir valores. Analysis token precisa acessar cache de análise do projeto, mas não navegação/administração. Review token precisa navegar no projeto, mas não analisar/administração. `/api/system/info` e `/api/permissions/users` devem retornar 403 para ambos. O token de revisão herda o escopo do usuário dedicado existente; nenhum usuário ou permissão é ampliado.

`rotate` gera novos tokens com expiração em 30 dias, confirma tipo/data na API e testa escopos. Só então publica `credentials.json` de forma atômica em 0600, preservando UID/GID. Os antigos têm uma janela planejada de sobreposição de 48 h, limitada à validade original; metadados de revogação e cópia privada anterior permitem recuperação. Falha antes da publicação revoga apenas nomes recém-gerados e mantém o arquivo anterior; se a limpeza falhar, cria registro privado `rotation-cleanup-*` para intervenção.

`retire` só revoga tokens vencidos no período de sobreposição após verificar novamente os tokens atuais e confirmar ausência de análise pendente/em execução. Confirma a remoção pela API. Não revoga token atual, nome fora do namespace ou usuário diferente do esperado. CLI não recebe tokens por argumento.

Não iniciar rotação manual concorrente a uma análise. O bloqueio local impede duas rotações simultâneas; a checagem CE protege análises já pendentes/em execução, mas não é um mutex distribuído com scanners que começarem depois. A sobreposição de 48 h absorve essa janela. Em falha/reboot que deixe arquivo `.lock`, verificar ausência de processo correspondente antes de removê-lo manualmente; não há remoção automática de lock presumidamente obsoleto.

## Agendamento e recuperação

`node tools/sonarqube/install-maintenance.mjs` como root instala release imutável de scripts e Node em `/usr/local/lib/nodeaccess-sonarqube-maintenance/release-*` (root 0700), com cron root `/etc/cron.d/nodeaccess-sonarqube-maintenance`. Não executa código de diretórios graváveis por usuário com privilégios root. Cron aponta o release completo somente após sua gravação. Releases anteriores são preservados para rollback; instalador não apaga outros arquivos.

Agenda instalada:03:20 diariamente, timezone do host. Serviço cron e WSL precisam estar ativos; não acorda WSL/Windows. A rotina adia quando há tarefa CE ativa, faz backup, renova quando faltar até 7 dias, retira tokens antigos elegíveis e salva `maintenance-status.json` privado. Falha não é silenciosamente registrada como sucesso; saída do cron é descartada para não expor dados e o status deve ser consultado. Ausência de execução deve ser monitorada externamente pelo operador; não há canal de alerta externo configurado.

Para desativar: remover somente o arquivo cron desta frente. Para reverter versão: reinstalar a versão revisada ou apontar o cron para release anterior conhecido. Não remover volumes originais. Backup válido não expira automaticamente; retenção e cópia externa precisam de política operacional própria. Sem cópia externa, perda do disco WSL pode atingir instância e backup simultaneamente.

## Referências oficiais

- [Backup e restore SonarQube Community](https://docs.sonarsource.com/sonarqube-community-build/server-update-and-maintenance/maintenance/backup-and-restore): suporta hotbackup do banco; restauração demanda reindexação.
- [Reindexação](https://docs.sonarsource.com/sonarqube-community-build/server-update-and-maintenance/maintenance/reindexing).
- [Tokens e expiração](https://docs.sonarsource.com/sonarqube-server/user-guide/managing-tokens): token de análise por projeto e token de usuário herdam escopos diferentes.

Leitura/gravação privilegiada usa diretório aberto com `O_DIRECTORY|O_NOFOLLOW`, arquivo com `O_NOFOLLOW` e `fstat` do mesmo descriptor. Checksum é streaming desse descriptor; dump/restore passa descriptors diretamente ao Docker. Gravações, criação de diretórios e locks ficam ancoradas ao diretório validado por proprietário e modo, mesmo se seu nome mudar durante a operação. A leitura integral de configurações tem limite de 512 MiB; dumps não são carregados integralmente na memória.

A fila CE não representa um scanner ainda preparando/uploadando fontes. Consumidores precisam reler `credentials.json` ao iniciar cada execução; processos com token antigo fixado em variável de ambiente precisam atualizar essa variável antes do fim das 48 h. Não há promessa de interrupção zero para clientes que persistam tokens antigos indefinidamente. O cron não muda variáveis de processos já iniciados.

A instância de origem tem zero hotspots nesta evidência. O ensaio compara status/resolução de todos os registros existentes, mas não pode demonstrar restauração de uma revisão de hotspot inexistente. Não foram criadas revisões fictícias na origem para simular homologação humana.

## Evidências locais concluídas

Em 03/11/2026, o restore real recuperou cinco análises, 295 issues abertas, zero hotspots e permissões globais/do projeto com hash lógico idêntico. A API respondeu 503 durante a reindexação mesmo após status UP; três retries limitados resolveram a indisponibilidade. O clone provou novos tokens, sobreposição e revogação dos dois antigos. Origem preservada e zero recursos de ensaio restantes. Ver [evidência real](evidence/restore-real.json).

A instância original recebeu novos tokens válidos até 03/12/2026. Os dois antigos continuam válidos e ficam elegíveis à revogação em 05/11/2026 às 16:25:44 -03:00; a retirada ocorre na próxima execução apta, não exatamente no fim das 48 horas. O cron diário das 03:20 usa o timezone do host; a primeira execução por relógio ainda é futura. O release instalado foi executado manualmente com sucesso, gerando outro backup, verificando os tokens atuais e preservando ambos os antigos ainda na janela. Nenhum scanner foi executado nesta frente.

As simulações da rotina usam as funções reais de backup/restore/instalação, filesystem privado real e contratos Docker/HTTP modelados. Cobrem falhas de dump, restore, transferência, kernel, bind público, startup, prazo, cancelamento de verificação e cleanup. Não substituem o ensaio PostgreSQL/Sonar real, registrado separadamente. Nenhuma cobertura externa de execução manual é exigida para os testes normais.
