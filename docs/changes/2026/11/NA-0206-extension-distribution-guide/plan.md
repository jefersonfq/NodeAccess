---
change_id: NA-0206
title: Consolidar o cofre e distribuir a extensão na VPS existente
type: release
status: ready-for-tests
created_at: 2026-11-26T13:50:46-03:00
base_branch: feature/NA-0204-20261125-users-vault-managers
base_sha: 0ff5c1f9a8cf87c2b4715728ef7d91f96c37cf6e
branch: release/NA-0206-20261126-vault-production
owner: codex
planner: codex
risk: high
---

# Plano

## Contexto e situação anterior

NA-0204 (gestores visíveis), NA-0205 (popup) e NA-0206 (distribuição) foram implementadas sequencialmente no checkout canônico por solicitação do usuário. São alterações locais relacionadas, ainda sem commit, com testes/cobertura/Quality Gate aprovados e revisão formal impedida pelo checkout alterado. A VPS conserva composições operacionais NA-0081/0080/0069, certificados, volumes e funcionalidades próprias; não equivale ao Compose padrão.

## Problema e objetivo

Usuário pediu consolidar e depois atualizar a VPS em 2026-11-26T15:28:13-03:00. Esta autorização abrange commit local das três frentes e implantação supervisionada com backup/rollback. Não implica publicação GitHub, troca de identidade, certificados, volumes ou aprovação fictícia de gates. A intenção única é entregar o conjunto já revisado do cofre e da extensão na instalação existente.

## Escopo

Consolidar os 49 arquivos inventariados, preservando as três frentes e seus históricos. Guias distinguem instalação e atualização manual; versão/download visíveis e detalhes recolhidos. Pacote público assinado de produção com identidade existente criada nesta frente, origem/ID/versão externos ao código. Inclusão opt-in no release padrão valida quatro arquivos regulares, nomes/schema/hashes/origem/ID e acrescenta mount somente leitura na API do Compose gerado; sem opt-in mantém comportamento anterior.

Atualizar API, gateway e frontend com imagens do SHA aprovado, aplicando somente migrações pendentes após ensaio isolado e backup consistente. Preservar os containers/imagens/volumes de MySQL, Redis e guacd, redes trial, CA, SSH host keys, proxy, TLS e flags existentes. Ativar somente distribuição/autorização da extensão com ID esperado e pasta pública. Manter preenchimento automático de produção desabilitado enquanto o gate de pentest estiver pendente. Não conceder revelar/copiar nem nomear gestores automaticamente.

Fora do escopo: mudança do domínio no código, instalação de extensão no navegador do usuário, Chrome Web Store, rotação de segredos/chaves, agentes antigos apresentados como novos, relaxamento de testes/baselines ou substituição cega da stack. Chaves privadas nunca entram no Git, imagens ou pacote público.

## Critérios de aceitação

- [x] UI e guias PT/EN, teclado/mobile e estados de falha validados; políticas e permissões preservadas.
- [x] Pacote candidato real com assinatura/ID/origem/CRC/hashes verificados independentemente; configuração externa persistida.
- [x] Manual atualizado e revisado, testes e segurança pré-commit aprovados.
- [ ] Commit com conteúdo revisado, governança válida e checkout limpo; validação Sonar formal no SHA final.
- [ ] Release padrão com agentes assinados atuais, imagens verificadas, proveniência limpa e checksums; sem reutilização de artefatos obsoletos.
- [ ] Backup consistente e cópia offserver com ensaio de restauração; compatibilidade de migrations/rollback comprovada.
- [ ] Cutover revisado com drenagem, serviços explícitos, mounts/identidades preservados e saúde pós-troca.
- [ ] Origem pública entrega versão/pacote corretos; registros e roadmap distinguem execução técnica e homologação humana.

## Estratégia técnica

Usar branch de consolidação derivada do HEAD atual, sem reset/stash de alterações. Um commit rastreável referencia NA-0204/0205 como frentes relacionadas. Repetir validate:sonar no SHA limpo, sem alterar baseline ou guardas de revisão. Regenerar extensão com a mesma chave externa e SHA aprovado. Empacotar por scripts oficiais, incluindo agentes Windows/Linux/macOS e artefatos públicos da extensão; não contornar guardas de assinatura/proveniência.

Antes de operar produção, derivar Compose operacional do ativo e comparar allowlist de mudanças (imagens API/gateway/frontend, pasta/ID da extensão e metadados de versão). Revisar comandos concretos independentemente. Aplicar migrações uma vez com serviços de aplicação drenados e backups certificados; não recriar serviços de estado. Publicar apenas depois dos gates técnicos.

## Riscos e mitigações

DDL MySQL não é transacional: oito migrations pendentes precisam de ensaio isolado, checksums e plano de retorno. Compatibilidade do código antigo com schema expandido deve ser comprovada, não presumida. Exigir restore em volume novo se o guard antigo não aceitar migrations futuras; não restaurar snapshot sobre gravações novas sem reconciliação.

Assinaturas de agentes e da extensão são identidades diferentes; manter chaves existentes e rejeitar artefatos de outra árvore. Recriação de gateway pode interromper sessões: bloquear novas conexões, drenar e comunicar a janela. Preparar volumes/configuração privada e verificar espaço antes de backup/cópias. Ausência de homologação humana Windows e pentest não é suprida por ensaios sintéticos.

## Matriz de testes e evidências

Ran pré-commit: UI9, Playwright91, release24, CRX12, manual3Node+18Vitest/5capturas/60geometrias, security43/43+Semgrep0/0. Integração anterior: tooling254, Vitest5072, Node1060 e browser17/17 PASS; local85,5054%, remoto84,3%, zero novas violações/hotspots. Evidências em `.tmp/NA-0206` e analysis58908000-19ec-431b-b42b-9f8c90be383e. Esses resultados não aprovam um SHA futuro.

Planned: governança e Sonar no commit consolidado; build/proveniência, auditoria de dependências/SBOM/imagens; restauração isolada e migrations; health/readiness, integridade do pacote e assets, autorização negativa, comparação de mounts/imagens e verificações funcionais permitidas. Manual: homologação humana do navegador/Windows e fluxos autenticados quando não houver identidade de teste autorizada.

## Baseline

HEAD/base0ff5c1f9a8cf87c2b4715728ef7d91f96c37cf6e; 35 arquivos modificados e 14 novos revisados, sem arquivos secretos/gerados indevidos. Backup do diff e hashes em `.tmp/NA-0206/consolidation`. VPS em consulta inicial saudável, sem sessões SSH ativas, 150 migrations aplicadas/158 locais, zero divergência de checksum/incompletas; a situação deve ser reconferida na janela. Artefatos Windows locais antigos não correspondem às fontes atuais e não serão usados.

## Rollback ou recuperação

Preservar imagens por ID, Compose/env/ACTIVE, certificados/CA/hostkeys/proxy, dump SQL, Redis, auditorias e avatares; copiar e verificar fora da VPS. Ensaiar restauração em ambiente descartável antes da troca. Antes de liberar gravações, falha mantém manutenção e recupera configuração/imagens compatíveis; se necessário restaurar snapshot em volume novo e manter volume original intacto. Após gravações novas, avaliar reconciliação: nunca downgrade destrutivo automático. Chave da extensão preservada para futuras atualizações.

## Aprovação

- Decisão: `GO_WITH_RISKS`
- Usuário autorizou explicitamente consolidar e atualizar a VPS nesta interação.
- Revisão seletiva pré-commit sem P1/P2; deploy condicionado aos gates e revisão dos comandos concretos.
- Não criar push/PR/merge nem afirmar homologação sem autorização/evidência correspondente.
