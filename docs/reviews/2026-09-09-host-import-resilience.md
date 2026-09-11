# Importação de hosts: validação e resiliência

## Correções

- CSV mantém registros sem endereço na prévia. Portas inválidas não são convertidas silenciosamente para 22; a confirmação exige corrigir ou desmarcar os registros. Porta omitida no arquivo continua usando o padrão 22.
- Alterações nos dados/mapeamentos invalidam a prévia; respostas atrasadas não restauram uma prévia incompatível com as correções atuais. Cliques repetidos durante a importação são ignorados.
- Atualização de duplicados aplica e remove bastion; os snapshots de reversão preservam a associação anterior. Credenciais existentes são preservadas, com explicação na interface, sem criar Secrets que não seriam usados.
- Identificadores de origem repetidos são rejeitados. O papel atual do usuário é reavaliado na confirmação, inclusive para atualizar duplicados.
- Registros bloqueados permanecem no resultado. O relatório JSON/CSV inclui o ID do host para conferir o cadastro.
- Falhas ao desfazer recursos produzem `partially_rolled_back`, com recursos pendentes e indicação de revisão manual. A interface diferencia reversão completa e incompleta e atualiza a listagem quando restam recursos.
- Falha no histórico após a gravação não transforma sucesso em falha nem reinicia a página. O fluxo de importação mantém sua recuperação local.

## Validação executada

- `npm run test:host-import:core`: 83 testes aprovados (serviço, rotas, parsers/prévia e classificação de erros da API).
- `npx vitest run apps/backend/src/modules/hosts/host.service.test.ts`: 34 testes aprovados.
- Build de shared e typecheck de backend/frontend aprovados.
- Navegador: sucesso, duplicidade detectada pelo servidor, filtro de duplicados, confirmação por teclado, prévia expirada preservando dados, falha de registro com reversão completa/incompleta, histórico indisponível, CSV inválido e corrigido, resposta atrasada após edição. Download validado pelo evento do navegador e conteúdo do Blob, incluindo hostId.
- Regressão MobaXterm aprovada: dependências/bastions, PEM, pré-validações de conectividade, correções, reversão, modal em desktop e viewport móvel.
- API local isolada na porta 3117, com persistência real: criação de host direto e via bastion; correspondência de pasta/porta/usuário/associação; duplicados ignorados; atualização removendo bastion e mudando nome/pasta; reversão restaurando os dados anteriores. Recursos descartáveis removidos ao final. Evidência local: `/tmp/nodeaccess-host-import-live.json`.

## Repetir

Com o frontend local ativo (ajuste a porta):

```bash
FRONTEND_BASE=http://127.0.0.1:5190 npm run test:host-import:resilience:web
FRONTEND_BASE=http://127.0.0.1:5190 npm run test:mobaxterm-import:web
npm run test:host-import:core
```

O teste de persistência é opt-in e aceita somente API local. Exige ambiente de desenvolvimento, usuário administrador ID 1 e tenant ID 1 de teste e configuração local do backend. Cria registros temporários identificados por prefixo exclusivo e mantém os eventos de auditoria:

```bash
IMPORT_TEST_API=http://127.0.0.1:3117/api/v1 npm run test:host-import:live
```

## Limites

As falhas de rede e conectividade são simuladas no navegador; este ciclo não certifica acesso SSH a destinos externos. O teste real verifica o que foi persistido pela API e não abre sessões SSH. A matriz cobre os cenários descritos, não todas as combinações possíveis. Reversão incompleta exige revisão dos recursos indicados no resultado; não foi introduzida migração para persistir um novo estado de job de falha no histórico.
