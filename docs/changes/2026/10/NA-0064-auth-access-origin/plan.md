# NA-0064 — Origem do acesso no histórico

## Objetivo
Distinguir a indicação de canal de entrada do resultado da autenticação, usando os dados existentes.

## Escopo
Coluna Origem do acesso em Logs > Autenticação. Marcador exato native-ssh-gateway indica Gateway SSH; assinatura reconhecível de navegador indica Interface web; ausência ou agente inconclusivo indica Não identificada. Informar que a inferência pelo User-Agent não comprova o canal. Manter IP, status, filtros e dados técnicos. Português e inglês, navegação por teclado e rolagem da tabela em telas pequenas.

## Limites
Sem alteração de autenticação, transporte, banco ou bloqueios. Campo explícito de origem gravado pelo servidor é evolução posterior; não recalcular nem alterar registros históricos. Logs não são fluxo mapeado no manual.

## Validação
Testes unitários de classificação e regressão de LogService; Playwright claro/escuro em 390/1440, IP/status preservados, erro/retry, vazio, texto não interpretado como HTML e foco. Typecheck frontend e inspeção de screenshots.
