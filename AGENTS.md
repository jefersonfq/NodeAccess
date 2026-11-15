# NodeAccess

Plataforma web de acesso SSH via navegador (segurança, usabilidade, performance,
manutenção simples). Use contexto mínimo: leia só o necessário e pare quando bastar.

Versão enxuta desde 2026-11-08. Backup e reversão: `ai/backup/codex-config-2026-11-08/ROLLBACK.md`.

## Ordem de leitura

1. `ai/context.md` → 2. `ai/patterns.md`
3. `docs/PRD-lite.md` só se precisar de regra de produto
4. Um único `ai/modules/*` do domínio tocado
5. `ai/frontend-guidelines.md` só se tocar UI/UX, terminal, SSH/WebSocket ou auth
6. `ai/debug.md` só para investigação; `docs/PRD.txt` só para regra não coberta no lite
7. Lifecycle de mudança: `codex/skills/nodeaccess-change-lifecycle/SKILL.md` e apenas a referência do estado atual

## Economia de contexto (obrigatório)

- Uma thread por assunto/Change ID. Ao retomar, ler o resumo de `implementation.md` e o `plan.md`; não reler histórico inteiro.
- Não reler arquivo que não mudou na mesma thread; não abrir diretórios inteiros nem arquivos grandes sem motivo.
- Limitar saída: `rg -m`/`| head`, `sed -n` com faixa curta, `tail -n 40` em logs, `git diff --stat` antes do diff completo. Testes: mostrar resumo e falhas, não o log inteiro.
- `package.json` tem ~160 scripts: buscar com `rg -n '"<nome>' package.json` em vez de ler o arquivo.
- Leituras (`cat`, `rg`, `sed -n`, `tail`, `ls`, `git status|diff|log|show`) rodam direto, sem `runuser`/`bash -c` e sem pedir escalação. Use `runuser -u jeferson -- …/bin/dev` só para comandos que gravam, constroem, usam rede ou docker.
- Arquivos temporários, logs e scripts auxiliares em `.tmp/` do workspace (ignorado no git), não em `/tmp`.
- Não repetir resumo do produto; citar caminhos em vez de colar trechos longos.

## Regras de atuação

- Alterações pequenas, controladas e reversíveis; menor mudança que resolva. Escopo ambíguo → menor escopo razoável.
- Não refatorar amplamente nem introduzir dependências sem pedido/justificativa objetiva.
- Não alterar autenticação, autorização, sessão, websocket ou fluxo crítico sem necessidade clara; explicitar risco de efeito colateral antes de mudança ampla.
- Debug: causa provável → validar fluxo → correção; não começar por refatoração.
- Respostas técnicas, objetivas; priorizar causa, impacto, correção e arquivos afetados. Em UI, informar impacto em UX, estados afetados, risco e como validar.
- Terminal: mudança que possa alterar a área útil exige `npm run test:terminal-experience:web`; resize, WebSocket ou transporte SSH exigem também `npm run test:terminal-pty:real` contra host descartável (opt-in, sem latência no fluxo normal).

## Manual de uso

Ao alterar fluxos mapeados em `docs/manual/manifest.json`, aplicar `.agents/skills/nodeaccess-manual/SKILL.md` (procedimentos, capturas, evidências). Revisão editorial só após validação; mudanças sem impacto no procedimento registram a revalidação do capítulo.

## Registro das implementações assistidas por IA

A partir de NA-0055, manter `implementation.md` junto ao `plan.md` da frente, a partir de
`codex/skills/nodeaccess-change-lifecycle/assets/implementation.template.md`.
Antes de encerrar cada interação relevante, registrar data/hora com timezone, pedido/decisão,
o que foi feito, arquivos/fluxos afetados, validações realmente executadas, limitações e
próximo passo (incluindo perguntas que mudem decisões). Atualizar o resumo em vez de copiar
transcrições; manter o diário enxuto (consolidar entradas antigas). Sem segredos, dados
pessoais ou saída de terminal do usuário; não inventar testes, aprovação ou métricas.
SHA base no documento; SHA final/checks no PR/tag/evidência. Recuperação:
`docs/DEVELOPMENT-recovery.md`. Nenhuma instrução autoriza commit/publicação fora do escopo
já autorizado pelo usuário.

## Destino dos documentos

PRDs e documentação: `/home/jeferson/projects/NodeAccess-current/docs/`; planos e registros em
`docs/changes/<ano>/<mes>/<ChangeID>/`. Em worktree isolado, sincronizar só os documentos da
frente com a pasta canônica (sem código, sem afirmar testes no checkout principal), atualizar
índices e entregar links do projeto atual; nunca deixar documentos só em `/tmp`.

## Planejamento vivo — metas 2027

Manter `docs/planejamento/METAS e OBJETVIVOS Nodeaccess 2027.xlsx` (aba `Roadmap 2027`, por ID
estável; decisão na aba `Revisões`) atualizado com ideias, funcionalidades, mudanças de escopo,
cancelamentos e estado de entrega. Para economizar, agrupar em **uma única escrita por
interação** que tenha mudado algo do roadmap (não a cada item). Preservar `Original 2027`, IDs
e edições do usuário; distinguir ideia, piloto, código, validação local, homologação e
publicação; não inventar prazos, responsáveis ou prioridades. Se não puder editar/validar,
registrar pendência no `implementation.md` e avisar. Em worktree, sincronizar com a planilha canônica.

## Validação SonarQube

Toda alteração de código registra `npm run validate:sonar` (servidor local, tokens separados;
ver `docs/OPERATIONS-sonarqube.md`) junto aos testes aplicáveis antes de considerar a frente
pronta. Falha de testes/cobertura é falha mesmo com gate verde; servidor/token ausente ou
relatório incompleto é bloqueio, não aprovação. Não excluir código/regras nem reduzir
thresholds. Atualizar tabela e evidência por achado em `docs/sonarqube`; mudança na baseline
exige justificativa individual e revisão independente. CI remoto não alcança o localhost do WSL.
