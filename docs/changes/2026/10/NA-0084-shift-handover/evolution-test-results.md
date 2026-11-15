# NA-0084 — Validação da evolução de acompanhamento e quadro gerencial

Data: 2026-10-30T14:35:29-03:00. Estado: **LOCAL_WIP**; validação técnica local, homologação humana/publicação pendentes.
Base/HEAD: `f4a44b4b7ae87a8f688b1246d9e52a31f9a104bc`, branch `feature/NA-0084-20261030-shift-handover`, checkout `/tmp/nodeaccess-NA-0084`.
Fingerprint SHA256 de 69 arquivos novos/alterados fora de docs/ e README.md: `2afe4665f3594be95b46f342a520179797f627efcd6749927450e06c408ad7c7` (nome + NUL + conteúdo + NUL em ordem). Identifica candidato não commitado, não representa SHA de commit testado.

## Ran — checks executados

| Gate | Resultado | Evidência |
|---|---|---|
| Baseline antes da evolução | 86 testes / 7 arquivos, PASS | `/tmp/na0084-evolution-baseline.log` |
| `npm run test:handover:core` ampliado | 128 testes / 9 arquivos, PASS | `/tmp/na0084-evolution-core-final.log` |
| Laboratório final API/MySQL/browser | 23 cenários, PASS_WITH_WARNINGS; 82 chamadas reais pelo browser, 20 capturas | [relatório](evidence/evolution-lab-report.json) |
| Revisão independente | PASS_WITH_WARNINGS, sem bloqueios funcionais; 93 testes e 22 cenários API reais próprios | [relatório próprio](evidence/evolution-independent-report.json); `/tmp/na0084-evolution-independent-unit.log`; `/tmp/na0084-evolution-independent-board-ui.log` |
| Build integrado shared/backend/frontend | PASS | `/tmp/na0084-evolution-build-final.log` |
| Build frontend após refinamento mobile | PASS | `/tmp/na0084-evolution-frontend-build-final.log` |
| Lint final dos 41 arquivos de aplicação/testes alterados | PASS; refinamento mobile também lintado | `/tmp/na0084-evolution-lint-final.log`; `/tmp/na0084-mobile-metrics-lint.log` |
| `npm run test:manual` | 2 testes Node + 18 Vitest, PASS | `/tmp/na0084-evolution-manual-unit.log` |
| `npm run manual:capture` | PASS, seis capítulos; geometria/compartilhamento/retorno tenant sem reconexão | [manual](evidence/evolution-manual-review.json); `/tmp/na0084-evolution-manual-capture.log` |
| `npm run manual:check-reviewed` | PASS após revisão editorial de Hosts/Plantão | `/tmp/na0084-evolution-manual-reviewed.log` |
| `npm run test:terminal-experience:web` | PASS, suíte completa | [terminal](evidence/evolution-terminal-experience.json) |
| Diff e links locais dos documentos da frente | PASS no fechamento | `git diff --check` e verificação de links relativos |

Warnings de build: chunks maiores que 950kB e comentários de anotação do Zod. Não foram ocultados. O changeId NA-0014 no JSON da suíte terminal é o rótulo legado do harness; esta execução foi no checkout NA-0084.

## Critérios comprovados

- Concessão só por ADMIN atual; grupo/usuário de outro tenant não pode ser concedido. Sem grant, quadro e exportação negados. Pertencer ao grupo não basta para gerenciar.
- Grupo considera responsável atual ou destinatário pendente; aceite e mudança de associação retiram visibilidade antiga. Grant tenant não libera auditoria restrita nem torna gestor administrador.
- Revogação, ACL de host e auditoria são revalidadas no detalhe/recorte/exportação. Gestor não conclui pelo responsável.
- Quatro concessões concorrentes com mesma identidade geram um registro/evento; payload diferente gera409; revoke repetido e replay antigo não restauram acesso; ação nova restaura.
- Prazos removíveis; novas versões preservam contexto no snapshot. Lembrete usa último encaminhamento, intervalo e participantes atuais; consulta não altera revisão ou cria notificações.
- CSV usa recorte autorizado e filtros, neutraliza fórmulas e não exporta contexto livre. Com505 registros sintéticos, resposta limita500 e sinaliza parcialidade.
- Browser: Carlos/Marina criam/encaminham/leem/aceitam/concluem, Beatriz consulta grupo sem ações de dono, administrador concede e reconcede após revogação externa. Cinco contextos isolados representam quatro identidades sintéticas.
- Browser: CSV baixado e conferido; exportação atrasada após troca de filtro não baixa conteúdo antigo nem deixa loading preso;503 do formulário preserva campos;503 do quadro tem retry local; recorte vazio explícito; lembrete ajustado e desabilitado; dashboards e quadro mobile renderizados sem overflow/pageerrors.

## Revisão de UX e ajustes

[Roteiro com capturas](evolution-ux.md). Foram corrigidos: semântica do resumo pessoal vs tenant; link do widget preservando recorte de gestão; identidade nova após sucesso de concessão; estado de exportação concorrente; texto dos contadores; quebra de rótulo em mobile. Mantidos três indicadores principais, três itens no widget, paginação20, agrupamentos expansíveis e concessões em seção secundária.

Execuções intermediárias do browser pararam em seletores do harness (card em vez do botão e texto exato do botão de intervalo). Outro timeout ocorreu na primeira abertura do dashboard no Vite descartável; diagnóstico isolado renderizou o widget, e a rodada final passou com espera explícita de até60s para carregamento frio, sem afrouxar os asserts. Não foi identificado erro de aplicação nesse caso. Capturas finais substituem as tentativas; não foram geradas artificialmente.

## Skipped / Manual / Planned

**Skipped:** VPS, SSH/PTY real (não houve mudança de transporte/resize), login/MFA completo, integração Jira/chat, benchmark prolongado e cadeia integral histórica `prisma migrate deploy`. O laboratório aplica as migrações novas sobre schema base e preserva usuários/host sintéticos; não homologa upgrade de produção.

**Manual:** revisão visual por IA/root e revisor independente, não aprovação humana. **Planned:** piloto humano com o roteiro, revisão de backup/migração no destino e publicação quando autorizada.

Lembrete é resumo consultado, não scheduler/push; configuração local por navegador/usuário/tenant. Quadro é recorte atual, não escala assinada nem ranking.500 candidatos com contagens parciais explicitadas; relatório é consultado novamente no download. Snapshots legados ausentes não são reconstruídos. Logs em /tmp são transitórios; relatórios e capturas desta pasta são persistidos em docs.

Nenhum commit, push, PR, merge ou deploy executado; master não recebeu esta frente. Demais trabalhos locais preservados. Containers do laboratório removidos em finally.
