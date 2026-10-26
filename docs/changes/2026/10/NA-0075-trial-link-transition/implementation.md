# NA-0075 — Registro da implementação

## Pedido e objetivo
Adicionar transição ao carregar o trial pelo site.

## Implementação
Base SHA419056f42fb550ceca4401421dc4c2717adfc6d5. Alteração limitada aos assets do CTA; sem mudanças no aplicativo.

## Validação
Ran: contexto, workspace limpo e inspeção do CTA. Planned: navegador e revisão independente; publicação com backup/CAS.

## Recuperação
Preservar assets atuais antes de publicar; rollback restrito a esses arquivos.

## Pendências
Publicação dos dois assets e validação pública.

## Diário de interações

### 2026-10-26T08:58:03-03:00 — Pedido de transição
Usuário solicitou efeito ao abrir o trial. Assumida transição discreta com feedback, acessibilidade e navegação normal preservadas; leitura do site atual somente leitura em andamento.

### 2026-10-26T09:05:19-03:00 — Implementação validada

Ran: node --check, diff --check e4cenários browser (390/1440, movimento reduzido, rAF suspenso), Enter, navegação única, voltar/pageshow, Ctrl/Meta/Shift/Alt/middle, targetblank/download e href sem JS. Revisão independente GO com rerun e captura mobile inspecionada. Corrigido fallback de navegação quando frames não executam. Primeiro harness travou no autowait durante navegação interceptada; refeito com observação síncrona do clique e destino controlado. Captura inicialmente sem charset foi corrigida no harness; fonte UTF8 correta. Assets remotos atuais usam Cache-Control:no-cache, dispensando alteração do index. Próximo: commit autorizado, publicar dois assets com backup/CAS e comprovar publicamente. Sem alterações no NodeAccess/banco.
