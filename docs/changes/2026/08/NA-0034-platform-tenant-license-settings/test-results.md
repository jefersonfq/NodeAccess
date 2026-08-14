# NA-0034 — Resultados de teste

Data: 2026-08-14

- contrato e autorização de settings: 9 testes aprovados;
- bloqueio de autoelevação do admin do tenant: aprovado;
- quotas abaixo do consumo atual: bloqueadas para usuários e hosts;
- dependências de entitlements: providers e IA normalizados no servidor;
- auditoria de alteração de contrato: aprovada;
- typecheck backend: aprovado;
- typecheck frontend: aprovado;
- build frontend de produção: aprovado (aviso preexistente de chunk grande);
- Playwright Chromium headless: aprovado;
- Playwright conectado por Chromium CDP: aprovado;
- matriz UI: admin do tenant e superadmin, rota direta, visibilidade, edição,
  confirmação, persistência e releitura: aprovada;
- regressão completa: 597/598 testes aprovados; a falha funcional remanescente
  e preexistente e depende de bind TCP bloqueado pelo sandbox (`listen EPERM`);
  tres suites adicionais nao coletaram por variaveis obrigatorias ausentes nos
  proprios testes, fora dos arquivos desta entrega;
- `git diff --check`: aprovado.

O `lint:changed` do branch-base inclui dívida preexistente de outras frentes e
não fornece baseline limpo para este change. Os arquivos desta entrega foram
validados por typecheck e pelos testes direcionados acima.
