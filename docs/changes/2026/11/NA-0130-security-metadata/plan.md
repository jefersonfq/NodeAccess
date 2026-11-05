---
change_id: NA-0130
title: Identificar metadados públicos e revisar fixtures de segurança
type: fix
status: in-development
created_at: 2026-11-03T21:34:22+00:00
base_branch: chore/NA-0093-20261103-sonar-delivery
base_sha: 8dae9b49a8dab89b9c0a7c4fcb4a29a1d401662d
branch: fix/NA-0130-20261103-security-metadata
owner: NodeAccess
planner: Codex
risk: low
---

# NA-0130 — Metadados públicos e fixtures

## Contexto e situação anterior

Gitleaks da PR identificou 1268 ocorrências; 40 fixtures já reconhecidas e 1228 ainda sem revisão compatível. Semgrep sem achados/erros. Maioria é ID público de achado Sonar em campo ambíguo key.

## Problema e objetivo

Distinguir metadados de credenciais sem enfraquecer políticas ou suprimir UUIDs globalmente.

## Escopo

JSONs públicos do inventário/disposições/evidências, fronteiras dos writers/readers ledger e harness; hashes documentais representados por file/sha256; revisão individual de sete fixtures isoladas. Nenhuma alteração funcional do produto.

## Critérios de aceitação

- [x] IDs, ordem e hashes preservados; leitura legacy e conflito testados.
- [x] Novas saídas públicas usam issueId; identificação real do achado preservada.
- [x] Exceções somente regra/linha/hash com racional individual.
- [x] Gitleaks e Semgrep reais aprovados; revisão independente.

## Estratégia técnica

Normalizar identificador apenas nas fronteiras dos metadados; manter objetos da API Sonar internos intactos. Migrar documentos explicitamente identificados. Não alterar configuração dos scanners.

## Riscos e mitigações

Consumidores legados: leitura aceita key; formato público atualizado documentado. Rejeitar duplicidade conflitante. Scan real completo confirma demais matches; não adicionar exceções por categoria.

## Matriz de testes e evidências

Planned: contratos legacy/new/conflito, CLI ledger, invariância documental, harness DOM e scans reais. Artefatos privados não expõem matches.

## Baseline

SHA 8dae9b49a8dab89b9c0a7c4fcb4a29a1d401662d; lista sanitizada privada do job security. IDs SQ e Sonar preservados.

## Rollback ou recuperação

Reverter commit da frente; sem banco ou configuração de produção. Schema JSON 1 preservado com migração compatível de leitura documentada.

## Aprovação

Decisão: GO_WITH_RISKS. Usuário autorizou todos os achados; raiz aprovou escopo mínimo e política intacta.
