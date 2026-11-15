---
change_id: NA-0081
title: Habilitação de auditoria, IA e MCP na VPS
type: fix
status: tests-passed
created_at: 2026-10-29T19:40:04-03:00
base_branch: master
base_sha: f4a44b4b7ae87a8f688b1246d9e52a31f9a104bc
branch: fix/NA-0081-20261029-session-audit-config
owner: root
planner: root
risk: medium
---

## Contexto e situação anterior
Usuário relatou ausência de novas auditorias na VPS e solicitou validação. Diagnóstico inicial somente leitura; em interação posterior usuário autorizou habilitar os recursos e reaplicar a instalação.

## Problema e objetivo
Restaurar auditoria e habilitar os recursos de IA e MCP solicitados, preservando dados, versões e configuração existente.

## Escopo
Ativar FEATURE_SESSION_AUDIT, FEATURE_SESSION_AUDIT_AI_SUMMARY, FEATURE_SESSION_AUDIT_AI_AUTO_SUMMARY, FEATURE_LOCAL_AI e FEATURE_MCP; preservar FEATURE_NATIVE_SSH_GATEWAY=true. Atualizar somente configuração persistente efetiva e fonte env correspondente; reaplicar API e gateway com as mesmas imagens. Preservar frontendOverride da NA-0080, volumes, portas, credenciais, host key, licenças, provider/modelos, permissões e flags não solicitadas. Backup de configuração e receita de recuperação antes da troca. Sem build/release nova, migrations ou publicação GitHub.

## Critérios de aceitação
- [x] Comparar sessões recentes com registros de auditoria.
- [x] Conferir flag global, licença e política aplicável.
- [x] Separar causa comprovada de hipóteses e documentar impacto/limites.
- [x] Flags solicitadas efetivas na API e gateway e persistentes na fonte ativa.
- [x] Serviços saudáveis, frontend/imagens/volumes preservados.
- [x] Nova auditoria com eventos persistidos ou limitação funcional explicitamente documentada.
- [x] Pré-requisitos de IA e autenticação MCP verificados, sem inferir operação de provider não configurado.

## Estratégia técnica
Inspeção SSH somente leitura. Consultas agregadas e comparação com recibo privado anterior à atualização do frontend.

## Diagnóstico
As 17 sessões nas últimas 48 horas pertencem a tenants regulares licenciados, política habilitada ALL, sem registro de auditoria. API e gateway têm FEATURE_SESSION_AUDIT=false, igualmente fixado no compose.candidate.json ativo. O código retorna false antes de avaliar a política. Flag também constava false no recibo anterior à entrega frontend NA-0080. Último registro de auditoria iniciou em 27/10/2026 12:21:12.334 UTC; 104 registros históricos permanecem no banco, todos com chunks referenciados.

## Correção autorizada e riscos
Usuário autorizou habilitar explicitamente os cinco recursos desativados e subir novamente. API/gateway precisam ser recriados; havia uma sessão ativa e foi comunicada a possibilidade de reconexão. Preferir janela sem sessões; revisar guarda para novas conexões e drenagem do gateway. Filas de IA verificadas vazias antes da operação. Habilitar flags não altera licença, entitlements ou configuração de provedores. Nenhuma alteração de auth, dados ou permissões faz parte desta operação.

## Matriz de testes e evidências
Consultar implementation.md. Validar allowlist do diff operacional, Compose, hash de backups, flags runtime, readiness, imagens/IDs dos serviços preservados, filas e gravação de auditoria. Revisão independente do script operacional antes da aplicação. Sem alteração de código de aplicação.

## Baseline e recuperação
Base f4a44b4b7ae87a8f688b1246d9e52a31f9a104bc. Recuperação de configuração em /opt/nodeaccess/backups/NA-0081-features; backup integral anterior validado offserver permanece disponível. Reverter somente flags/descriptor e recriar API/gateway nas mesmas imagens, repetindo proteção de conexões e verificações. Não restaurar banco para reverter flags. Documentos locais sem commit/publicação.

## Aprovação
Diagnóstico concluído. Usuário autorizou habilitação dos recursos listados e reaplicação na VPS. Não implica autorização GitHub.
Decisão: GO_WITH_RISKS — operação autorizada com backup, validação do diff, revisão independente e cuidado com sessão ativa.

## Resultado operacional
Aplicado em 29/10/2026 às 22:55 UTC, sem troca de imagens. API/gateway com as seis flags true; fontes env e descriptor ativo atualizados. Outros quatro containers preservados. Guards temporárias removidas e proxy restaurado. Saúde pública ok e MCP sem autenticação responde401. Após usuário abrir/encerrar sessão, banco confirmou auditoria COMPLETED com1chunk/26eventos e um comando contabilizado; arquivo legível e tamanho correto na API/gateway. Sem integração IA cadastrada, portanto resumos/assistente ainda exigem configuração de provider/modelo por tenant. Nenhum conteúdo de sessão foi lido.
