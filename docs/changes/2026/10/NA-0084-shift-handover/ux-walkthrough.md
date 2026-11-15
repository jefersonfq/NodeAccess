# NA-0084 — Processo entre usuários, com capturas

Capturas da interface real do checkout local em30/10/2026, dados sintéticos. Estas oito capturas foram atualizadas na jornada ampliada: API/MySQL reais, 82 chamadas HTTP pelo browser e contextos independentes de operadores, gestora e administrador. O [roteiro da evolução](evolution-ux.md) contém as demais capturas. Shell externo ao domínio usa fixtures; não é homologação humana nem produção. Os estados finais foram aguardados antes de capturar, sem overlays de carregamento.

## 1. Carlos prepara o contexto

Host, situação, próximo passo e prioridade. Falha503 simulada preservou o formulário antes do salvamento real.

![Carlos prepara o contexto](screenshots/01-carlos-prepara-pendencia.png)

## 2. Carlos encaminha e aguarda

O aviso explica que Carlos continua responsável até Marina aceitar. A passagem pode ser cancelada.

![Carlos encaminha e aguarda](screenshots/02-carlos-encaminhou-aguarda-aceite.png)

## 3. Marina consulta a central

Sino acessado por teclado. A notificação apresenta host e título autorizados; abrir e marcar como lida são ações separadas.

![Marina consulta a central](screenshots/03-marina-recebe-notificacao.png)

## 4. Marina revisa o contexto

O destinatário pode aceitar ou devolver com motivo. O teste confirmou que ler a notificação não alterou o responsável.

![Marina revisa o contexto](screenshots/04-marina-revisa-antes-do-aceite.png)

## 5. Marina aceita explicitamente

O responsável muda somente após o comando autorizado e transacional. O histórico identifica quem aceitou.

![Marina aceita explicitamente](screenshots/05-marina-assume-responsabilidade.png)

## 6. Marina conclui com resultado

O resultado fica no topo, distinguindo conclusão do próximo passo que havia sido registrado.

![Marina conclui com resultado](screenshots/06-marina-conclui-com-resultado.png)

## 7. Carlos acompanha as atualizações

A central informa eventos históricos. Uma notificação antiga não afirma que a pendência ainda aguarda ação.

![Carlos acompanha as atualizações](screenshots/07-carlos-acompanha-retorno.png)

## 8. Leitura em tela pequena

Responsável e resultado permanecem visíveis no início. Não houve overflow horizontal; o conteúdo continua com rolagem.

![Leitura em tela pequena](screenshots/08-mobile-historico.png)

## Decisões de UX

O formulário prioriza contexto e próximo passo; evidências opcionais ficam em seção secundária. No mobile, o responsável aparece perto do título. A devolução permite correção e novo envio. Reatribuição administrativa é distinta de aceite. A central é reutilizável, com leitura independente da ação do domínio. Datas seguem o idioma da interface.

Validação: percurso criar→encaminhar→ler→aceitar→concluir,503semperderrascunho, navegação do sino por teclado, desktop/mobile e ausência de pageerrors. Limites: não é auditoria completa de acessibilidade ou todos os navegadores; estados de devolução/reatribuição foram testados na API e têm controles na UI, mas não aparecem nestas oito capturas.
