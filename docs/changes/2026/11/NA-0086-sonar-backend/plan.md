---
change_id: NA-0086
title: Remediação SonarQube backend shared agent
type: fix
status: ready-for-review
created_at: 2026-11-03T14:15:00-03:00
base_branch: chore/NA-0085-20261103-sonarqube
base_sha: 3aa5513789d63ef24b3e268c5f2077fde7db616e
branch: fix/NA-0086-20261103-sonar-backend
owner: equipe NodeAccess
planner: Codex
risk: medium
---

# NA-0086 — Remediação SonarQube backend, shared e agent

## Contexto e situação anterior

Baseline SonarQube atribuiu 98 ocorrências a esta frente. Há constantes de política/protocolo deliberadas, regex com backtracking e escritas em diretórios temporários. Exportação TXT sob cobertura apresentava timeout com stdout fragmentado.

## Problema e objetivo

Tratar todas as ocorrências de forma verificável, preservando segurança, semântica e contratos, em checkpoints locais reversíveis. Não confundir revisão contextual com eliminação de alerta ou aprovação do gate.

## Escopo

Backend, shared, testes do agente e documentos desta frente. Fora: frontend, configuração Sonar, planilha e publicação; ficam coordenados pela frente raiz.

## Critérios de aceitação

- [x] 98 disposições individuais com justificativa e evidência.
- [x] Correções com suites backend/shared e builds; casos adversariais e de concorrência.
- [x] Sem reduzir thresholds ou aumentar timeout.
- [ ] Revisão independente e reanálise integrada.
- [ ] Gate global de cobertura aprovado: permanece abaixo dos limites.

## Estratégia técnica

Cinco lotes: storage/scripts; scanners de URL/JSON/templates; auditoria; SFTP/SCIM/números; documentação e teste de política do agente. Cada commit possui até cinco correções lógicas. Sem push/deploy ou marcação de falso positivo no servidor.

## Riscos e mitigações

Storage exige mesmo UID API/gateway e raiz dedicada; rejeita symlinks e escrita por terceiros. Aperta 0755 para 0700 sem mover dados. Artefatos remotos usam nonce criptográfico decimal aprovado e criação exclusiva; retry exige novo preparo/aprovação. TACACS mantém MD5 por interoperabilidade e exige rede protegida. Detalhes em implementation.md.

## Matriz de testes e evidências

Ver test-results.md: 1.958 testes backend/shared passaram, 120 opt-in ignorados; cobertura falhou o gate 70/70/60. Upload adicional nonce/repetição: 3 testes. Agent: 7 testes. Builds shared/backend passaram. Sem UI alterada; screenshots não se aplicam. OpenSSH descartável em Docker local validou upload SFTP real; nenhum host de usuário foi acessado.

## Baseline

SHA `3aa5513789d63ef24b3e268c5f2077fde7db616e`. Node 24.21.0. Worktree `/tmp/nodeaccess-NA-0086`. Diretórios e permissões operacionais não foram alterados em VPS. Dependência shared resolvida no worktree com link local ignorado, sem mudar o node_modules canônico.

## Rollback ou recuperação

Reverter lotes em ordem inversa. Sem migração de banco. Permissões 0700/0600 aplicadas em runtime não são revertidas automaticamente. Destinos novos continuam numéricos e são aceitos pelo validador legado; consumidores usam o caminho persistido.

## Aprovação

Decisão: GO_WITH_RISKS para implementação e commits locais autorizados pelo usuário. Não significa homologação humana, aprovação de gate ou deploy. Riscos residuais, cobertura e revisão independente registrados.

## Organização dos checkpoints

Lotes reversíveis, com até cinco correções lógicas por commit:

1. Storage privado/atômico e criação exclusiva de artefatos SSH antes da aprovação.
2. Scanners lineares para URLs, cercas JSON e variáveis de links.
3. Normalização de auditoria e custo de stdout fragmentado.
4. Máscara SFTP, validação SCIM e simplificações numéricas.
5. Disposições, evidências e teste da política padrão de listeners.
