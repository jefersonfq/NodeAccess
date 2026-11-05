---
change_id: NA-0129
title: Restaurar build guacd com pacote FreeRDP disponível
type: fix
status: implemented_local
created_at: 2026-11-03T19:05:36-03:00
base_branch: integration/NA-0093
base_sha: 8dae9b49a8dab89b9c0a7c4fcb4a29a1d401662d
branch: fix/NA-0129-20261103-guacd-freerdp
owner: equipe NodeAccess
planner: Codex
risk: medium
---

# NA-0129 — FreeRDP do guacd

## Contexto e situação anterior
PR59 upgrade-restore falhou porque o repositório Alpine substituiu freerdp-dev3.32.1-r0 por3.32.2-r0.

## Problema e objetivo
Restabelecer build reproduzível dentro dos pins existentes e verificar runtime compatível, sem reduzir política de segurança.

## Escopo
Pin mínimo FreeRDP, documentação guacd e evidências. Extensão autorizada após scanner: corrigir Critical real glib com pacote oficial estável corrigido, por checksum e assinatura, sem repositório edge global. Sem VPS, npm, scanner Sonar ou alterações de aplicação.

## Critérios de aceitação
- [x] Confirmar versão pelo índice APK oficial autenticado.
- [x] Build Docker real e dependências runtime coerentes.
- [x] Guardas de imagem e compatibilidade aplicável passam.
- [x] Checksums, digest da base e política estrita preservados.

## Estratégia técnica
Consultar metadados oficiais atuais, atualizar apenas pin removido, construir imagem isolada e verificar versão, bibliotecas e guacd.

## Riscos e mitigações
Misturar um APK específico de edge com base estável pode afetar ABI; inspecionar dependências, simular transação sem upgrades amplos, conferir fonte upstream corrigida e repetir plugins/scanner. Preferir backport estável se disponível.
Repositório APK é mutável; pin exato falha fechado quando removido. Patch FreeRDP pode alterar comportamento; executar build e provas locais, registrar limites de RDP sem host Windows real.

## Matriz de testes e evidências
Planned: apk policy, build real, runtime nonroot/versões/dependências, guards imagem, scanner de imagem existente e contratos gráficos.

## Baseline
Base8dae9b49a8dab89b9c0a7c4fcb4a29a1d401662d; falhaCI /tmp/NA0093-github-logs/126230707256.log. Página pública Alpine em cache ainda mostra versão antiga; índice assinado atual é necessário.

## Rollback ou recuperação
Reverter commit restaura configuração anterior, mas reintroduz indisponibilidade do pacote. Nenhum dado alterado.

## Aprovação
Decisão: GO_WITH_RISKS. Usuário autorizou concluir entrega/CI; raiz atribuiu atualização mínima e build real isolado. Commit local autorizado.
