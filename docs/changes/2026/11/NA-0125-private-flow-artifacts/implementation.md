# NA-0125 — Implementação

## Pedido e objetivo

Corrigir novo achado S5443 sem exceção à análise.

## Implementação

SHA base: 78d4a5c4ce55d23af79412184afec30883a3f6a8. Reutilização do helper privado existente.

## Validação

Ran: seis contratos Node PASS, incluindo rejeição de diretório público e symlinks do diretório/relatório antes do navegador, preservando canário e permissões. Chromium real: seis grupos de cenários PASS, quatro labels com foco e sete ações mobile presentes/dentro do viewport, sem pageerror. Destino padrão 0700 e relatório 0600 verificados. ESLint dos dois arquivos sem erros/avisos. Revisão independente reproduziu três negativos, PASS_WITH_WARNINGS.

Limites: helper usa lstat em runtime confiável; não garante exclusão de corrida contra outro processo do mesmo UID. API do browser simulada e Chromium1234 local.

## Recuperação

Reverter mudança do harness. Preservar evidência privada.

## Pendências

Integrar e repetir scanner para confirmar ausência do achado; não ampliar baseline aceita.

## Diário de interações

### 2026-11-03T21:34:22+00:00 — Achado confirmado

Reanálise integrada confirmou um novo achado no caminho temporário fixo. Escopo pontual definido antes da edição; sem mudança de produto.

### 2026-11-03T21:38:54+00:00 — Reutilização validada

Removidos mkdir recursivo e caminho público fixo do executável. Todos os destinos usam artifactPath; preflight ocorre antes do lançamento do browser. Ensaios e negativos acima aprovados; fonte de produto intacta. Próximo passo: integração e reanálise.
