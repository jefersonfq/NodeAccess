---
change_id: NA-0148
title: Segurança de entrada e navegação da auditoria e terminal
type: fix
status: implemented
created_at: 2026-11-04T09:42:04-03:00
base_branch: chore/NA-0093-20261103-sonar-delivery
base_sha: ee436402db8bcce7fab4378d6ba28c1673b282b5
branch: fix/NA-0148-20261104-audit-ui-input-safety
owner: NodeAccess
planner: Codex
risk: medium
---

# NA-0148 — Entrada e foco nos fluxos de auditoria

## Contexto e situação anterior

NA0145 comprovou bloqueio indiscriminado de keydown no playback, múltiplas compressões IPv6 não detectadas e crescimento quadrático ao limpar DCS incompleto. Foco visível em modo cópia e saída do canvas remoto ainda carecem de evidência.

## Problema e objetivo

Corrigir comportamentos comprovados e validar as duas lacunas de foco sem mudar política de acesso, denominadores ou gates. Manter controles discretos e funcionamento remoto previsível.

## Escopo

1. SessionAuditDetailView: permitir Tab/rolagem/cópia no playback de leitura; preservar bloqueio de edição/paste se necessário. Substituir somente busca DCS problemática por varredura linear reutilizada pela limpeza e contagem, preservando semântica documentada para sequências completas/incompletas.
2. HostsView: corrigir validação IPv6, extraindo helper frontend pequeno testável se necessário; preservar digitação parcial/CIDR e usar validação final ao sair/salvar sem mudar IPv4/hostname fora do necessário.
3. TerminalPane modo cópia: comprovar foco computado; adicionar indicação focus-visible alinhada ao tema se ausente, sem alterar área útil.
4. GraphicalSessionView: verificar navegação real do canvas. Se falta saída local, propor atalho explícito reservado (Ctrl+Alt+Shift, padrão comum de console remoto), retorno aos controles e liberação de modificadores pressionados; preservar Escape/Tab remotos fora do atalho. Ajuda curta associada ao canvas e visível apenas quando pertinente, sem faixa permanente. Confirmar detalhes do fluxo antes de implementar esse ponto.
5. Testes unitários comportamentais, harness focal Playwright/prints antes/depois, manual hosts/terminal e evidência canônica. Sem edição de backend/highlighter/normalizer ou rotina raiz.

## Critérios de aceitação

- [x] Playback permite sair com Tab, rolar por teclado e copiar sem alterar conteúdo.
- [x] IPv6 válido/comprimido/IPv4-mapped e CIDR são tratados corretamente, com contrato explícito para estado parcial versus validação final e rejeição de múltiplas compressões.
- [x] DCS completo/incompleto e Unicode preservam contrato diferencial definido; entrada adversarial não cresce quadraticamente nem elimina texto não relacionado silenciosamente.
- [x] Modo cópia tem foco visível comprovado e canvas tem caminho local de saída de foco verificável sem teclas/modificadores presos remotamente.
- [x] Browser real desktop/mobile, terminal-experience:web, testes pertinentes, lint/typecheck/build e manual:capture/test:manual/manual:check-reviewed aprovados ou limitação explícita antes de entrega.
- [x] Revisão independente e checkpoint local; não inferir homologação humana/AT, publicação ou merge.

## Estratégia técnica

Reutilizar parser frontend existente se compatível; busca inicial não localizou um parser DCS reutilizável no domínio. Preferir helper pequeno em services para duas chamadas da mesma view, sem abstração genérica. Definir fixtures diferenciais do comportamento atual antes da substituição. O tratamento de sequência incompleta precisa ser explícito para evitar juntar texto de mensagens distintas.

Validação IPv6 deve separar input parcial de estado final: exemplos como prefixo em digitação ou máscara vazia não devem produzir erro precoce, mas não passam como endereço final válido. Não introduzir dependência nova sem necessidade demonstrada.

## Riscos e mitigações

DCS: perda de evidência se limpeza consumir texto incompleto; mitigar comparação de saída e contagem, chunks/terminadores/Unicode e carga adversarial. IPv6: falso negativo em endereço válido ou mudança de UX enquanto digita; cobrir compressão, IPv4 incorporado, máscara0/128, múltiplas barras e fronteiras. Foco: teclado preso ou modificador remoto não liberado; testar sequência completa de keydown/keyup e blur, com transporte simulado e sem host real. Nenhuma homologação de leitor de tela será alegada sem execução real.

Não alterar resize/WebSocket/SSH. Se o diff mudar área útil do terminal, executar terminal-experience:web (já previsto); se surgir alteração efetiva de resize/transporte SSH, acrescentar terminal-pty:real contra host descartável conforme AGENTS.md.

## Matriz de testes e evidências

Antes: preservar provas NA0145 e obter capturas/foco/teclado com harness focal em dados sintéticos. Unitários: casos semânticos IPv6, DCS bem-formado/incompleto/adversarial/Unicode, regressão de teclas/saída de foco. Browser: Tab e Shift+Tab, setas/PageDown/Ctrl+C, foco visível, saída canvas e retorno, estados conectado/desconectado, desktop390/1440. Executar teste terminal completo, testes frontend pertinentes e checks de tipos/lint/build. Manual: revalidar capítulos mapeados hosts/terminal, capturar cinco imagens, revisar e só então atualizar manifesto. Relatar mocks/limites.

## Baseline

ee436402db8bcce7fab4378d6ba28c1673b282b5. Node24.22.1, npm12.2.1; dependências compartilhadas somente para execução, sem regeneração.

## Rollback ou recuperação

Reversão em branch isolada; sem banco/migração. Separar correções lógicas em checkpoints revisáveis se a validação indicar necessidade, preservando autorização de commits locais e sem push/merge.

## Aprovação

Decisão: GO_WITH_RISKS. Usuário autorizou correções fim a fim; plano submetido à raiz antes de editar produto. Saída local de foco implementada após prova inicial, com liberação de teclas e evidência browser. Leitor de tela formal continua fora da evidência obtida.
