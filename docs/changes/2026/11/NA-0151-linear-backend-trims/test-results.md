# NA-0151 — Evidência local

Base `02e7521cbe69e72cb5c8c3f5f951dcdc6e1c5fec`; worktree `/tmp/nodeaccess-NA-0151`. Node24.22.1. Sem scanner, VPS, SSH autenticado ou MySQL real nesta frente.

- Baseline227/4 PASS; suite final247/5 PASS: normalizer, gateway diagnostics, trial service, provider contract e controller download novo.
- Controller real verifica filename/report e tenant/user/role com serviço/reply simulados. Inclui200k hífens e corte60 após trim.
- Prompt:1600 combinações válidas de prompts/brackets/Unicode whitespace e entradas200k; guarda original mantida.
- Chave SSH sintética existente: fingerprint conhecido com43caracteres base64 e sempadding preservado; bannerdiagnostics usa listener real loopback sem autenticação.
- Provider real com fetch simulado: aceita43base64 com zero/um padding; entradasmalformadas são rejeitadas antes de retornar laboratório (caso100k também encontra limite de resposta32KiB). TrialService real com repositório modelado persisteum padding emambosformatos; não prova SQLreal.
- Probe source-extracted:10080 equivalências contra base e12casosadversariais200k em subprocesso comdeadline3s PASS. `node docs/changes/2026/11/NA-0151-linear-backend-trims/probe.mjs .`. Registra limites em evidence/differential.json. Não é prova universal por fuzz nem exploit E2E.
- Lint legado: baselinehost-key tinha10errors any; controller10warnings de retorno. Correções de tipos autorizadas pela raiz, sem regras suprimidas. Emissão JS byteidêntica antes/depois dessas anotações, mantendo as alteraçõesregex separadas (evidence/type-emit.json).

Contrato padding: TrialMachines faz labSchema.parse diretamente; TrialService recebe TrialProvisioner; único provisioner produtivo é HttpTrialProvisioner (trial-runtime.ts) e valida labSchema. Não prometemos equivalência para provedores customizados que violem esse contrato, nem alteramos o esquema aceito. MySQL opt-in não foi executado; comparação/persistência de TrialMachines também verificada no probe extraindo os dois trims reais.

Revisão independente frontend:247/247 e10080+12 reproduzidos PASS_WITH_WARNINGS; raiz também reproduziu10080+12. Lint10arquivos0/0 e backendtypecheck PASS; checkpoints no diário. Sonar integrado é responsabilidade da raiz; nenhum alerta marcado automaticamente como resolvido ou FP. Homologação/publicação e atualização planilha2027 não inferidas de testes.
