# NA0153 — Validação local

Base30e7f5e7925c10a48865c18fa7c6e93fef1ffa11, worktreeisolado, Node24.22.1. Código final e testes serão associados aoSHA no checkpoint/governança.

- Baseline real: /tmp/NA0153-baseline-restore.log, exit0. Dump sintético próprio, checksum real e três tabelas1linha.
- Contratos: node --test tools/shared/linear-harness-text.test.mjs tools/deploy/restore-mysql-env.test.mjs;13PASS /tmp/NA0153-unit-final.log.1728diferenciaisdata,81padding;500knegativo bounded3s; arquivo0600, foreignUID, symlink/nonempty/umask, preflightcontainers/redes/volumes, startupfalha/cleanup.
- Restore real final: evidence/restore-real.json; antiga credencial rejeitada, nova autenticada via stdin sem secretargvhost; nenhuma senha emlog; dados sintéticos restaurados; recursos próprios removidos. Não usaVPS, backup real ou volumes de usuário.
- Browser real com FRONTEND_BASE=http://127.0.0.1:5299 e PLAYWRIGHT_EXECUTABLE_PATH apontandoChromium1234 instalado: recent-host-access-playwright completoPASS; reportjson e2capturas desktop/mobile.1248ausente nohost foi diagnosticado antesexecução. API inteiramente mock; nenhuma alteração appVue. Tooltip legível emambas resoluções; não declarar homologação global da tela ou reproduzirbackend.
- Revisão backend11PASS_WITH_WARNINGS e leitura de traps/helpers; não repetiuDocker/browser. Limites: administradorDocker/mismoUID pode lersegredos; preflightnãoélock contraadminconcorrente; cleanupDocker best-effort; modoPOSIX validadoLinux/WSL, nãoACLWindows.
- Script de restore de produção mantido: dentrocontainer, mysql expande senha emargv; risco explicitado, fora mudança de arquitetura. Hostargv contém apenas referência literal aenv, não ovalor.
- Sem Sonar ou hostedCI nesta frente; baseline/Gitleaks inalterados. Resoluções3IDs são propostas pendentes de scanner integrado.

Final após chave PEM efêmera:13/13contratos PASS, restore real novamentePASS, ESLint6arquivos0problemas e bash-n/diffcheck PASS. A chave PEM é apenas validada em formato pelo script de produção; não há decriptação de conteúdo do backup neste ensaio. Prova de autenticação real abrange root; pares usuário/root e unicidade são validados nos contratos de ambiente. Nenhum segredo literal novo ou waiver foi adicionado.

Último delta de ancestrais:15/15contratos PASS e15/15reproduzidos independentemente (/tmp/NA0153-independent-final.log), semskipUID. Restore real repetido nafontefinalguardada PASS; logs /tmp/NA0153-real-final.log e evidence/restore-real.json. Parent0777nonsticky/foreignUID não podem renomear/substituirworkspaceaceito; TOCTOU mesmoUID/adminpermaneceforaameaça. Comparação automatizada de log cobre senhasMySQL; nãoexposição de chavePEM confirmada porleitura dos consumidores, não por recuperação de segredo apóscleanup.
