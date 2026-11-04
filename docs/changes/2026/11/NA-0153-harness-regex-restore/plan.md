---
change_id: NA-0153
title: Remover backtracking e credencial reutilizada dos harnesses
type: fix
status: ready-for-tests
created_at: 2026-11-04T11:03:55-03:00
base_branch: fix/NA-0150-20261104-explicit-contracts
base_sha: 30e7f5e7925c10a48865c18fa7c6e93fef1ffa11
branch: fix/NA-0153-20261104-harness-regex-restore
owner: tooling
planner: tooling
risk: medium
issue: null
---

# NA0153 — Regexes lineares e segredo efêmero de restore

## Contexto e situação anterior
Revisão individual identificou três recomendações válidas: SQ0293/javascript:S8786 em container-stack-real.mjs206 (padding fingerprint); SQ0398/javascript:S8786 em recent-host-access-playwright.cjs98 (data/hora); SQ0306/secrets:S6697 em restore-mysql-isolated-harness.sh66 (senha real do MySQL descartável que recebe backup). Inputs de regex atuais pequenos mitigam impacto, sem invalidar recomendação. Senha fixa é efetivamente autenticável mesmo sem porta publicada.

## Problema e objetivo
Preservar asserções de fingerprint/data e comportamento do restore, removendo backtracking e reutilização de senha. Nenhum ajuste de produto, gate, baseline ou exceção de scanner.

## Escopo
Somente três ocorrências, helpers locais necessários e testes. Fonte removida SQ0456/0460/0520 seguirá reconciliação automática do scanner, não entra como novo fix. Não alterar política ANSI/CIDR, fixtures Gitleaks ou dados de backup. Não restaurar dados do usuário: ensaio exclusivamente dump sintético próprio.

## Critérios de aceitação
- [x] Padding mantém todos caracteres exceto sequência final de =, inclusive vazio e Unicode, com custo linear.
- [x] Data/hora mantém semântica da regex antiga (ano4dígitos seguido por hora2:2, mesma linha inclusive fronteiras CR/LF/U2028/U2029), sem afirmar validade calendárica adicional.
- [x] Senhas root/usuário distintas e randômicas por execução, compatíveis com env/Compose e MySQL, não impressas nem passadas em argv de processo host.
- [x] Env0600 em diretório privado validado; recusar symlink/arquivo preexistente ou diretório inseguro sem chmod de objeto alheio. Falha não remove alvos alheios.
- [x] Restore real em MySQL descartável usando dump sintético e cleanup próprio; credenciais antigas não autenticam, novas permitem restauração.
- [x] Contratos negativos/adversariais e revisão independente antes checkpoint.

## Estratégia técnica
1. Pequeno helper puro CJS em tools/shared/linear-harness-text.cjs para dois consumidores ESM/CJS, evitando importar scripts com side effects. Padding por índice final; data/hora por varredura linear ou duas buscas limitadas por linha com padrões de tamanho fixo. Justificativa da extração: contratos executam exatamente funções importadas, sem duplicar regra nem novo pacote.
2. Harness de restore gera dois segredos256bits via crypto Node (dependência Node explicitamente verificada; já disponível na ferramenta), helper dedicado gravando env com wx0600 em pai privado. Não serializar conteúdo em relatórios. Preservar DB/user nomes, imagem, dump e parâmetros; defaults criptográficos de outros componentes não usados pelo restore não entram neste escopo.
3. Revisar ordem de trap para que rejeição de diretório/symlink/arquivo preexistente não acione rm de caminho não possuído. Cleanup somente recursos próprios; preflight de projeto Docker evita atingir stack existente. TMP_ROOT override permanece suportado apenas quando diretório privado vazio/owned, com contrato documentado. Rede sem portas publicadas mantida.
4. Preferir client optionsfile privado no container a senha literal em argumentos mysqladmin/mysql onde necessário; secret no envfile/Dockerconfig local continua acessível ao administradorDocker, limitação explícita. Sem promessa de ocultação contra root.

## Riscos e mitigações
| Risco | Impacto | Mitigação | Parada |
|---|---|---|---|
| Regex divergir | Falso PASS/FAIL no harness | Diferenciais positivos/negativos/Unicode e input longo em child bounded | Divergência não explicada |
| Env privado rejeitar override legado | Harness falha antes Docker | Erro claro; documentar root0700/vazio; não chmod silencioso | Path alheio modificado |
| Cleanup afetar outro projeto | Destrutivo | Namespace próprio, preflight semcontainers, flagsowned e teste falhas | Qualquer alvo preexistente removido |
| Segredo vazar | Credencial legível | Nunca log/argvhost; assertions sanitizadas e arquivo0600 | Literal em stdout/stderr/hostargv |

## Matriz de testes e evidências
| Critério | Teste | Ambiente | Obrigatório |
|---|---|---|---|
| Regex | Diferenciais contra padrões antigos, controles3s, input longo100k | Node24.22.1 | sim |
| Credenciais | Unicidade/formato, modos, symlink/owner/nonempty, falha/cleanup/log | Node e shell com Dockerfake | sim |
| Restore | Dump sintético +MySQLisolado próprio sem portas externas +badpassword/newpassword | Docker, janela coordenada | sim |
| ConsumidorUI | recent-host-access Playwright real com API mock, sem mudançaUI | Chromium local | sim |
| Regressão | lint/syntax/governança e revisão independente | Worktree | sim |

## Baseline
Base30e7f5e7925c10a48865c18fa7c6e93fef1ffa11, worktree limpo antes docs. Probesreadonly anteriores: /tmp/NA0093-tooling-fp-probes.json mostram crescimento não linear nas2regex, não DoS externo. Baseline dos consumidores e restore ainda planejada; nenhuma fonte alterada nesta etapa.

## Rollback ou recuperação
Reverter checkpoint isolado, semmigração ou alteração de produção. Artefatos e containers descartáveis próprios removidos ao fim. Nenhum push/merge nesta tarefa.

## Mudanças de escopo e decisões
Raiz solicitou plano e GO antesfonte; credenciais semvalores emdocs. Necessidadescleanup limitadas ao harness para tornar contrato de privateenv verificável.

## Aprovação
- Decisão: GO_WITH_RISKS.
- Aprovado por: raiz, autorização explícita.
- Aprovado em: 2026-11-04.

Decisão da revisão: preservar scripts/backup/restore-mysql.sh de produção; senha pode ser vista por administradorDocker/processo no container, nunca plaintext em argvhost/log. Preflight verifica labels de containers, redes e volumes; namespace default randômico, sem alegar defesa contra administrador malicioso concorrente. Janela Docker exclusiva autorizada pela raiz.

Correção necessária adicional aprovada pela raiz: PEM_ENCRYPTION_KEY também gerada com32bytes aleatórios, pois restore-mysql.sh apenas verifica formato hex64 (linha64), não decripta dados. Script de produção permanece idêntico; a validação real comprova restauraçãoSQL, não leitura/descriptografia de credenciais restauradas. Allowance Gitleaks antiga será reconciliada pela raiz após scanner, nenhuma nova exceção.
