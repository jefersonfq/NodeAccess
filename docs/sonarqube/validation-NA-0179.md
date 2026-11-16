# NA-0179 — Validação e evidências

Base:31a9f3601874ea2d0fa474972dc01a07e35f94b6 (análises anteriores sobre89a8/c3). A frente acrescenta reveal/copy portal; não ativa tenants nem altera transporte de terminal.

Ran antes do commit:61testesbackend/adapterJWE,42estadoHTTP/views,13componente,20manual; typecheckbackend/frontend, lintfocal ebuildfrontendPASS. EnsaioHTTPS19,catálogo14 e terminal/snippetsPASS, com ressalva documental registrada no relatório; execução definitiva deve usarSHAcongelado.

ScannersegurançaPASS:42/42fixtures revisadas,Semgrep0/0. Duas ocorrências de placeholders PEM nas traduções foram revalidadas individualmente por revisor independente, semalterar marcadores, regras outhresholds. Correção pré-gate deHTTP passou a contar bytesdurante leitura; teste de cancelamentochunked garante teto efetivo.

`npm run validate:sonar` noSHAfinal: Planned. Nãohá exceção de código/regra ouredução de cobertura. Qualquerachado será registrado por ocorrência antes de declarar a frente pronta. Evidência definitiva deSHA/checks será vinculada na PR, evitando commitrecursivo de relatório.

## Gate reprovado e correções necessárias

Ran no candidato4611156: validação integral local terminou com análise verificada, mas FAIL por cobertura nova51,99% e oito achados; CI reproduziu o resultado. Todos os coletores passaram (4031Vitest,721Node,10Chromium), portanto a falha não foi tratada como aprovação. Evidência local: `.sonar-reports/validation-1794835596341-19f2fafe-2dac-40dd-a071-469df0472dca/validation.json`; relatório sanitizado CI da PR69/run43874725337.

O roteiro HTTPS passou a ser executado dentro de um worker Vitest, com remapeamento TypeScript real, restauração do ambiente e os limites internos preservados. Ran coleta completa diagnóstica4041PASS/0FAIL, helpers antes zerados agora cobertos; diferencial Vitest normalizado88,30%, sem arquivos ausentes. Esse percentual não substitui o gate combinado. Fontes refinadas depois para o proprietário PEM real e cenário HTTP; Planned: análise integral no commit final.

Ocorrências identificadas pelo CI em `tools/vault-security/frontend-harness.mts`; cada correção permanece sujeita à reanálise, sem exceções novas ou redução de thresholds:

| ID da ocorrência CI | Regra / linha anterior | Correção | Estado |
|---|---|---|---|
| `c0c7c6e3-9645-43a1-b9cb-ebbdd5d447c1` | typescript:S5443 / 24 | Diretório privado local conhecido, sem usar leitura de TMPDIR como caminho. | Corrigido no código; reanálise pendente |
| `d57b4f52-eb89-4eaa-beb7-c8da20677b3e` | typescript:S5443 / 24 | Diretório privado local conhecido, sem usar leitura de TMPDIR como caminho. | Corrigido no código; reanálise pendente |
| `365ccd4f-b4d6-49df-94d2-df2cb1aeabde` | secrets:S6697 / 26 | Credencial sintética gerada em runtime; destino isolado em loopback. | Corrigido no código; reanálise pendente |
| `9ab91ea9-9cb0-41f9-b2d4-479157177040` | typescript:S2871 / 31 | Comparador explícito nas ordenações. | Corrigido no código; reanálise pendente |
| `a4bcac5c-b4e3-4198-b2aa-88998723f8f6` | typescript:S4036 / 31 | Executável com caminho absoluto; sem resolução pelo PATH. | Corrigido no código; reanálise pendente |
| `756746b3-f001-4b19-95dc-1bfcceb05146` | typescript:S2871 / 35 | Comparador explícito nas ordenações. | Corrigido no código; reanálise pendente |
| `6e0d96f6-1479-49b4-ac7a-b13cc9c598f3` | typescript:S4036 / 40 | Executável com caminho absoluto; sem resolução pelo PATH. | Corrigido no código; reanálise pendente |
| `c9ff3a22-bec9-42bf-b9bb-fdbe7bc4c1d8` | typescript:S4036 / 49 | Executável com caminho absoluto; sem resolução pelo PATH. | Corrigido no código; reanálise pendente |

Nenhuma alteração em `accepted-findings.json`. Lint focal PEM encontrou sete diagnósticos no parser ssh2 preexistente, reproduzidos com HEAD; parser não foi alterado nem regras suprimidas. Typecheck detectou a suposição incorreta de User.username no adendo de proprietário; corrigida para User.name e validada com build compartilhado/typecheck backend e testes.

O CI f07 alcançou sete diagnósticos antigos do parser PEM porque o arquivo recebeu metadados. Adequação mínima de tipos, validação de retorno e remoção de cast redundante corrigiram o lint sem mudar o método/receiver/argumento da conversão legada. Ran14testesPASS, typecheckbackendPASS, lint:changed completoPASS; revisãoindependentePASS. Limitação PPK preexistente registrada separadamente, sem promessa de conversão real validada. A base31a9 contém apenas a revalidação independente de três sourceSha S1313 do teste SFTP; não houve exceção nova na baseline. Gates integrais no novo SHA permanecem Planned.
