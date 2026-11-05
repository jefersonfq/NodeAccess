# Reconciliação Sonar — revisão adicional parcial, sem transições

Data: 04/11/2026. Escopo: proposta NA0145 em `review.json` (294 ocorrências:242 false_positive,43 risk_acceptance_required,7 fix_required,2 insufficient_evidence). Esta revisão não modifica essa tabela, baseline, checkpoint NA0149 ou estado do servidor. É contribuição documental para integração pela raiz em `docs/changes/2026/11/NA-0149-tooling-boundaries/review-reconciliation.md`.

## Resultado

**Não autorizar fechamento coletivo das242 propostas de falso positivo.** Foram identificados12 casos que precisam de reclassificação ou decisão explícita de política antes de qualquer transição: dez S2871 das ferramentas e dois S7737 (um tooling, um agent). A leitura anterior confundia ausência de exploração com inaplicabilidade de recomendação de manutenção nesses casos. O restante não foi certificado coletivamente por este relatório.

A investigação consultou por GET as definições efetivamente instaladas em `/api/rules/show`, com token de revisão mantido somente em memória. Nenhum segredo foi impresso e nenhum POST/transição foi realizado. Snapshot local `/tmp/NA0149-rule-definitions.json`, SHA256 `41edcb4e6f918ae77b97139d68eafb3ff33b5e85571cfdff63608d34d7538be6`. Não inferir a versão do analisador instalado a partir de releases upstream.

## Bloqueadores concretos: objeto padrão não é automaticamente falso positivo

| ID | Fonte revisada | Proposta antiga | Conclusão adicional / proposta |
|---|---|---|---|
| SQ-0404 | `tools/frontend/session-command-policies-playwright.cjs:69` | false_positive | S7737 detecta corretamente default de viewport inteiro. A função real recebe `{width:800}` e repassa viewport sem height. Todos os chamadores atuais omitem viewport; isso limita exposição, mas não invalida a recomendação. Propor melhoria P3 com defaults por campo e teste de omitido/completo/parcial; se manter contrato de objeto completo, registrar decisão de estilo/contrato, não afirmar falso positivo por ser harness. |
| SQ-0001 | `apps/agent/src/local-listeners.js:8,15` | false_positive | Omissão da política nega a abertura; `{}` substitui o default e causa TypeError antes da resposta, mantendo zero listeners. Não é bypass de autorização demonstrado. Entretanto, o cenário de substituição de propriedade existe, mesmo com apenas uma capacidade. Propor melhoria P3 de default por campo com negação segura ou validação explícita da política obrigatória. Não atribuir P1/DoS remoto sem fronteira demonstrada. |
| SQ-0031 | `apps/backend/src/modules/network-access/tacacs-server.ts:7`; consumidor `tacacs-main.ts:21` | risk_acceptance_required | Classificação já evita o erro: recomendação válida, objeto parcial pode eliminar limites; consumidor atual usa defaults completos. Manter pendente de decisão/correção, sem converter a FP apenas pelo tipo TypeScript. |

Prova focal executada: `/tmp/NA0149-default-object-probe.cjs` e `/tmp/NA0149-default-object-probes.json`. Classe LocalListeners real e função newPage extraída da AST original; a função para antes de abrir browser. Resultado: política omitida→negação normal/zero listeners; política vazia→TypeError/zero listeners; viewport omitido→width1440/height presente; width isolado→height ausente. Nenhum socket/browser foi iniciado.

A regra instalada S7737 descreve substituição total do objeto e manutenção de defaults por propriedade. A justificativa anterior de SQ0404 sobre não trocar objeto por escalar não responde ao problema real. Referência primária complementar: [unicorn/no-object-as-default-parameter](https://raw.githubusercontent.com/sindresorhus/eslint-plugin-unicorn/main/docs/rules/no-object-as-default-parameter.md).

## Bloqueadores concretos: comparador explícito e ordenação canônica

A definição instalada S2871 recomenda comparador também para strings, por ordenação Unicode/localização. Logo, demonstrar que a lista contém strings é necessário para entender semântica, mas insuficiente para declarar a recomendação falsa. Estes dez casos foram inspecionados anteriormente e reconfrontados com a regra instalada:

| ID | Fonte da revisão NA0145 | Ordem efetiva e proposta localizada |
|---|---|---|
| SQ-0265 | `scripts/change-governance-lib.mjs:63` | Caminhos de planos; tornar explícita a comparação UTF16 se esse for o contrato desejado. |
| SQ-0274 | `scripts/deploy/runtime-permissions.mjs:32` | Nomes retornados por readdir, usados em inventário; manter ordem determinística sem introduzir locale dependente do host. |
| SQ-0275 | `scripts/lint-changed.mjs:21` | Caminhos existentes de arquivos selecionados; comparador explícito preserva conjunto/ordem atual. |
| SQ-0280 | `scripts/release/release-provenance.mjs:23` | Caminhos das entradas do manifesto; não mudar serialização/hashes sem prova de compatibilidade. |
| SQ-0282 | `scripts/release/release-provenance.mjs:59` | RepoDigests textuais; comparador explícito pode preservar a ordem canônica atual. |
| SQ-0285 | `scripts/trial-lab/provider.mjs:101` | Chaves do objeto comparadas a conjunto exato; preservar ordenação do conjunto esperado. |
| SQ-0286 | `scripts/trial-lab/provider.mjs:156` | Nomes de capabilities comparados à política; não usar ordenação humana que modifique o contrato do conjunto. |
| SQ-0287 | `scripts/trial-lab/provider.mjs:161` | Chaves de mounts; explicitar ordem do conjunto sem alterar caminhos permitidos. |
| SQ-0506 | `tools/session-audit/reconstruction-sql-review.mts:137` | Hashes seguidos de reverse/slice; preservar seleção e ordem exatas da consulta/revisão. |
| SQ-0530 | `tools/tls/manager.mjs:15` | Chaves alimentam digest de requisição; alterar ordem pode quebrar replay/idempotência. Comparator com relação `<`/`>` sobre strings preserva ordem de unidades UTF16 existente, sem depender de locale. |

Proposta para os dez: `fix_required` de manutenção P3 ou decisão explícita de política para ordem canônica; **não transicionar automaticamente para falsepositive**. Se corrigir, usar comparador que expresse a ordem requerida e testes diferenciais com ASCII, acentos compostos/decompostos, maiúsculas, números em strings, paths e hashes. Não aplicar `localeCompare` indiscriminadamente em digest/replay: seria alteração semântica além da recomendação de explicitar comparação.

Há mais cinco S2871 propostos FP no domínio frontend (SQ0137/0138/0139/0140/0144). Foram apenas localizados no catálogo, não revisados nesta rodada; exigem avaliação equivalente de contrato pelo responsável, sem herdar conclusão dos casos tooling.

## Candidatos com sustentação técnica mais forte — ainda sujeitos a remapeamento

- SQ0284 e SQ0531 (S7059): `Promise.resolve()` sem argumento inicia uma cauda já resolvida; o construtor não aguarda I/O nem retorna promessa em vez da instância. Consumo via serial/save é posterior. Isso contradiz o problema descrito pela regra, ao contrário de uma preferência de estilo. Proposta FP tecnicamente sustentada no trecho, não aprovação coletiva de todo construtor.
- SQ0359/0360/0361/0415 (S2189): contador e limite explícitos encerram laços mesmo sem condição de mock; revisar igualdade do trecho após integração. A alegação de loop infinito não se sustenta nesses pontos.
- S3403 de branches de falha variáveis/require.main: há atribuições e modos reais distintos; a prova precisa apontar esses call sites, não apenas afirmar que é teste.
- SQ0510–0514 (S6324): bytes representam teclas de controle deliberadas do protocolo de terminal. Removê-los alteraria reconstrução; não são caracteres invisíveis acidentais. Preservar evidência por offset da ocorrência.
- IPs/credenciais de fixtures: elegibilidade depende de comprovar interceptação/isolamento e ausência de segredo operacional, por ocorrência. O nome de arquivo test/harness sozinho não basta.
- Regex sobre SHA256/base64: a fonte criptográfica impõe tamanho limitado; justificar por esse limite, não pela ausência de exploração observada.
- Permissões ACME públicas: nonce foi feito para publicação HTTP; diretórios e outros conteúdos exigem análise separada. Não transformar todo modo0644/0755 em FP por analogia.

## Proveniência e hashes: condição obrigatória antes de transições

`source-verification.json` da NA0145 confirma revision ee436 e igualdade dos294 IDs abertos na análise de04/11/2026. Não é prova de igualdade dos arquivos em candidatos posteriores. `review.json` aponta sourceSha ee436; os arquivos originais podem ser recuperados de Git para verificar trechos, mas os novos commits146–149 exigem export/reanálise novos.

No checkpoint NA0149,20 das89 propostas tooling FP têm **arquivo componente alterado**, embora vários trechos sejam semanticamente iguais: SQ0265,0275,0280,0281,0282,0294,0295,0347,0456,0459,0460,0461,0462,0464,0500,0501,0502,0520,0530,0531. A comparação foi de bytes `git show <sourceSha>:<file>` versus arquivo do checkpoint; não se inferiu que todos os20 achados mudaram. SQ0456, por exemplo, deixou de usar o regex anterior no novo helper SSH: se desaparecer no scanner, deve ser resolução por código, não marcação manual FP.

## Checklist para reconciliação individual

1. Análise concluída no SHA final, export com proveniência confirmada e nenhuma alteração de fontes durante scanner.
2. Unicidade de id/issueId, regra, componente e assinatura; alinhar linha atual/textRange, não depender da linha antiga.
3. Comparar trecho e consumidores com o arquivo da análise que originou o parecer; se mudou, reavaliar ou aguardar reanálise.
4. Ler a intenção da regra instalada. Distinguir segurança, bug lógico, manutenção e estilo; ausência de exploit não invalida regra de manutenção.
5. Registrar prova positiva de inaplicabilidade, limites do input e validação realmente executada. Tests PASS não demonstram ausência do problema por si só.
6. Se achado sumiu após correção, preferir resolução automática do scanner; não mascarar como FP.
7. Se recomendação é válida mas será mantida, decisão humana explícita de aceitação/contrato; classificação técnica do relatório não concede essa aprovação.
8. Transições apenas em lista revisada, com justificativa individual e estado anterior/novo verificável. Não alterar baseline aceita como substituto de corrigir ou revisar.
9. Os43 riscos operacionais e os casos de acessibilidade/AT pendentes continuam fora de qualquer fechamento FP automático.

## Limites desta rodada

Revisão parcial, não certificação dos242. Priorizei89 registros tooling, regras suspeitas e os três S7737 existentes em todos os domínios. Definições de seis regras foram lidas na instância local; dois contratos de objeto parcial foram reproduzidos. Não executei suites amplas, browser, scans, transições ou mudanças de código. A decisão final continua com a raiz/humano responsável.

## Delta final NA0148

Leitura independente adicional confirmou que hint e botão Retomar agora exigem status connected. Não houve mudança dos handlers desde a revisão38/38PASS; parecer PASS_WITH_WARNINGS mantido. O novo cenário browser closed/zero-envio pertence à evidência do autor. A garantia de blur continua DOM, não Alt-Tab/window.blur/visibilitychange.
