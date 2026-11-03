# NA-0116 — Registro da implementação

## Pedido e objetivo

Corrigir configuração efetiva diferente no ensaio CI real, sem alterar baselines/thresholds.

## Implementação

Base SHA `47f06b51e693d91f5ed724b7b86e5362af75bc35`, branch fix/NA-0116-20261103-sonar-base-config. Plano GO_WITH_RISKS autorizado pela coordenação após evidência real. Sem alterações NA-0093 ou Sonar existente.

## Validação

Ran: executados 42 testes ci-*, lint sete arquivos, leitor real do scanner5.0.2 e ensaio Docker com três análises; detalhes em test-results.md.

## Recuperação

Reverter a frente; worktrees e recursos do ensaio são privados e descartáveis, sem instalação na VPS.

## Pendências

Integrar esta frente e repetir a análise completa do produto no CI. Coordenação atualizará índice compartilhado e planilha de metas; esta frente não afirma publicação nem homologação humana.

## Diário de interações

### 2026-11-03T17:36:33-03:00 — Diagnóstico confirmado

Root informou análise base usando defaults. Código primário do scanner instalado confirma leitura fixa sonar-project.properties no projectBaseDir; -Dproject.settings não seleciona esse arquivo no wrapperNPM. Análise base terminou sem warnings de extends/node_modules; tsconfig frontend/shared/backend estendem somente arquivos locais. Não criar symlinks de workspace para candidato, que poderiam introduzir tiposHEAD na base. Próximo passo fix e testes, depois verificar contexto CE seguro nas duas análises.

### 2026-11-03T17:41:47-03:00 — Implementação e leitor real

Materialização substitui arquivo ausente/diferente da base privada, desvinculando eventual symlink antes de escrever. Configuração aceita somente propriedades usadas pelo projeto em sintaxe simples; duplicatas, variáveis/interpolação, escapes e propriedades desconhecidas reprovam explicitamente. SHA256 é verificado antes/depois scanner e após contexto CE. Removido -Dproject.settings. API26.10 confirmada pela coordenação: api/ce/task additionalFields suporta scannerContext. Runtime exige tarefa/analysis/status/escopo iguais e todas as propriedades esperadas; contexto bruto não é exportado.

42 testes ci-* PASS, ESLint dos7arquivos zero erros/warnings. Testes cobrem base ausente/diferente, symlink seguro, mutação/config diferente, falta de evidência/contexto, campo divergente e descarte de segredo. Leitor real getProperties do @sonar/scan5.0.2 instalado reproduziu sonar.tests ausente antes e igualdade de cinco propriedades após materialização, sem rede. Isso prova leitura do wrapper, mas ainda não equivale ao scanner/servidor completo. Rehearsal foi reforçado com base separada sem arquivo prévio, teste explicitamente classificado e sentinela JavaScript inválida excluída, além de exigir contexto verificado nas três análises. Ensaio Docker aguarda liberação da coordenação.

### 2026-11-03T17:49:00-03:00 — Formato real e tentativas de ambiente

Revisão independente aprovou parser, materialização e verificações, solicitando bloquear seis propriedades adicionais de escopo quando não previstas; negativos e valores vazios testados. API real da coordenação confirmou prefixo `  - chave=valor`; parser e fixtures agora cobrem esse formato sem guardar contexto bruto. Duas invocações do ensaio falharam antes da análise por caminhos npm incorretos (primeiro inexistente, segundo pacote antigo sem semver); ambas concluíram limpeza. Não são resultados de análise Sonar. Terceira invocação usa npm11.12.1 validado antes da execução. Próximo passo: comprovar três contextos efetivos e gates no servidor descartável.

### 2026-11-03T17:53:00-03:00 — Ensaio real concluído

Três análises reais Sonar26.10/@sonar/scan5.0.2 concluídas em projeto privado descartável. Contextos efetivos base/coberto/descoberto correspondem ao mesmo arquivo SHA256; fontes, testes, inclusões, exclusões, LCOV, encoding, identidade e runtime verificados. Base iniciou sem arquivo original. Cenário coberto: new_coverage100%, gateOK; cenário descoberto:42,9%, gateERROR sob limiar80; ignoredConditions=false em ambos. Contexto bruto nunca persistido. Resultado sanitizado em rehearsal-evidence.json. Containers/network CI removidos e diretório privado de sucesso apagado; Sonar original não alterado.

Suíte final42PASS e ESLint7arquivos zero erros/warnings após ajuste ao prefixo real da API. Revisão independente tooling aprovou guardas/materialização/parser; prova real fecha a compatibilidade pendente. Limite: fixture pequena comprova contrato e gate, não substitui análise integrada do produto. Documentos desta frente sincronizados para docs canônico; publicação e planilha permanecem com a coordenação.
