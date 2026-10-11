---
change_id: NA-0054
title: Integrar o estado local validado e registrar revisões futuras
type: chore
status: ready-for-tests
created_at: 2026-10-10T22:33:41-03:00
base_branch: master
base_sha: c8c548210c3c9a94df6b95baa6326d41043815e4
branch: chore/NA-0054-20261010-integrate-local-stack
owner: jeferson
planner: Codex
risk: medium
---

## Contexto e situação anterior

Quinze frentes NA-0039 a NA-0053 estão encadeadas localmente em 17 commits.
Master remota contém merges adicionais mas tem a mesma árvore do ancestral
e833542. O estado final 5c43e1dd307fd941ac405786f3935a6e9930086a tem evidências locais próprias;
nenhuma alegação de CI remoto ou deploy deriva delas.

## Problema e objetivo

Publicar as branches, validar o conjunto final em CI, integrar por PR à master
e sincronizar a pasta Linux para continuar o desenvolvimento. Registrar as
demais revisões para depois, sem implementá-las nesta frente.

## Escopo

IN_PLAN: preservar todas as branches originais no remoto; consolidar sua árvore
final numa branch de integração por squash, com uma única identidade NA-0054;
mapear as origens; executar CI; integrar PR; sincronizar master; registrar backlog.
NECESSARY_CORRECTION: corrigir somente falhas que impeçam o CI/integração sem
enfraquecer asserts, desativar checks, ampliar permissões ou atualizar guacd.
Fora: deploy, produção, proteção da master, CSP, usuário de runtime, auditoria
histórica de segredos, upgrade guacd e otimizações adicionais.

## Critérios de aceitação

- [x] Quinze branches originais publicadas com os SHAs preservados.
- [ ] Árvore consolidada corresponde ao estado final mais plano/backlog e correções de CI justificadas.
- [ ] CI remoto aplicável aprovado no SHA final, sem bypass de checks.
- [x] Revisão independente do escopo e evidências registrada.
- [ ] PR integrado, master local e origin/master idênticas, workspace limpo.
- [x] Pendências futuras registradas sem alegar homologação de release ou deploy.

## Estratégia técnica

Squash de fix/NA-0053 sobre origin/master evita submeter versões intermediárias
incompletas como releases e mantém uma identidade de governança no PR de
consolidação. Commits originais permanecem nas branches publicadas. A entrega
NA-0054 comprova equivalência de conteúdo; não afirmar que os SHAs originais
passaram a ser ancestrais de master. Não reescrever nem excluir branches.

## Riscos e mitigações

O diff agregado é amplo e inclui segurança, stack e frontend já desenvolvidos.
Preservar o estado inicial, testar o resultado combinado e analisar cada falha
de CI. Somente a integração é autorizada; homologação humana de release e
produção permanece futura, conforme pedido explícito do usuário.

## Matriz de testes e evidências

CI: governança, lint/TypeScript, unitários, build, segurança, contratos e stack
conforme workflows disparados. Local: regressões dirigidas a correções de CI,
JIT/terminal da NA-0053 quando houver mudança relacionada. Evidências por SHA
em reports/NA-0054 e runs/artifacts GitHub. Skipped: deploy e homologação de release.

## Baseline

Base remota: c8c548210c3c9a94df6b95baa6326d41043815e4. Fonte local: 5c43e1dd307fd941ac405786f3935a6e9930086a.
NA-0053: nove checks locais aprovados, 446 testes frontend. Isso não substitui
os checks do conjunto consolidado na base remota. Árvore local limpa ao iniciar.

## Rollback ou recuperação

Reverter o merge do PR se necessário. As quinze branches originais e o backup
WSL/OneDrive mantêm os pontos anteriores. Nenhuma alteração de banco/produção.

## Aprovação

Decisão: GO_WITH_RISKS
Autorização explícita: usuário pediu publicação, CI e integração à master
fim a fim, deixando as outras revisões para depois. Merge autorizado após CI;
não equivale a homologação funcional de release ou autorização de deploy.

## Origem preservada

| Branch | SHA original |
|---|---|
| `chore/NA-0039-20261008-security-baseline` | `44e0b5ccdcf411414c37b3849a6627f7eac4c751` |
| `chore/NA-0049-20261009-local-consolidation` | `9be2f73ac28f5af8678c56849f704185ab9059a0` |
| `fix/NA-0050-20261009-wsl-dev-stack` | `79d0d10f66bb09dd50caa2fc24e716f73fd7755e` |
| `fix/NA-0051-20261009-forwardings-transition` | `164bbb489a29952c3b23c6c51fc33e8928720d6f` |
| `fix/NA-0053-20261010-jit-private-requests` | `5c43e1dd307fd941ac405786f3935a6e9930086a` |
| `performance/NA-0052-20261009-dev-resources` | `aed55fad68e5cf535f4573672ffc148951652fe7` |
| `security/NA-0040-20261008-webhook-cache` | `275c6d49618c00776ccd89143335ef57ea132eba` |
| `security/NA-0041-20261008-runtime-deployment` | `f5ba2c3cf5cad9aab56b2a5b50a255e3fc405d6f` |
| `security/NA-0042-20261008-stack-upgrade` | `4eeba69b26a2163d7ed5c95269e8e5df794286e9` |
| `security/NA-0043-20261008-resource-limits` | `f2108dc6d4275089447831ee146aa96d3eebee55` |
| `security/NA-0044-20261008-security-gates` | `b95bd85f8e678e36003a1e54d1c202993ffa2886` |
| `security/NA-0045-20261008-frontend-build` | `22daf4969f2b76df82d85579b03eab98792fc770` |
| `security/NA-0046-20261008-state-stack` | `6feebf13e98584efb3071a14024fd1a3755bf2c8` |
| `security/NA-0047-20261008-prisma-runtime` | `b0461d5b3423a42d2126ee55e3ddb03fd362536d` |
| `security/NA-0048-20261008-container-stack` | `de65fea9c327980e9ab2148a2be0147009a673bc` |

## Ampliação autorizada e baseline CI

Em 2026-10-10T22:41:14-03:00, o usuário escolheu explicitamente “Corrigir o lint e concluir a
integração” após ser informado de 869 erros/12.629 avisos em 220 arquivos.
IN_PLAN ampliado: corrigir todos os apontamentos do gate, incluindo formatação,
tipagem e callbacks, sem desativar regras. Preservar comportamento e validar
manual e regressões dos fluxos atingidos. Demais itens continuam no backlog.
Baseline: 1.849 testes passaram, 34 opt-in skipped; typecheck passou. Lint FAIL.
Primeiro commit/PR é candidato de integração em draft, com falha conhecida
explicitamente registrada, para executar CI e reunir todos os bloqueios. Não
autoriza merge antes dos checks aprovados no SHA final.


## Correções necessárias para os gates

- Lint: tipos explícitos, contratos de WebSocket/JSON/mocks, callbacks assíncronos,
  imports/declaracões sem uso e formatação Vue. Nenhuma regra foi desativada.
- Interface: SVGs constantes extraídos para componente; RichText restrito a tags,
  atributos e protocolos permitidos para manual/instruções. Removido ramo de
  status de IA local duplicado e inalcançável. Layout e estilos preservados.
- Testes: exports privados MobaXterm substituídos por fixtures sintéticas TEST-NET,
  mantendo cenários e dependências; três regressões adicionais de editId SFTP.
- CI: chave sintética do manual com 64 caracteres; fixture Windows ativa modo de
  laboratório explicitamente e restaura ambiente; harness TLS permite ao runner
  acessar somente seu socket descartável, mantendo modo 0660 e estado privado.

Validação do candidato antes do commit: typecheck integrado, 1.852 testes
aprovados (34 opt-in skipped), terminal completo, manual/cinco capturas,
compartilhamento em 60 estados, dois ciclos de tenant e oito grupos RichText.
Revisão independente PASS_WITH_WARNINGS: sem achado bloqueante, 35 testes próprios,
comparação do JavaScript emitido e dos templates/estilos. Gates definitivos devem
rodar no novo SHA, incluindo Windows/TLS no CI; este registro não os antecipa.
As evidências finais e o merge ficam no PR #33 e no relatório operacional externo,
evitando criar um novo commit apenas para declarar testado um SHA anterior.


## Atualização da base pelo usuário

Durante esta frente, o usuário integrou os PRs #34, #35 e #36. A master passou a
`b02c814` e sua árvore foi comparada com `5c43e1d`: nenhum arquivo diferente.
Essa master incorpora a cadeia original NA-0039–NA-0053. Ela foi incorporada à
NA-0054 por merge normal, sem rebase/force, preservando as correções locais.
A estratégia inicial de squash continua registrada como histórico, mas o PR #33
agora entrega as correções de lint/CI e a documentação sobre essa nova base.

O usuário também solicitou esclarecer as pastas e atualizar README/documentações.
Incluído no escopo: versões reais dos manifests, orientação de configuração nova
sem sobrescrever ambiente existente, papel do worktree e suporte/backup OneDrive.


Gates locais adicionais aprovados antes do commit: SFTP/editor/auditoria, Jira,
túneis (incluindo transição Vue), configurações de plataforma e compartilhamento/JIT.
O harness de configurações foi corrigido para clicar no wrapper que recebe o
clique externo do modal, mantendo a assertiva de fechamento sem force/dispatch.
Lint do conjunto e build completos passaram. Gitleaks: 42 fixtures públicas
revisadas, nenhuma ocorrência não revisada; Semgrep: nenhum achado/erro em 738
alvos. Três hashes de exceções exatas foram revalidados após mudanças nos arquivos
de teste/CI; nenhuma regra ou escopo do scanner foi relaxado.


## Ajustes após o CI do primeiro candidato

- Windows: os pacotes descartáveis de PR/workflow manual usam explicitamente o
  modo de laboratório existente. Tags `agent-v*` continuam exigindo assinatura;
  nenhuma validação de release ou publicação foi relaxada.
- Agente/UI: o cleanup aguarda o Chromium criado pelo próprio harness antes de
  remover seu perfil, com espera limitada e preservação do exit code do teste.
- TLS: confirmado `EPERM` no chmod de pastas de desafio criadas pelo UID do runner.
  A fixture agora cria essas pastas pelo worker, com os mesmos modos 0755/0644,
  reproduzindo a propriedade usada em produção. Nenhuma capability foi adicionada.

Os testes funcionais e os gates são repetidos no novo candidato antes do merge.


A segunda execução também revelou seletores ACL dependentes da ordem de menus
ocultos: o harness agora seleciona somente opções exatas no menu visível. Os
cenários host/folder passaram sem force, atrasos novos ou redução de assertivas.
O build MSI no CI passa a usar Windows PowerShell, como prepare-agents.mjs,
para encontrar o compilador .NET Framework utilizado pelo aplicativo de bandeja.
A pendência de distribuição assinada foi registrada em FUT-011 para antes da
release; esta frente não provisiona certificados nem publica instaladores.


O scan atualizado das imagens bloqueou a stdlib Go 1.26.8 do Docker CLI do
backend. Correção necessária ao gate: usar CLI oficial 29.9.0 compilado com
Go 1.26.9, fixado por digest, preservando integração de observabilidade.
A atualização do RPM OpenSSL no MySQL exigiu revalidar a correspondência exata
com a revisão FIPS anterior; fontes e limites em [image-triage.md](image-triage.md).
Mantidos algoritmo de bloqueio, expiração e achados brutos. Nenhuma mudança no
guacd ou nos containers de desenvolvimento em execução.


A fixture HTTP de atualização Windows também foi alinhada ao contrato de release
assinado: chave RSA3072 efêmera, confiança temporária real e cenários negativos
de assinatura ausente/inválida e metadados adulterados. Testes unitário e live
passaram no Windows PowerShell 5.1 local, incluindo Start-Job. Apenas a consulta
Authenticode dos bytes inertes é simulada na fixture; o código de produção e
suas exigências de confiança não foram modificados.
