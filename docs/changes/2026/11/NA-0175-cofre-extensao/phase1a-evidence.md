# NA-0175 — Evidência local da fase 1A

Data: 2026-11-15, America/Sao_Paulo. Base: ae188983d061a7bb5e6aaf855fd9d2f92416f3b8. Branch: feature/NA-0175-20261115-vaultnaccess. Árvore local não commitada; resultados não equivalem a aprovação de SHA final/produção.

## Resultado funcional

/vault reúne metadados de Secrets/PEM com IDs compostos e filtro; serviços/APIs atuais são reutilizados. Cadastro, edição, rotação, revogação, exclusão, consumidores e importação/passphrase mantêm contratos por tipo. Falha/licença de Secrets não bloqueia PEM autorizado. Watchers invalidam contexto, descartam respostas antigas e desmontam editores, inclusive nas duas rotas legadas. Não há revelação de valor salvo, nova criptografia, extensão, migração ou alteração em backend/terminal/snippets.

## Executado — Ran

| Verificação | Resultado | Evidência local |
|---|---|---|
| Baseline contratos existentes antes do código | 9 arquivos /54 testes PASS | .tmp/NA-0175/baseline.log |
| Tipagem frontend e lint de arquivos tocados | PASS; zero avisos no lint focal | .tmp/NA-0175/focal-final.log; final-code-checks.log |
| Catálogo e editores | 3 arquivos /17 testes PASS | .tmp/NA-0175/final-code-checks.log |
| Snippets frontend/backend | 8 arquivos /66 testes PASS | .tmp/NA-0175/focal-final.log |
| Chromium VaultNAccess | PASS | .tmp/NA-0175/browser-final.log |
| Chromium Secrets legado | PASS | .tmp/NA-0175/legacy-secrets.log |
| Terminal-experience | PASS com API/WebSocket simulados | .tmp/NA-0175/regression.log |
| Manual captura | PASS; compartilhamento60 estados; tenant2 ciclos sem reconexão | .tmp/NA-0175/manual-capture.log |
| Manual testes | 2 Node +18 Vitest PASS | .tmp/NA-0175/regression.log |
| Manual check-reviewed | PASS | .tmp/NA-0175/manual-reviewed.log |
| Build frontend | PASS; avisos Rollup/chunk existentes, sem alterar limite | .tmp/NA-0175/regression.log |
| Contratos do tooling de cobertura | 6 Node PASS; diagnóstico repetido após incluir estágio Vault | .tmp/NA-0175/final-code-checks.log; diagnostics-final.log |
| Revisão independente fonte/diff | PASS_WITH_WARNINGS; dois achados corrigidos | agente review_base_reconciliation; resumo abaixo |
| Planilha roadmap | ZIP/XML, células e revisões preservadas; Original2027 byte a byte | roadmap-phase1a-evidence.json |

Browser novo exercita busca/vazio, colisão de ID, consumidores hosts/snippets, edição sem value, rotação/revogação/exclusão, cadastro com validação/falha/retry, arquivo PEM/passphrase/exclusão, ausência do valor sintético em inputs/storage após salvar, falha parcial/retry, licença antes de consulta, ACL somente leitura, carregamento legado e troca de contexto com formulário aberto sem navegação nas três rotas. Leitura PEM pendente após fechar/reabrir é descartada. Capturas desktop1360x900/mobile390x844 em .tmp/NA-0175/browser foram inspecionadas; tabela mantém rolagem horizontal em tela estreita.

Revisão independente estática identificou risco de contexto nas rotas legadas e arquivo PEM tardio. Ambos corrigidos antes das execuções finais. Não foi revisão humana. Testes dos editores usam render nulo devido compilação SSR do Vitest: validam funções expostas/descarte, sem afirmar teste de template. Interação/template é exercitada pelo Chromium. Rotas legadas têm ensaio dedicado de Secrets e listagem/troca de contexto de PEM; não alegar CRUD completo em toda combinação de rota/perfil.

## Pendente — Planned / Manual

`npm run validate:sonar`: integral ainda não executado; requer candidato congelado e checkout limpo para reconciliação de findings no SHA analisado. Não há aprovação Sonar desta frente. Agregado de cobertura inclui agora a jornada Vault; porcentagem não medida nem presumida. CI remoto, PR, homologação humana e merge pendentes. Commit e continuidade autorizados pelo usuário na interação seguinte; resultados finais serão vinculados ao SHA na PR.

## Não executado — Skipped

PTY real: não houve mudança de resize/SSH/WebSocket. Testes usam dados/API sintéticos; não afirmam conexão real SSH/RDP, pentest ou eliminação física de memória. Excel visual não disponível. Plugin, reveal, WebAuthn/Hello, agente, HPKE/E2EE não pertencem à fase1A e não foram implementados/testados.

## Gate integral do candidato01f348977 — FAIL

Executado após autorização de commit. Vitest3799PASS/124pendentes; Node700PASS/1falha timeout do bootstrap/11skips; TLS laboratórioPASS/cleanuptrue;10/10jornadas browserPASS. Cobertura nova36,9179%, abaixo80%. Scanner bloqueado por cache antigo root0700, sem análise aprovada. Relatório privado: .sonar-reports/validation-1794782660588-6222f0c6-9919-4c06-9d94-9bb5a099b071/validation.json. Correção de propriedade restrita a4entradas de cache Grype, sem ampliar permissões ou excluir dados.

Remediação:50testesfocaisPASS (14catálogo,30editores,6telas), lintPASS, bootstrapV8PASS mantendo10000ms e44/10fixtures comassertleituraúnica. Diagnósticos focais de cobertura não aprovam o agregado. Browser continua obrigatório: mocksNaive/SSR não demonstram foco, eventos/visibilidade reais. Nova análise e gate em SHA congelado pendentes; não reusar evidência do primeirocandidato comoaprovação.
