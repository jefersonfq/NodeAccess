---
change_id: NA-0205
title: Clareza e interação do popup VaultNAccess
type: improvement
status: in-development
base_sha: 0ff5c1f9a8cf87c2b4715728ef7d91f96c37cf6e
branch: feature/NA-0205-20261126-extension-ux
risk: medium
---

# NA-0205 — UX do popup

## Aprovação e objetivo

Usuário pediu botões Novo secret/Importar PEM inequívocos, transições discretas, revisão de poluição visual e fluxos Playwright, avaliação de painel lateral e X/fechar ao clicar fora. Após explicação da diferença, escolheu manter popup com fechamento externo. Escopo aprovado; GO_WITH_RISKS.

## Escopo e critérios

- Botões de criação/importação semanticamente iguais, visualmente reconhecíveis, estados hover/active/focus/disabled claros; PT/EN.
- Mais espaço útil sem ultrapassar limite de popup, corte horizontal ou hierarquia confusa; teclado e tema claro/escuro.
- Transições breves de controles e conteúdo não sensível, respeitando prefers-reduced-motion. Nunca atrasar retirada de segredo, lock ou permissão revogada.
- X acessível fecha popup. Fechamento nativo ao clicar fora verificado com action popup real e mudança para outra janela do SO. Não adicionar blur indiscriminado que interrompa importação PEM ou confirmação no portal.
- Painel lateral avaliado e descartado por preferência explícita nesta interação; manifesto e permissões preservados.
- Não mudar autenticação, ACL, entrega de segredos, captura/preenchimento ou persistir rascunhos sensíveis.

## Isolamento

Frente NA-0204 anterior está dirty e preservada no checkout principal. Código novo em /home/jeferson/na-0205, baseado no mesmo SHA da extensão vigente. Não copiar código entre frentes nem criar commit/publicação sem autorização. Sincronizar somente documentos desta frente e atualização única do roadmap canônico.

## Validação

Baseline testes de popup/editor e browser real existente; screenshot antes/depois; Playwright cenários clique/criação/importação/cancelar/X/foco externo, teclado, claro/escuro, movimento reduzido, clipping. Tipos/lint, regressão de sites/adoção quando pertinente. Manual mapeado: skill nodeaccess-manual, evidências após validação. validate:sonar com tokens locais; falha/bloqueio permanece explícito. Revisão independente se disponível; indisponibilidade não equivale a aprovação.

## Riscos e rollback

Perder foco pode fechar popup e descartar formulário: preservar comportamento nativo, não acrescentar auto-close em janelas de revisão com retorno Hello. Não animar remoção de dados sensíveis. Reverter somente UI/adaptador de fechamento, sem migração ou dados alterados. Homologação Windows real separada do Xvfb/Linux.

## Integração local autorizada — 2026-11-26

Usuário pediu manter a atualização da extensão na pasta padrão do projeto. Autorizada integração local dos cinco arquivos da NA-0205 ao checkout canônico, preservando byte a byte os demais arquivos da NA-0204 antes de atualizar documentação compartilhada. Sem commit/merge/publicação. npm run dev permanece inalterado; build:extension:local usa as fontes canônicas e gera apps/extension/dist-local com mesma manifestKey/origem, preservando identidade da extensão. Manual combinado será revalidado, sem copiar hashes/capturas do worktree sobre NA-0204. Validação Sonar anterior permanece FAIL até nova execução; integração local não significa release aprovado.
