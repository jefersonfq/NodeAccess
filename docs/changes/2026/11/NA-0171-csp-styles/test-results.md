# NA-0171 — Validações e limitações

Estado: LOCAL_WIP, sem commit/push/PR/merge/deploy. Base745253d1edb522db79aaa44fd96608ce434a2774. Produto em /tmp/nodeaccess-NA-0171; documentos e capturas na pasta docs do projeto atual. Gates finais no SHA publicado permanecem obrigatórios.

| Validação | Resultado efetivamente observado |
|---|---|
| ZAP real final | PASS:12cenáriosHTTP,18mensagens,62regraspassivas,zeroMedium/High,2Low e4Info;cleanupcomplete. Rodada15:16:02Z–15:21:32Z em5/11/2026. |
| CSP HTTP/HTTPS | PASS: nonces256bits distintos e consistentes, no-store/sem304; style ausente/incorreto bloqueado, correto aplicado; scriptinline/eval bloqueados. |
| Monaco real | PASS: carregamento sob demanda, zero requests do editor/workers no login; edição/busca/worker/temas/reabertura e WebSocket real pelo nginx. |
| Terminal completo | PASS contra nginx/CSP; geometria, foco, mouse/SGR, autocomplete/SFTP e conexões preservados. |
| Ciclo de vida/SFTP | PASS com Monaco real:503/502/403,409, queda, gravação atrasada e digitação em voo preservam rascunho e sessãoSSH. |
| Supervisão | PASS:10cenários claro/escuro, terminalDOMreal, mobile, foco e encerramento; prints. |
| Contratos | PASS:11Vitest de carregamento/workers; contratos nonce/patch/SW e prova negativaChromium; revisão independente repetiu10sem skips. |
| nginx | PASS:28checks reais nos4perfis, incluindo503 semHTML quando templateinválido. |
| Kubernetes | Imagem real construída e executada uid101, envsubst/nginx-t/permissõesPASS; navegadorCSPPASS na primeira imagem. Imagem final reconstruída; prova runtime final pendente. |
| Manual | PASS:manual:capture final, cinco imagens revisadas (uma idêntica, quatro reabertas);2Node+18Vitest echeck-reviewed5capítulos. TextoSFTP preservado, hash atualizado após validação. |
| Build/typecheck/lint | PASS na implementação estabilizada. |
| Sonar | Planejado após concluir análise da NA-0170; ainda não aprovado para esta frente. |
| Homologação humana/CI remoto | Manual/Planned; não inferidos de testes locais. |

## Resultado de segurança
O alerta Medium10055-6 desapareceu no ZAP sem alterar regras ou limiar. style-src exige nonce para elementos inline. style-src-attr mantém unsafe-inline porque estilos de posicionamento emitidos por componentes e Monaco exigem essa compatibilidade; superfície residual explícita, não política CSS estrita completa. Scripts permanecem sem unsafe-inline/eval.

PermanecemLow10036-2 (versãoServer) e2 (IP privado no bundle) e quatro itens informativos. São separados da correção de CSP; não foram classificados automaticamente como falsos positivos.

## Limitações e falhas diagnósticas
Testes de interface usam APIs/SSH sintéticos; o echoWebSocket CSP é real. ZAP é passivo e não cobre todas as rotas, lógica de autorização entretenants ou transporteSSH. Nenhum ambiente produtivo foi usado.

O primeiro teste Kubernetes não carregou o script de prova porque o harness escrevia no dist local enquanto a imagem tinha assets empacotados. O harness passou a fornecer somente o JS de teste em rota exata da mesma origem peloPlaywright; documento/header/CSS e execução do browser permanecem reais. Primeira tentativa de porta18173 conflitou com fixture existente; recurso próprio removido e porta efêmera usada, sem parar serviço alheio.

Captura inicial do manual usava versãoesperada padrão9.8.7; repetida comdev conferido no build. Após ajuste de tipagem/lazy, capturas ehashSFTP foram revalidados. Não houve relaxamento de asserções para essas falhas.

## Candidato após revisão do coletor — 2026-11-05

- Ran: 3669 testes Vitest aprovados,0falhas,125pendentes;711 Node aprovados,0falhas,8skips.
- Ran: TLS real com isolamento/cleanup;5suítes CSP e11harnesses Chromium aprovados.
- Ran: cobertura local86,2121%;Sonar81,4%,gateOK,zero issues/zero hotspots.
- Ran: SIGTERM real removeu somente recursos próprios;76contratos aprovados;revisor confirmou correção dos3bloqueios.
- Ran: scanner estático Gitleaks42fixtures revisadas/0pendentes;Semgrep0achados/erros.
- Limitação: wrapper validate:sonar exit1 por REVIEW_CHECKOUT_CHANGED até registrar o candidato; não rotulado PASS integral.
- Planned: ZAP final, commit/PR e checks no SHA publicado.
- Manual: homologação funcional humana pendente.

### ZAP final do candidato
Ran: ZAP2.17.0,12cenários/18mensagens/62regraspassivas;0Medium/High,2Low e4Info. GatePASS ecleanupcomplete. Evidência:evidence/zap-final.json. Limite: inspeçãoHTTPpassiva, sem varredura ativa ou comprovação de autorização/SSH/WebSocket. Revisão independente GO para commit/PR; merge depende SHAfinal/CI/homologação.
