# Captura suplementar — dashboard estabilizado

Candidato: 66b72db3483bf51412526e25a03c3124c948cfd3.

Captura principal: dashboard-stable.png. Relatório: report.json.

Método: servidor Vite loopback com porta e cache exclusivos nesta pasta; fontes lidas do checkout congelado, fixtures oficiais de dashboard/settings, navegador Chromium1234/contexto novos. APIs simuladas e tráfego externo bloqueado. Sem coleta de cobertura, sem scanner e sem alterar arquivos do projeto.

Após carregar o dashboard, leitura do computed style de .n-spin-content; aguardou opacidade1, ausência de classe spinning e ausência de animação/transição em execução. Opacidade inicial, estabilizada e após screenshot:1, sem animações. Viewport/scroll1440, zero pageErrors. Browser e servidor encerrados.

Inspeção visual: conteúdo estabilizado volta ao brilho esperado, sem corte/desalinhamento. Não foi observada opacidade reduzida persistente. A imagem original esmaecida foi preservada por hash; seu computed style não foi registrado na coleta original, portanto a origem exata do frame continua inferência de timing, compatível com transition opacity .3s do NSpin. Não é auditoriaWCAG nem prova de backend real.

Primeira tentativa privada falhou por seletor .n-spin-body (indicador já removido), com cleanup completo. Seletor corrigido somente no script temporário; nenhuma fonte congelada mudou. Evidência dessa tentativa permanece /tmp/NA0093-dashboard-stable-sjpg4q/report.json.

Script usado: /tmp/NA0093-stable-dashboard.mjs. Árvore Git permaneceu limpa e PNGoriginal não mudou (SHA no relatório).
