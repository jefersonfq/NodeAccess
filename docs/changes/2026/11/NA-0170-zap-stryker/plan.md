---
change_id: NA-0170
title: ZAP dinâmico e mutação Stryker em laboratório isolado
type: security
status: ready-for-tests
created_at: 2026-11-05T10:08:33.010371-03:00
base_branch: master
base_sha: 745253d1edb522db79aaa44fd96608ce434a2774
branch: security/NA-0170-20261105-zap-stryker
owner: NodeAccess
planner: Codex
risk: medium
---

# NA-0170 — ZAP e StrykerJS

## Contexto e objetivo
Usuário autorizou instalar/integrar e já usar as duas ferramentas propostas no README. Base master remota confirmada; PRs59/60 encerradas. GO_WITH_RISKS: escopo de laboratório e ferramentas de desenvolvimento, sem alterar produção. Pasta principal suja preservada em worktree separado; documentos canônicos espelhados na pasta atual do projeto.

## Escopo
- ZAP com imagem fixada por digest, primeira análise passiva real de frontend/API NodeAccess em rede descartável e alvos controlados. Cobertura de rotas e autenticação explicitamente registrada; nenhuma promessa de cobertura completa ou pentest. Fluxos autenticados sintéticos quando viáveis, sem credenciais produtivas. Sem scanner ativo genérico nem URL arbitrária por padrão.
- StrykerJS fixado em lockfile, seleção pequena explícita de módulos críticos, execução real, relatório e limiar definido antes da medição (80%). Investigar sobreviventes e fortalecer testes quando houver lacuna real; equivalentes registrados sem exclusões genéricas.
- Comandos repetíveis, CI com limites de tempo/CPU, evidências sanitizadas e falha de execução distinta de ausência de achados. README, guia operacional, planilha e diário atualizados.
- Reaproveitar padrões existentes de laboratórios/limpeza; não modificar fluxo normal de SSH/terminal/auth por conveniência de teste.

## Critérios de aceitação
- [ ] Versões e procedência das ferramentas verificadas; dependências de desenvolvimento apenas.
- [ ] ZAP executado de verdade contra NodeAccess, inventário mínimo de URLs/estados inspecionados e relatório sem segredos; alvos externos não aceitos pelo comando padrão.
- [ ] Achados classificados por evidência, severidade e próximo passo; gate falha em High/Medium não revisados, ausência de relatório/scan vazio/timeout.
- [ ] Stryker executado de verdade, número de mutantes/estados/score/tempo publicado; limiar80 não reduzido para aprovar.
- [ ] Testes negativos para políticas/seleção/relatórios e cleanup. Relatórios não publicados em serviço externo.
- [ ] CI, documentação e evidências coerentes com SHA; revisão independente antes de entrega.

## Estratégia e arquivos
Ferramentas em tools/security e tools/mutation, configuração Stryker e devDependencies, scripts npm, workflow dedicado, documentação e testes focais. Seleção inicial Stryker: políticas pequenas de segurança (auth/MCP ou similar após baseline), orçamento de dois workers e limite de execução. ZAP: rede Docker própria, dados sintéticos, limites, cleanup em finally, relatório reduzido sem cookies/tokens. Possível build de imagens locais atuais para evitar analisar versão antiga. Testes HTTP autenticados não equivalem a varredura ativa autenticada.

## Riscos e mitigação
Carga e recursos: execução isolada e limitada. Relatórios sensíveis: sanitizar antes de artefatos. Falsos positivos: decisão exata com evidência e prazo; sem desligar regra. Mutantes equivalentes: registro explícito, sem relaxar limiar. Rede indisponível: preservar diagnóstico e não declarar ferramenta executada. Necessidades corretivas documentadas; mudanças amplas no produto fora do escopo.

## Validação
Baseline: master745253d1e validado no CI anterior, nenhum ZAP/Stryker integrado; versões Node24.22.1/Vitest4.1.12 verificadas. Rodar contratos focais, lint, auditoria de novas dependências, execução real das duas ferramentas e revisão independente; repetir gates relevantes no candidato publicado. CI completo permanece aplicável, sem bypass.

## Recuperação
Reverter commit da frente por PR; sem migrations ou dados produtivos alterados. Remover somente recursos Docker identificados desta execução; preservar serviços existentes.

## Correção necessária de dependência
O Stryker introduz typed-rest-client2.3.1 com qs6.15.1 vulnerável. Override restrito qs6.17.1, compatívelmajor6, auditado e testado; demais dependências/runtime preservadas. Teste de regressão inclui entradascomma que causavam crash.

## Correção necessária do harness de terminal
A coleta Sonar revelou pressuposição preexistente de que a segunda requisição SFTP seria /var. O cache distingue prefixos e a digitação com debounce pode gerar consultas intermediárias à raiz. Ajuste restrito ao harness: verificar progressão completa de diretórios e REST zero; preservar invalidação exatamente uma vez e stress sem tráfego. Adicionado diagnóstico por prefixo/socket. Sem mudança do produto.
