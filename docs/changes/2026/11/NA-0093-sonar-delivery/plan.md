---
change_id: NA-0093
title: Entrega integrada das quatro pendencias SonarQube
type: chore
status: ready-for-tests
created_at: 2026-11-03T15:52:18-03:00
base_branch: master
base_sha: f4a44b4b7ae87a8f688b1246d9e52a31f9a104bc
branch: chore/NA-0093-20261103-sonar-delivery
owner: NodeAccess
planner: Codex
risk: high
---

# NA-0093 — Entrega integrada SonarQube

## Contexto e situação anterior

O checkpoint NA-0089 (4a77f7139) registra 539 decisões: 244 achados corrigidos e ausentes, 295 revisados em contexto. Foram executados 2.714 testes e 33 testes dos validadores. A cobertura dos serviços era 41,03% de linhas, 40,34% de funções e 34,63% de branches, abaixo dos limites de 70/70/60. A cobertura nova no Sonar era 3,5%, abaixo de 80%. Não havia PR ou merge. O workspace principal contém trabalho não relacionado que precisa ser preservado.

## Problema e objetivo

Executar as quatro pendências autorizadas: cobertura real, entrega por PR condicionada aos gates, scanner automático no CI e continuidade operacional com backup, restauração e renovação de tokens. Construir uma entrega verificável sem flexibilizar limites nem presumir homologação.

## Escopo

Integrar NA-0085–0089 e as frentes NA-0090 (cobertura), NA-0091 (recuperação), NA-0092 (CI), além dos lotes de contratos e correções necessárias encontrados nas simulações. Preservar as branches de origem. Preparar o PR e executar checks e revisões; merge somente com gates e homologação humana. Backups e tokens ficam fora do Git. Sem implantação na VPS ou alteração persistente de kernel.

## Critérios de aceitação

- [ ] LCOV abrangente, com lacunas reais identificadas e sem exclusões para elevar a nota.
- [ ] Testes significativos e limites 70/70/60 dos serviços e 80% de código novo preservados e atendidos.
- [ ] Scanner real automático no CI, com credenciais efêmeras, baseline comparável e rejeição de novos achados sem revisão.
- [x] Backup e restauração isolada verificados; renovação de tokens ensaiada com falhas e permissões.
- [ ] PR rastreável, checks no SHA atual, revisão independente e homologação humana antes do merge.
- [ ] Documentação, evidências e META-050 atualizadas no projeto atual.

## Estratégia técnica

Usar uma branch de integração sobre origin/master e aplicar patches consolidados com identidade NA-0093. Manter as branches de domínio para recuperação. Executar testes em worktrees isolados e serializar os scanners que usam a mesma instância. O CI usa Sonar efêmero em runner hospedado, evitando executar código de PR no WSL persistente.

## Riscos e mitigações

A ampliação da instrumentação pode reduzir percentuais: manter os denominadores e nunca fabricar LCOV. O GitHub é público: publicar somente fonte e evidências sanitizadas, sem relatórios brutos, credenciais ou backups. O projeto Sonar local continua privado. Os ensaios usam limites de recursos e portas e volumes isolados. Publicação não equivale a homologação.

## Matriz de testes e evidências

Executar cobertura ampla, suítes dirigidas e completa, testes dos validadores, CI real local e no GitHub após publicação, restauração isolada, rotação e expiração de tokens, simulações de falhas e permissões, revisões independentes e governança. Registrar resultados reais no implementation.md. Homologação funcional permanece Manual.

## Baseline

Base f4a44b4b7ae87a8f688b1246d9e52a31f9a104bc, origin/master confirmado via fetch. Checkpoint anterior 4a77f7139600e70aa612e753418978d9b31b10ae, com bloqueio de cobertura documentado.

## Rollback ou recuperação

Preservar branches de origem e worktree NA-0093. O PR pode permanecer draft enquanto os gates falham. Não resetar o workspace canônico nem restaurar o Sonar sobre volumes originais. A rotação mantém o token anterior durante a janela de verificação do substituto.

## Aprovação

Decisão: GO_WITH_RISKS. O pedido explícito cobre execução fim a fim das quatro frentes, incluindo PR. Homologação humana e checks não podem ser inferidos. Mudanças de proteção do repositório exigem necessidade e autorização específica.

## Correções necessárias após execução do CI

Classificação NECESSARY_CORRECTION, dentro da autorização de concluir a entrega e corrigir lint legado em branches separadas:

- NA-0127: preservar bit executável do bin do workspace, impedindo alteração rastreada durante npm ci; manter guarda de checkout limpo.
- NA-0128: atualizar dependências vulneráveis com contratos de consumidores reais; alinhar npm no CI quando necessário para inventário SBOM correto. Mudanças de versões principais exigem testes de compatibilidade, incluindo TypeDoc, sem ignorar falhas ou baixar a política de dependências.
- NA-0129: substituir pin Alpine indisponível e fixar biblioteca correspondente no runtime, validando imagem real e scanner.
- NA-0130: distinguir identificadores públicos Sonar de chaves secretas, manter leitura legada e revisar falsos positivos individualmente por regra/linha/hash; sem exceções genéricas.
- NA-0131: preservar diagnóstico sanitizado das violações em código novo no CI descartável, para explicar diferenças entre períodos de análise e corrigir a causa mantendo o gate.
- NA-0132: executar o npm usado pelo scanner por CLI absoluto validado via Node, eliminando a busca pelo PATH identificada pelo diagnóstico real (S4036), sem suprimir o achado ou alterar baseline.

- NA-0133: corrigir os sete achados novos da reanálise (callbacks unários e asserções verificáveis no processo pai), sem alterar política ou inventário.
- NA-0134: preservar diagnóstico sanitizado de falhas de cobertura e artefatos ausentes antes do scanner, sem publicar mensagens livres ou segredos.
- NA-0135: propagar o Chromium gerenciado pelo Playwright aos cinco harnesses quando não houver override explícito, evitando fallback divergente para navegador de sistema.
- NA-0136: corrigir vulnerabilidades Node identificadas no scanner das imagens, atualizando bases por digest e validando TLS, stack descartável e scanner reais.
- NA-0138: eliminar referência a commit local ausente no clone hospedado, usando baseline publicada com Vue idêntico, e preservar diagnóstico estruturado por etapas/códigos allowlist, sem exportar erros livres ou relaxar gates.
- NA-0137: alinhar pins ativos de CI, fixtures e .nvmrc ao Node24.22.1, mantendo npm12.2.1 e contratos de compatibilidade existentes.

Riscos adicionais: npm e majors transitivos podem afetar ferramentas de documentação, matching de caminhos e publicação estática. Build/typecheck isolados não bastam; usar CLI e servidores reais, negativos e revisão independente. Nenhuma alteração em produção ou deploy está autorizada por esta ampliação técnica.
