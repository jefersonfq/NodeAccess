---
change_id: NA-0070
title: Preservar origem assinada durante prune do backend
type: fix
status: ready-for-tests
created_at: 2026-10-24T16:43:55-03:00
base_branch: master
base_sha: fcad4cb041497ae1c508cd33b151c5405940ae1f
branch: fix/NA-0070-20261024-release-lock-provenance
owner: Codex
planner: Codex
risk: low
---

# NA-0070 — Origem assinada no build Docker

## Contexto e situação anterior

NA-0069 integrada pelo PR47, master sincronizada; código cfc00b7 passou nos
checks. Empacotamento oficial parou no validador dos agentes dentro do Docker.
Fora do Docker, os mesmos artefatos assinados passam.

## Problema e objetivo

npm prune modifica dev/devOptional de magicast no lock raiz. É o único dos48
arquivos de origem com hash diferente; não houve mudança no agente. Preservar o
lock canônico usado para compilar e assinar sem alterar a poda das dependências.

## Escopo

Correção localizada em docker/backend.Dockerfile, prova real de identidade no CI
e evidência operacional. O gate de CI anterior usava runtime sem agentes e não
exercitava esta comparação; a prova do builder cobre a regressão sem chave privada.
Nenhuma alteração em validação, assinaturas, autenticação ou código do agente.
Continua a entrega2.1.0 autorizada pelo usuário, incluindo pacote e implantação.

## Critérios de aceitação

- [x] Os48 hashes da origem coincidem no builder após prune.
- [x] O estágio prod valida os agentes Windows/Linux/macOS assinados existentes.
- [x] Dependências de desenvolvimento continuam removidas; runtime e scanner passam.
- [ ] Empacotador oficial gera pacote com origem limpa e checksums válidos.

## Estratégia técnica

Salvar lock em temporário próprio antes de npm prune e restaurá-lo após sucesso.
Preservar node_modules podado e seu lock interno; não relaxar fingerprint.

## Riscos e mitigações

Restaurar somente o lock raiz, nunca node_modules. Interromper build se prune ou
restauração falharem. Artefatos já assinados não são regenerados para contornar erro.

## Matriz de testes e evidências

Ran: reprodução real no builder e comparação dos48 hashes; divergência exclusiva
do lock. Planned: rebuild, hash, validação assinada, runtime, scanner, empacotador.
CI obrigatório no novo SHA antes do merge. Não inferir homologação humana.

## Baseline

Base fcad4cb041497ae1c508cd33b151c5405940ae1f. Build anterior falhou somente no
fingerprint de origem; pacote incompleto preservado em diretório exclusivo.

## Rollback ou recuperação

Reverter por PR. Nenhuma mudança de banco. Produção ainda antiga, fora de manutenção.
Volumes/imagens/configuração e fonte original continuam preservados.

## Mudanças de escopo e decisões

NECESSARY_CORRECTION da entrega autorizada: usuário autorizou correções, commits,
integração e implantação. Revisão independente confirmou causa e abordagem GO.
