# NA-0160 — Registro da implementação

## Pedido e objetivo

Concluir validação fim a fim e sanar colaterais.

## Implementação

Base SHA 9a47efdba488adeff100ebf28dfb3f74798e1d4d. O runner hospedado UID1001 cria o webroot da fixture; o worker root recusa dono diferente de root/UID próprio. Transferir somente o webroot descartável para root ao semear o desafio. A limpeza existente devolve a árvore descartável ao runner. Nenhuma permissão do produto foi relaxada.

## Validação

Ran: A/B real sob UID1001, Node24 e imagem na0149 com hashes de challenge-files/entrypoint idênticos. Base falha HTTP01_LOCAL_FAILED; candidato PASS com ACME/Certbot/Nginx/TLS/SSH PTY/WebSocket, uma conexão de cada, rollback e recuperação. Tentativa inicial com tag test antiga falhou antes do cenário (entrypoint ausente); não contada como validação.

## Recuperação

Branch independente e limpeza dos recursos descartáveis.

## Pendências

CI do candidato integrado e revisão independente pendentes.

## Diário de interações

### 2026-11-04T14:17:16-03:00 — Reprodução não privilegiada

Usuário pediu continuar. Reproduzida falha hospedada e aplicada correção mínima no laboratório. Ran: A/B real sob UID1001, Node24 e imagem na0149 com hashes de challenge-files/entrypoint idênticos. Base falha HTTP01_LOCAL_FAILED; candidato PASS com ACME/Certbot/Nginx/TLS/SSH PTY/WebSocket, uma conexão de cada, rollback e recuperação. Tentativa inicial com tag test antiga falhou antes do cenário (entrypoint ausente); não contada como validação. Próximo passo: integração e CI.
