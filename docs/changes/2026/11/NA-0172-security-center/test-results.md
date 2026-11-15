# Validação — NA-0172

> Checkpoint anterior ao refinamento: resultados finais do projeto canônico estão em [ux-validation.md](ux-validation.md).

Candidato LOCAL_WIP na branch `feature/NA-0172-20261106-security-center`, baseado em `745253d1edb522db79aaa44fd96608ce434a2774`. Testes executados em `/tmp/nodeaccess-NA-0172`; documentos espelhados no projeto atual. Nenhum commit final, homologação ou implantação declarados.

| Verificação | Execução e resultado |
|---|---|
| Catálogo e fingerprint | Ran: 7 contratos do catálogo + 1 teste do inventário aprovados; campos extras, estados inválidos, evidência ausente e alterações do JSON verificados. |
| Interface SSR | Ran: 4 testes aprovados; lint dos arquivos afetados e typecheck frontend aprovados. |
| Build | Ran: build frontend aprovado; build final repetido após texto e scroll. |
| Navegador da Central | Ran: 8 cenários aprovados no Vite real com bootstrap de API simulado; usuário/admin, 2 temas, desktop/mobile, guards, teclado, perfil, retorno pelo menu e fragmentos. |
| Bundle público | Ran: 146 arquivos JavaScript examinados; metadados internos e controles pendentes examinados não foram encontrados. Não equivale a teste de runtime de produção. |
| Manual | Ran: 5 capturas; 2 testes Node + 18 Vitest aprovados; 5 capítulos com revisão atual. Somente Hosts teve hash/data editorial atualizados devido ao menu. |
| Terminal | Ran: repetição de `npm run test:terminal-experience:web` aprovada, exit 0. A primeira tentativa falhou com ERR_NETWORK_CHANGED durante atividade Docker; nenhuma asserção foi relaxada. |
| Semgrep | Ran: 907 alvos, 0 achados, 0 erros. |
| Gitleaks | Ran: 42 ocorrências já revisadas, 0 não revisadas. Dois hashes de placeholders PEM públicos renovados após revisão independente, sem nova exclusão. |
| Vitest completo | Ran: 3.662 aprovados, 0 falhas, 125 ignorados pela suíte; não declarar os ignorados como executados. |
| Integração Sonar | Ran: 231 testes aprovados. Node: 689 aprovados, 0 falhas, 7 ignorados. Dez harnesses de navegador aprovados; cobertura e scanner exit 0. |
| Revisão independente | Ran: plano/diff, catálogo/projeção, UX, integrações coverage/manual e planilha revisados; sem novo bloqueio de implementação identificado. Reconciliação do candidato limpo e homologação permanecem pendentes. |
| SSH PTY real | Skipped: nenhuma mudança em resize, transporte SSH ou WebSocket. |
| Homologação humana e produção | Manual: pendentes; sem publicação desta frente. |

## Evidências da interface

[Relatório dos cenários](evidence/report.json), [desktop claro](evidence/user-light-desktop.png), [mobile escuro](evidence/user-dark-mobile.png). As oito capturas contêm somente fixtures sintéticas. Catálogo testado: SHA-256 `29b244fdd01cb7ec6ba9058adb3a288371170de3579e83562f9a6441fc5ff114`.

## Limitações

A Central é informativa e não consulta configurações operacionais de tenant. Catálogo revisado por leitura de fonte; referências a testes não são prova automática de execução. Sonar executado: Quality Gate OK, zero issues exportadas e zero hotspots pendentes. A rotina completa retornou FAIL exclusivamente por REVIEW_CHECKOUT_CHANGED / REVIEWED_FINDINGS_NOT_VERIFIED: a reconciliação exige checkout commitado e limpo. Não houve alteração de regras, thresholds ou decisões para contornar esse gate. Os procedimentos e indicadores não foram implantados em VPS.

## Sonar e cobertura finais

[Resumo sanitizado](evidence/sonar-summary.json). Análise `88b0f0e5-d699-459d-bee2-b457cc696311`, concluída em 06/11/2026. Fingerprint do código e catálogo: `977d6cacbf026f22b70e3ca12e22c457c1428a28f6afd019bc0c2f91356aea05`. Base e HEAD são iguais porque as alterações ainda não foram commitadas.

| Medida | Resultado |
|---|---|
| Cobertura do diff local | 92,48%; threshold 80%; 230/241 linhas e 102/118 condições cobertas |
| Cobertura de código novo no período Sonar | 81,2%; período PREVIOUS_VERSION configurado no servidor, diferente do diff local |
| Novas violações Sonar | 0 |
| Issues exportadas para comparação | 0; nenhum novo achado a aceitar |
| Hotspots pendentes | 0 |
| Quality Gate | OK |
| Rotina completa validate:sonar | FAIL: reconciliação não aprovada para checkout com alterações locais |

A tabela integral de ocorrências desta reanálise está vazia (0 issues). As 295 ocorrências do registro histórico não aparecem na exportação; isso não autoriza alterar suas decisões. Nenhuma decisão foi modificada nesta rodada. Avisos de codificação em fixtures existentes e de blame em fontes sem commit foram preservados nos logs privados. O aviso de ResizeObserver no log do Vite não provocou falha nos dez harnesses nem no coletor agregado; não foi criada exclusão.

Próximo gate: obter autorização explícita de commit/PR; fixar o candidato e repetir a validação exigida para o SHA antes da publicação. Homologação humana continua separada do resultado automatizado.
