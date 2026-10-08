---
name: nodeaccess-manual
description: Atualizar e validar o manual de uso do NodeAccess quando mudarem Hosts, terminal, compartilhamento, SFTP ou troca de tenant; manter capturas, exemplos, permissões e versão alinhados ao produto.
---

# Manual NodeAccess

A fonte de conteúdo é `docs/manual/*.md`; `manifest.json` relaciona cada capítulo aos arquivos do produto. A interface consome essa fonte pelo plugin em `tools/manual/build.cjs`. Não criar uma segunda explicação para uma ajuda contextual já coberta pelo manual.

Ao alterar um fluxo mapeado:
1. Leia apenas o capítulo afetado e o diff do fluxo. Confirme o comportamento observando a tela e os testes correspondentes.
2. Atualize objetivo, pré-requisitos, procedimento, resultado esperado e recuperação de erros. Diferencie permissões de operador, administrador, proprietário e participante. Não apresente hipótese ou comportamento ainda não validado como entrega.
3. Execute `npm run manual:capture` com frontend local e a versão esperada configurada. A rotina valida manual, compartilhamento e troca de tenant e somente depois copia as cinco capturas demonstrativas para `apps/frontend/public/manual-assets`. Revise as imagens, incluindo legibilidade e enquadramento. Não capturar produção nem credenciais reais.
4. Execute `npm run test:manual` e a regressão exigida pelo domínio. Mudanças que afetem área útil do terminal exigem `npm run test:terminal-experience:web`; resize/transporte exige também o ensaio PTY real descrito no AGENTS.md.
5. Após revisão de texto e evidências, atualize `reviewedAt` e `reviewedSourceHash` no manifesto com o hash calculado por `loadManual()`; registre as verificações em `docs/OPERATIONS-manual-pilot.md`. Não avançar esses campos só para fazer um gate passar.
6. Execute `npm run manual:check-reviewed`. Informe o que mudou, testes feitos e limitações. Publicação externa segue a autorização da tarefa; não é concedida por esta skill.

A versão é injetada no build por `VITE_APP_VERSION` (Docker: `APP_VERSION`) e aparece em `/manual` e `manual-version.json`. Nunca fixar o número no texto nem substituir a data de revisão editorial pela data do build. Builds locais sem versão explícita mostram `dev`.

Manual e ícones só aparecem quando o administrador habilita o piloto no tenant. O padrão é desligado. Preserve a ajuda anterior como fallback fora do piloto. Abrir ajuda do terminal deve manter a sessão original, sem foco forçado, resize remoto ou nova conexão SSH.

Imagens devem representar a interface real; diagramas conceituais podem ser SVG. Mantenha legendas, texto alternativo, uso por teclado, contraste, telas menores e movimento reduzido. O conteúdo deste piloto é em português; a interface informa isso em outros idiomas.
