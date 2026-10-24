---
change_id: NA-0069
title: Integrar frentes pendentes na release 2.1.0
status: ready-for-tests
type: release
created_at: 2026-10-24T14:14:40-03:00
base_branch: master
base_sha: 66444a9dd4c167453004bb6089278548bdd2c0d9
branch: release/NA-0069-20261024-integrate-2-1-0
owner: Codex
planner: Codex
risk: high
---

# Integração da versão 2.1.0

## Contexto e situação anterior

Master remota conferida na base acima; produção continua 2.0.3. Degustação foi
implementada na NA-0068, commit 4e1b47f344f0e829b445254e4be2047da88eeeae,
preservado em branch própria. Checkout original contém frentes adicionais e tem
snapshot privado do diff e arquivos novos; permanece intacto.

## Problema e objetivo

Entregar o conjunto atualizado na 2.1.0 com isolamento de degustação, comportamento
normal preservado, testes, pacote rastreável e implantação recuperável.

## Escopo

Integrar conteúdo NA-0068 e frentes pendentes: MCP, acesso rápido, macros, duplicação
de hosts, dashboard, origem de autenticação, IA no terminal, Royal TS, documentação
de clientes e empacotamento. NA-0067 é planejamento Android/macOS, não aplicativo.
Inclui correções necessárias dos gates de segurança: seis dependências vulneráveis,
compatibilidade Zod 4, lint estrito, novas assinaturas dos agentes após mudar lock.
Não antecipar roadmap de PRDs nem criar plataforma de inteligência de marketing.

## Critérios de aceitação

- [x] Resolver conflitos preservando funcionalidades e controles de trial.
- [x] Revisar permissões cruzadas, MCP, macros e retenção entre tenants.
- [x] Validar o código final com dependências corrigidas em tipos/lint/testes/build.
- [x] Validar browser, SSH/PTy, manual, falhas e quotas no conjunto final.
- [x] Incluir termos e privacidade com identificação autorizada e opt-ins separados.
- [ ] Gerar pacote oficial 2.1.0 de fonte limpa com agentes assinados compatíveis.
- [ ] Homologar laboratório e SMTP no destino antes de abrir cadastro público.
- [ ] Fazer backup consistente final e preparar retorno antes da troca remota.
- [ ] Publicar por PR, passar checks e sincronizar master sem bypass.

## Estratégia técnica

Worktree isolado preserva checkout original. Merge de conteúdo revisto por domínio.
A consolidação final terá um commit NA-0069 sobre a master conferida, preservando
NA-0068 em sua branch; isso mantém a governança de um Change ID por PR sem reescrever
história publicada. Metadados de trial persistem quando a flag fecha inscrições;
criação administrativa normal não cria trial. Instalação e perfis são parametrizados.

## Riscos e mitigações

Migração Zod pode alterar PATCH/defaults/formato de erros: testes específicos e
regressão global antes da release. Não usar entrypoint v3 vulnerável para silenciar
auditoria. MySQL 8.0→8.4 requer volume novo e restore, sem downgrade do mesmo volume.
Laboratórios compartilham kernel; não anunciar isolamento equivalente a VMs.
Certificado Windows é privado e requer confiança consciente, mantida localmente
por decisão do usuário. Segredos ficam fora do Git e do pacote.

## Matriz de testes e evidências

Tipos/build/lint CI; suíte global; MySQL isolado (quota, concorrência, expiração,
retenção e preservação de tenants normais); MCP tokens/SDK; macros SSH real; PTy
com top/htop; browser desktop/mobile e temas; OIDC/SCIM/Helm; manual; auditoria de
dependências/SBOM; segredos e SAST; validação criptográfica e conteúdo do pacote.
Resultados reais, simulados e não executados são separados no implementation.md e
nas evidências da frente. Reexecutar gates pertinentes no SHA final.

## Baseline

NA-0068 passou sua suíte específica, mas isso não substitui validação integrada.
Integração pré-atualização de segurança passou 2.397 testes globais e gates de
build/tipos/lint; auditoria posterior identificou seis dependências vulneráveis.
Backup de referência e restore em MySQL original/8.4 passaram sem alterar produção.

## Rollback ou recuperação

Snapshots de fontes e branch NA-0068 preservados. Produção só será substituída com
imagens por ID, dados, configuração, chaves, sites e proxy salvos e copiados fora do
servidor. Volumes antigos permanecem intocados; após novas gravações, avaliar
reconciliação antes de retornar. Ver deployment-runbook.md.

## Aprovação

Decisão: GO_WITH_RISKS.
Usuário autorizou revisar e integrar as frentes, commitar todo o conjunto atualizado,
gerar 2.1.0 e implantar no servidor informado. Correções de gates são necessárias à
entrega autorizada. Revisão técnica independente realizada por domínio; homologação
humana não é inferida dos testes. Publicação e implantação ainda pendentes.
