# NA-0137 — Validação

Baseb76faaec6031f3ebed1372a65dcede08f930cde0; checkout /tmp/nodeaccess-NA-0137.

- Ran: todos workflows parseados sem erro; 12 alterados, 20setup-nodepins24.22.1, 17stepsnpm12.2.1 preservados. Comparação YAML estrutural com base aceita somente versãoNode/digestCSP. /tmp/NA0137-validate.cjs e yaml-validation.json.
- Ran: três mudanças de tag blackbox exatamente, sem diferença restante no arquivo; .nvmrc24.22.1; package.json/engines intocados.
- Ran: ESLint do provider.blackbox.test.mjs zero erros/warnings e diff-check limpo.
- Ran: sob Node24.22.1 oficial, 23 contratos PASS e 1blackbox opt-in SKIP (TRIAL_PROVIDER_REAL=0), incluindo image-policy, provider e ci-policy; /tmp/NA0137-tests.log. Sintaxe blackbox, YAML/invariância e lint reexecutados nesse runtime PASS.
- Evidência atribuída à NA0136: digest OCI06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 confirmado via DockerHub imagetools; runtime24.22.1/OpenSSL3.5.9 e testes DNS/TLS/Brotli executados pelo agente backend. Não reexecutei builds/scanners de imagem.
- Ran: revisão independente tooling PASS_WITH_WARNINGS; reexecutou YAML/invariância e 23contratosPASS+1opt-inSKIP sob24.22.1 (/tmp/NA0137-independent.log). Sem Docker/scanner/npmci pelo revisor. Planned: gates integrados da raiz.
- Skipped: provider blackbox real com Docker/iptables; mudança é somente tag e não exige manipular redes reais nesta frente.

## Referência e limites

[Release oficial Node24.22.1](https://nodejs.org/en/blog/release/v24.22.1/) confirma correçõesBrotli/DNS/TLS e demais correções de segurança. SeveridadeBrotli upstreamHigh e atribuiçãoCritical do Grype são fontes distintas; não modificar política para contornar achados.

Parsing/lint iniciais usaram runtime24.21.0; ambos reexecutados sob24.22.1 com êxito. Binário oficial disponibilizado e checksum verificado pela raiz: /tmp/na0093-node-runtime/node-v24.22.1-linux-x64/bin/node. Não afirmar launcherWSL externo atualizado. RerunCI integrado e três hashes exatos de fixturesworkflow permanecem com a raiz; configuração funcional engines não é recomendação de segurança.

Seleção isolada confirmada: Node v24.22.1 e npm12.2.1 com PATH npm12 antes do diretório Node oficial; nenhum default global alterado.
