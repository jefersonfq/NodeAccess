# Evidências NA-0045 — migração Tailwind 4

Migração local de Tailwind 3.4.19 para 4.3.3, com plugin PostCSS correspondente e lockfile atualizado. A configuração JavaScript existente foi preservada via `@config`; compatibilidade de bordas, placeholder, ring, cursor, dialog e outline evita alterar os padrões visuais sem necessidade.

## Regressão identificada e corrigida

O teste do compartilhamento detectou terminal de 15 px ao abrir detalhes em 1280×720. A classe `xl:grid-cols-[280px,minmax(0,1fr)]` produzia colunas inválidas no Tailwind 4. A separação foi corrigida para underscore. A nova rodada passou nos 60 estados de geometria, permissões de controle, erros, rolagem e recuperação, nos temas claro e escuro. Não houve alteração de protocolo SSH, autorização ou reconexão.

## Validações concluídas em 08/10/2026

- `npm run security:check`: zero vulnerabilidades npm conhecidas em runtime e no conjunto completo, incluindo build. SBOM CycloneDX gerado. Resumo e SHA-256 do lockfile em `npm-summary.json`.
- `npm run security:scan`: Semgrep 728 arquivos, zero achados/erros; Gitleaks 42 fixtures já revisadas, zero ocorrências sem revisão. Escopo e exceções em `security/README.md`; resumo em `scan-summary.json`.
- `npm test`: 214 arquivos aprovados, 10 ignorados; **1.839 testes aprovados e 34 opt-in ignorados**. Estes últimos não são contados como aprovados.
- `npm run typecheck`: shared, backend e frontend aprovados. A primeira execução foi interrompida com código 143; repetição completa terminou com código zero.
- Build frontend aprovado. O build final Vite 7.3.7 levou 42,07 s; continua o aviso preexistente de chunk vendor-ui com aproximadamente 1 MB, sem aumentar o limite para ocultá-lo.
- `test:terminal-experience:web`: aprovado. `test:terminal-pty:real`: top/htop, resize e geometria aprovados contra OpenSSH descartável; relatórios `/tmp/nodeaccess-0045-pty/`.
- `test:session-playback:web`: replay em 1440×1000 e 390×844, exportação CSV/destaques, sem overflow horizontal.
- `test:host-import:resilience:web`: recuperação, prévia, duplicados, preservação de edição e confirmação por teclado aprovados.
- `test:critical-ux-focus:web`: senha e token em desktop/mobile aprovados. Harnesses que dependiam de Chromium ausente foram executados com `PLAYWRIGHT_EXECUTABLE_PATH=/usr/bin/chromium-browser`; a ausência do binário inicial não foi tratada como aprovação.
- `hosts-feedback-ux-playwright.cjs`: oito cenários aprovados (erros/retry, persistência, isolamento entre usuários, teclado e mobile).
- `manual:capture`: cinco capturas regeneradas e inspecionadas, 60 estados do compartilhamento e dois ciclos de tenant sem reconexão. O harness aguarda o toast para não encobrir o título de Hosts. Procedimentos preservados; revisão dos capítulos Terminal/Compartilhamento atualizada somente após validar os fluxos.
- `test:manual`: 18 testes e dois do compilador aprovados; `manual:check-reviewed`: cinco capítulos atuais.
- Comparação SHA-256 dos 1.912 arquivos do manifesto original: zero modificações no workspace original.

Logs desta rodada: `/tmp/nodeaccess-0045-*.log`. Os resumos de segurança e as capturas ficam versionados; logs temporários não substituem a homologação da release.

## Compatibilidade e limites

Tailwind 4 requer navegadores modernos: Safari 16.4+, Chrome 111+ e Firefox 128+, conforme [guia oficial](https://tailwindcss.com/docs/upgrade-guide). A rodada de navegador usou Chromium; Safari/Firefox e a homologação visual humana ainda precisam ser considerados antes da distribuição. Não há promessa de equivalência pixel a pixel.

Auditoria npm zerada não cobre SO/imagens, configuração ou falhas desconhecidas. Permanecem os bloqueios de release registrados em `security/README.md`. Guacd não foi alterado. Não houve acesso à VPS, push, merge em master ou publicação.

## Retorno

Base preservada: `security/NA-0044-20261008-security-gates`, commit `b95bd85`. Trabalho desta etapa em `security/NA-0045-20261008-frontend-build`, worktree `/tmp/nodeaccess-security-local`. Para comparar ou testar a base, abra outra worktree; não faça reset sobre o diretório original com alterações não commitadas.
