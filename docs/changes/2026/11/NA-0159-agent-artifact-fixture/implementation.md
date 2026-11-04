# NA-0159 — Registro da implementação

## Pedido e objetivo

Concluir conformidade Sonar e corrigir colaterais encontrados no CI.

## Implementação

Base SHA 9a47efdba488adeff100ebf28dfb3f74798e1d4d. Os CLIs copiados pela fixture importam trusted-executable.cjs, ausente no diretório temporário. Copiar o helper real em ambos os cenários e incluir stderr na asserção de importação para diagnóstico. Nenhuma alteração no instalador ou fronteiras de segurança.

## Validação

Ran: 19 testes reais de artefatos/proveniência PASS em Linux; Windows depende do runner hospedado. Planned: CI no candidato integrado.

## Recuperação

Branch independente; reversão por PR.

## Pendências

CI, revisão independente e homologação humana pendentes. Sem alterações no Sonar principal.

## Diário de interações

### 2026-11-04T14:10:04-03:00 — Continuidade solicitada

Usuário pediu continuar. Falha reproduzida, causa isolada e correção localizada com testes. 19 testes reais de artefatos/proveniência PASS em Linux; Windows depende do runner hospedado. Próximo passo: consolidar e repetir gates.
