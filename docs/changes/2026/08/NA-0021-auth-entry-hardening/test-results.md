# NA-0021 — Resultados de teste

Data: 2026-08-11

## Executado

- HMAC e ausência de valores brutos nas chaves: aprovado;
- limites por IP, tenant e identidade: aprovados;
- mensagem pública uniforme 429: aprovada;
- falha de transação e falha de TTL: rejeitadas;
- redaction de URL, fragmento, body, claims e erros: aprovada;
- Google e logout limitados antes da autenticação/revogação: aprovados;
- matriz de regressão de autenticação: 60 testes aprovados em 8 arquivos;
- typecheck backend: aprovado;
- `git diff --check`: aprovado.

## Risco residual

O fluxo email-first revela somente tenants ativos cuja política permite
descoberta. Isso é necessário para o picker atual e permanece protegido por
limites de IP/identidade. Instalações ou tenants mais restritivos podem manter a
descoberta desabilitada.
