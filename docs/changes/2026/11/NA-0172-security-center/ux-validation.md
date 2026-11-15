# Central de Segurança — refinamento e ambiente principal

> Homologação informada posteriormente pelo usuário; ajuste de navegação por âncoras registrado em [anchor-navigation.md](anchor-navigation.md). As métricas abaixo pertencem ao checkpoint anterior.

## Disponibilidade

A Central estava apenas no worktree isolado, enquanto `NodeAccess-current` ainda executava NA-0081. Após autorização do usuário, o worktree NA-0172 passou a ocupar o caminho principal. A árvore antiga foi preservada integralmente; consulte [transição e recuperação](workspace-transition.md).

```bash
cd /home/jeferson/projects/NodeAccess-current
nvm use
npm run dev
```

A versão selecionada por `.nvmrc` é Node 24.22.1, instalada no nvm do usuário e testada sob seu UID. Após login, abrir **Central de Segurança** no menu ou `/security`. O item independe do piloto do manual. Não iniciar duas instâncias concorrentes.

## Ajustes de UX

- Cards discretos por assunto, usando os tokens de superfície, borda, texto e ação do NodeAccess.
- Hierarquia do cabeçalho e condições com fundo suave, sempre visíveis junto à alegação.
- Índice compacto em duas colunas no celular e numeração discreta no desktop.
- Link de perfil mais perceptível; foco por teclado e links diretos preservados.
- Sem consulta de configuração, polling, badges de proteção ativa ou novas dependências.

[Desktop claro](evidence/ux-refinement/user-light-desktop.png) · [Mobile escuro](evidence/ux-refinement/user-dark-mobile.png) · [Texto ampliado](evidence/ux-refinement/user-light-mobile-text-200.png) · [Relatório](evidence/ux-refinement/report.json).

## Validações da interface

Ran: ESLint, quatro testes SSR, typecheck e build aprovados. Oito cenários no navegador real com bootstrap de API simulado, incluindo usuário/admin, claro/escuro, mobile/desktop, guard, teclado, retorno pelo menu e fragmentos. Doze capturas, incluindo quatro casos com tamanho das fontes duplicado; esse teste não equivale a zoom nativo do navegador. Inspeção de 147 arquivos JavaScript de produção não encontrou os metadados internos examinados. O catálogo editorial não mudou.

## Falhas preservadas e correção necessária

A primeira rodada completa no caminho canônico falhou no soak TLS (EOF em recovery), no bootstrap de fixture (prazo excedido) e no clique duplo do terminal (duas abas). Revisão independente não encontrou contaminação de ambiente/portas/caminhos. Os arquivos de produto correspondentes não foram alterados. Contenção é hipótese; a causa do clique duplo não foi provada. Na repetição isolada, Node/TLS e bootstrap passaram sem alterar tolerâncias.

A repetição encontrou uma falha determinística de medição no harness do terminal: a asserção de recuperação do autocomplete usava todo o tráfego WebSocket, incluindo ping JSON, embora o mock já separasse stdin binário em `inputSent`. Foram alteradas somente as callbacks de baseline/captura e adicionada intercalação explícita de heartbeat. A igualdade exata de bytes foi preservada. Três contratos executam as callbacks reais e verificam controles, caminho incorreto/byte extra, conteúdo JSON binário e cenário normal. Nenhum código de produto, resize, transporte, deadline ou threshold foi alterado.

Evidências das rodadas com falha permanecem privadas em `/tmp/NA0172-ux-first-validation-failed` e `/tmp/NA0172-ux-isolated-failed`. Elas não devem ser descritas como aprovadas.

Uma falha posterior do laboratório identificou coleta de subprocesso antes da drenagem de stdout. O helper `probe-response.mjs` agora aguarda `close`, rejeita saída não zero/sinal/JSON inválido e limita a operação aos mesmos 10 segundos, sem depender de `close` para rejeitar no deadline. Diagnósticos contêm somente motivo, código/sinal e contagens, sem payload. Cinco contratos passaram, incluindo handshake por pipe (sem pausa arbitrária) e processo já encerrado que mantém streams abertos. Revisão independente aprovou o fechamento dos streams próprios. Core TLS, soak e seus limites não mudaram.

A rodada que já havia aprovado 696 testes Node foi interrompida controladamente antes da conclusão para incorporar esse último ajuste revisado; não é uma rodada aprovada. Evidência preservada em `/tmp/NA0172-ux-pre-deadline-fix`.

## Scanners e banco local

Ran: Semgrep final com 908 alvos, zero achados/erros; Gitleaks com 61 ocorrências revisadas e zero pendentes. A transição trouxe 19 ocorrências de documentos históricos: 17 UUIDs Sonar e dois hashes de fontes. Revisão independente verificou cada ocorrência e sua identidade com o backup; as exceções são individuais por arquivo/linha/regra/hash. Nenhuma pasta ou regra foi excluída. [Revisão documental](evidence/documentary-gitleaks-review.json).

Após confirmação explícita do usuário, foi aplicada a única migração local pendente, `20261104230000_tacacs_tls_identity`. Backup completo preparado e verificado por estrutura/hash; restauração não ensaiada. Ledger agora com 151 migrações, zero pendentes/incompletas; tabela TACACS permaneceu vazia. [Verificação da migração](evidence/local-migration-verification.json). Não houve implantação na VPS.

## Gate final — execução canônica

[Resumo sanitizado](evidence/ux-final-validation.json). Análise Sonar `953165e8-832b-486f-94c1-a9004c609ef2`, concluída em 06/11/2026. Código e catálogo com fingerprint `133fa5b23a7857d9f3bef2338c50f415034733cb6c1d197b6e355f7bf3854f50`; HEAD/base `745253d1edb522db79aaa44fd96608ce434a2774` porque não houve commit.

| Verificação | Resultado real |
|---|---|
| Vitest completo | Ran: 3.662 aprovados, 0 falhas, 125 ignorados |
| Node completo | Ran: 697 aprovados, 0 falhas, 7 ignorados |
| Integração Sonar | Ran: 231 aprovados |
| Browser instrumentado | Ran: 10 harnesses aprovados, incluindo terminal e Central |
| Laboratório real TLS | Ran: live, health, soak e watchdog aprovados; isolamento e limpeza verificados |
| Cobertura do diff | Ran: 89,67%, mínimo 80%; sem falhas de cobertura |
| Quality Gate Sonar | Ran: OK, 81,2% no período configurado do servidor, diferente do diff local |
| Achados Sonar exportados | Ran: 0 issues; 0 hotspots pendentes; tabela integral da reanálise vazia |
| Semgrep / Gitleaks | Ran: 908 alvos e 0 achados/erros; 61 ocorrências documentadas, 0 não revisadas |
| Lint / manual / diff | Ran: lint focal, cinco capítulos com revisão atual e diff check aprovados |
| Prontidão local | Ran: API3000 e gateway3001 com HTTP200/status ok em todos os checks; Central e view HTTP200 em5173 |
| SSH PTY real | Skipped: sem mudança de produto em resize/transporte/WebSocket |
| Homologação humana / publicação | Manual: pendentes; nenhuma implantação na VPS |

A rotina `validate:sonar` completa retornou **FAIL exclusivamente por REVIEWED_FINDINGS_NOT_VERIFIED / REVIEW_CHECKOUT_CHANGED**. Testes/cobertura/scanner terminaram com código0, mas a reconciliação exige candidato registrado em commit e checkout limpo. Nenhum gate foi relaxado. SQ-0437/0438/0439 tiveram somente evidência de fonte atualizada após revisão independente individual; nenhuma decisão foi criada ou aplicada no servidor.

O aviso de ResizeObserver do Vite permaneceu registrado e os dez harnesses/agregado passaram; não foi criada exceção. As falhas de rodadas anteriores continuam registradas acima e no diário.

[Prontidão do ambiente](evidence/local-dev-readiness.json). O `npm run dev` foi iniciado como jeferson com Node24.22.1 e permanece ativo no fechamento deste checkpoint. Não é necessário iniciar segunda instância. Para reiniciar posteriormente, usar os comandos no início deste documento.

Estado: **LOCAL_WIP** no projeto atual. COMMITTED, PUSHED, PR_OPEN, MERGED e MASTER_SYNCED não realizados nesta frente. Próximos gates: homologação humana, autorização de commit/PR e validação/reconciliação do candidato limpo para publicação.
