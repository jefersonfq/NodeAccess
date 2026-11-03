# NA-0129 — Registro da implementação

## Pedido e objetivo
Corrigir falha do build upgrade-restore da PR59 sem relaxar segurança.

## Implementação
Base SHA8dae9b49a8dab89b9c0a7c4fcb4a29a1d401662d; worktree /tmp/nodeaccess-NA-0129. Plano anterior à edição.

## Validação
Planned: índice APK, build, runtime, guards e scanner de imagem.

## Recuperação
Reverter commit; sem dados ou VPS afetados.

## Pendências
Validação e revisão; raiz consolida roadmap/índices/PR.

## Diário de interações

### 2026-11-03T19:05:36-03:00 — Início autorizado
FalhaCI confirma pacote disponível3.32.2-r0. Página Alpine cacheada mostra3.32.1-r0; verificar índice assinado antes da mudança.

### 2026-11-03T19:07:00-03:00 — Metadados e contratos
Ran: imagem Alpine pelo digest original, apk update com verificação de assinatura padrão e apk policy mostram freerdp-dev e freerdp-libs3.32.2-r0 em https://dl-4.alpinelinux.org/alpine/v3.24/community. Página https://pkgs.alpinelinux.org/package/v3.24/community/x86_64/freerdp-dev ainda cacheada3.32.1-r0; não usada como prova da versão atual. Alterado apenas pin no Dockerfile e versão README. Checksums Apache/backport/ALSA e digest Alpine intactos. Ran:7 testes policy e34 testes adapter/gateway/decoder gráficos PASS (/tmp/na0129-policy.log e /tmp/na0129-graphical.log). Build real em andamento; não há evidência de sessão Windows/NLA nesta frente.

### 2026-11-03T19:14:00-03:00 — Cache runtime detectado no ensaio
Primeiro build PASS, porém smoke falhou corretamente: /lib/apk/db/installed ainda registrava freerdp-libs3.32.1-r0. Camada final foi reutilizada pois DEPENDENCIES contém SONAMEs e artefatos copiados permaneceram idênticos. Correção necessária: pin explícito freerdp-libs3.32.2-r0 no estágio runtime; contrato de guarda exige igualdade das revisões build/runtime. Primeiro smoke usou apk info -v, que nesta versão retorna descrição e tenta índice; ajustado harness para ler banco instalado local sem rede. Build e scanner serão repetidos; primeiro scanner da imagem antiga não é evidência final.

### 2026-11-03T19:18:19-03:00 — Build final e runtime
Ran: segundo build PASS (/tmp/na0129-build-final.log), imagem sha256:375eaf924e162caab1a682d53eddc0d4cd58cafc2e73512919a91144a1f4bf18. Smoke real em container descartável --network none confirmou banco APK instalado freerdp-libs3.32.2-r0, guacd1.6.0, UID1000 e resposta args aos selects RDP/VNC. Container removido no finally. Evidência /tmp/na0129-runtime.json e harness /tmp/na0129-runtime.py. Isso prova carregamento/negociação inicial de plugins, não sessão Windows/NLA, áudio ou impressão.
Ran:8 testes policy PASS,34 testes gráficos PASS, ESLint focal PASS; revisão independente tooling do delta runtime PASS e5 guardas guacd reproduzidas. Primeiro scanner da imagem antiga atingiu timeout300s, não é contado como prova final; referência original restaurada no finally. Scanner final iniciado sem mudar política, limite ou scanner por digest.

### 2026-11-03T19:22:55-03:00 — Scanner bloqueia GLib
Ran: scanner final da375eaf FAIL por CVE-2026-58016 em glib2.88.1-r1 (Critical);3 High correspondem às triagens exatas existentes. Base Grype2026-11-03 válida. Tag anteriorcc59 restaurada. Root autorizou experimento isolado de APKoficialglib2.90.0-r0, semrepositórioedgeglobal e semexceção scanner. APKBUILD Alpine3.24 não traz backport; Debian tracker referencia GNOMEMR5156 em2.89.0. Verificar fonte e ABI antes concluir.

### 2026-11-03T19:25:21-03:00 — Correção GLib validada
Ran: APKoficialglib2.90.0-r0 SHA256b5d0ad79a8e73c3e0f8e9749fbb407bb4f2bf089cdaceffbff9fed25edc33dd0; simulaçãoAPK atualiza apenas glib (/tmp/na0129-glib-simulate.log). Fonte GNOME tag2.90.0 gio/gdbusintrospection.c contém guarda stack->next corrigida pelo MR5156 (https://gitlab.gnome.org/GNOME/glib/-/merge_requests/5156). Instalado com assinaturaAPKnormal, nenhum repositórioedge adicionado, política e checksums anteriores intactos.
Ran: build final PASS (/tmp/na0129-build-glib.log), runtimeFreeRDP3.32.2-r0/glib2.90.0-r0/guacd1.6.0/UID1000 e handshake argsRDP/VNCPASS (/tmp/na0129-runtime-final.json). ldd de guacd, clientes e plugins FreeRDP PASS (/tmp/na0129-native-deps.log). Prova C compilada contraheadersGLib2.88 do buildstage, executada no runtime2.90 semrede: quatroXMLmalformados do testeupstream rejeitados com erroesperado, XMLválido aceito (/tmp/na0129-native/glib-regression.c, /tmp/na0129-glib-native.log). Isso prova esses caminhos e compatibilidade ABI necessária, não universal.
Ran: scanner original por digest PASS (/tmp/na0129-scan-glib.log), imagem28608bed3b7657ffa0632fbd0ba2ee48d84dcc89606c1281dcf3793fcec54c72;0Critical,3High somentetriagens exatas jáexistentes,19Medium,3Low. DB2026-11-03 válida. Resumo sanitizado validation.json; raw em artifacts/security/images no worktree. Tag originalcc59 restaurada pelo finally e containers descartáveis removidos.
Limites: misturar APKs específicos ALSA/GLib de edge exige repetir ABI/scanner em rebuild; arquiteturaamd64; sem prova Windows/NLA, áudio/impressão nemVPS. Publicação/CIintegrada, roadmap e índices pela raiz.

### 2026-11-03T19:26:05-03:00 — Revisão independente
Tooling retornou PASS_WITH_WARNINGS após inspecionar deltaGLib, simulação, evidênciasnativas e scanner resumido. Reproduziu5guardasguacd; não repetiu build/scanner/native, atribuídos ao autor. Raiz leu Dockerfile/README e concordou com escopo. Hospedado upgrade-restore completo continua pendente; smoke não substitui jornada usuário fim a fim.
