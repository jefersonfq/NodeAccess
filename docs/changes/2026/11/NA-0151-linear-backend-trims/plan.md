---
change_id: NA-0151
title: Remover seis padrões de backtracking não linear preservando contratos
type: fix
status: in-development
created_at: 2026-11-04T10:52:44-03:00
base_branch: fix/NA-0150-20261104-explicit-contracts
base_sha: 02e7521cbe69e72cb5c8c3f5f951dcdc6e1c5fec
branch: fix/NA-0151-20261104-linear-backend-trims
owner: equipe NodeAccess
planner: Codex
risk: medium
---

# NA-0151 — Trims e extração de prompt lineares

## Contexto e situação anterior
Seis S8786 antes classificados incorretamente como FP por inputs limitados/validados. Definição instalada relida em `/tmp/NA0093-backend-rules.json`, SHA256 `4fde36a236f44e528d0b999e49e5e45ed1a8e7e5f51d4dd9f7aad02d0df6324d`: regra reporta crescimento não linear, mesmo quando validação anterior reduz exploração. Nenhuma exceção ou mudança de gate proposta.

## Problema e objetivo
Eliminar backtracking não linear nestas expressões mantendo nomes de downloads, extração de primeiro prompt e fingerprints exatamente iguais sob os contratos aceitos.

## Escopo
SQ0012 diagnostic-run.controller slug; SQ0028 native-ssh-gateway.host-key fingerprint; SQ0050 session-audit-normalizer primeiro prompt; SQ0079/0080 trial-machines e SQ0084 trial.service padding. Sem alterar SSH/WS, protocolo, autenticação, esquema aceito, limites ou transporte. Sem novas dependências.

## Critérios de aceitação
- [ ] Slug mantém byte a byte lowercase/collapse/trim/corte60/fallback e filename final.
- [ ] Fingerprint SHA256 nativo preserva saída43base64 sem padding para chaves reais.
- [ ] Prompt original preservado, incluindo whitespace inicial/trailing, brackets, Unicode whitespace e múltiplos prompts.
- [ ] Labschema aceita exatamente fingerprints43base64 com zero/um padding; persistência continua com um padding.
- [ ] Diferenciais contra referência anterior e entradas adversariais executados com deadline externo; nenhum teste enfraquecido.
- [ ] Suites de domínio/lint/typecheck e revisão independente; ausência Sonar só confirmada por análise integrada.

## Estratégia técnica
Slug: após `/[^a-z0-9]+/g` cada extremidade contém no máximo um hífen; retirar repetição de trim. Hostkey: SHA256 gera32bytes e base64 tem exatamente um `=`, trim de um caractere preserva fingerprint. TrialMachines valida labSchema diretamente; TrialService usa provisioner HTTP que parseia labSchema antes de retornar. Remover somente padding único sob esse contrato; testar entradas rejeitadas no esquema e ambos formatos válidos. Se inspeção revelar consumidor produtivo fora do contrato, usar scanner linear de sufixo em vez de alterar semântica. Prompt: validar MULTI_PROMPT_LINE como antes, usar trimStart e regex ancorada para extrair primeiro prompt, preservando seu whitespace seguinte. Provar equivalência inclusive leading whitespace e CR/LF/U+2028; não remover guard nem alterar normalização adjacente.

## Riscos e mitigações
Regex ancorada poderia alterar leading whitespace: diferencial sobre entradas aceitas/rejeitadas do guard. Padding single depende de contrato: auditar todos provisioners produtivos e esquema; nenhuma alteração de validação. Não alegar exploração E2E por temporização isolada nem que bounded input anula diagnóstico matemático.

## Matriz de testes e evidências
Baseline: normalizer, gateway diagnostics, trial service/provider-contract. Novos: controller download real com serviço/reply de fronteira simulados; digest real/chave sintética; schemas+persistência; diferencial de prompt e subprocesso adversarial. Lint focal e backend typecheck. MySQL/SSH reais somente se contrato alterado exigir; esta frente não muda I/O/transporte. Parent executa Sonar integrado serialmente.

## Baseline
02e7521cb; worktree isolado preserva integração e alterações canônicas concorrentes. Dependências compartilhadas somente leitura. Baseline ainda em execução/preparação; nenhum produto editado.

## Rollback ou recuperação
Reverter apenas checkpoint desta frente; sem dados/migração. Rollback reintroduz alertas; não alterar aceites/gates para ocultá-los.

## Mudanças de escopo e decisões
2026-11-04: seis ocorrências atribuídas pela raiz. Outros regex tooling ficam em frente separada. Planejamento2027 e reconciliação consolidada permanecem com raiz.

## Aprovação
Decisão: GO_WITH_RISKS aprovada pela raiz em2026-11-04, após baseline227/4 PASS. Usuário autorizou objetivo e testes; sem push/merge direto.
