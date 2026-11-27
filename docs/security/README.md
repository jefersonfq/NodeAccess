# Segurança — catálogo e conteúdo da Central

A Central de Segurança é informativa. Não consulta a configuração do tenant, não atesta a operação atual e não apresenta controles como ativos apenas porque existem no código.

- [Catálogo interno](controls-catalog.json): afirmações, condições e evidências de implementação.
- [Refinamento, acesso local e validação](../changes/2026/11/NA-0172-security-center/ux-validation.md).
- [Inventário focal](ASSESSMENT.md): leitura realizada, limitações e assuntos que precisam de aprofundamento.
- [Plano da Central](../changes/2026/11/NA-0172-security-center/plan.md): escopo e critérios de aceite.

## Fonte e publicação

`docs/security/controls-catalog.json` é a fonte versionada. O plugin `tools/security-center/build.cjs` carrega esse documento no processo de build e projeta somente `revision`, `reviewedAt`, `sections` e `practices` no módulo `virtual:nodeaccess-security-center`. Cada seção contém exclusivamente `id`, `title`, `summary`, `details` e `conditions`.

Metadados, responsáveis, caminhos, hashes, revisão interna e controles pendentes não fazem parte do módulo cliente. Não importar o JSON interno no frontend, não colocá-lo em `public/` e não criar endpoint para servi-lo. O conteúdo público é texto simples renderizado como texto, sem HTML fornecido pelo catálogo. A separação de campos não detecta automaticamente um segredo escrito no texto público: a revisão editorial continua obrigatória.

## Significado dos estados

| Estado interno | Significado | Publicação |
|---|---|---|
| `verified` | A afirmação delimitada foi revisada no código indicado | Texto público revisado, com as condições necessárias |
| `partial` | Há evidência parcial, com limites explícitos | Somente afirmação limitada e condições obrigatórias |
| `planned` | Ideia ou trabalho ainda não integrado nesta base | Excluído |
| `unverified` | Não há verificação suficiente | Excluído |

Esses estados não dizem que uma instalação está protegida ou que os testes passaram. As entradas atuais usam `review.method=source-review` e `testsExecuted=false`: os arquivos de teste são referências, não declaração de execução. Resultados executados ficam nas evidências da frente/CI, vinculados ao candidato. `reviewedAt` é data de revisão editorial, não data do último scan nem versão implantada.

## Manutenção

1. Reexaminar a alegação e seus limites quando mudar um arquivo de evidência. O hash do conteúdo de `sourceFiles` deve corresponder à revisão; divergência bloqueia a geração.
2. Atualizar a evidência, referência de revisão, condições e texto. Não recalcular o hash apenas para fazer o build passar. O helper `evidenceHash(root, files)` calcula o mesmo digest usado pelo verificador.
3. Mapear testes existentes; executar os testes aplicáveis e registrar os resultados no diário da mudança. Depois da revisão editorial, atualizar `reviewedAt` e `revision` quando o conteúdo público mudar.
4. Executar `node --test tools/security-center/build.test.cjs`, build e teste de navegador aplicável. Validar o bundle para ausência de metadados e controles não publicados.
5. Revisão independente deve conferir a diferença entre código existente, teste executado, integração e configuração efetiva. Alterações de runtime, hardening ou novos controles exigem frente própria.

Não criar contato, SLA, selo, certificação, regra de retenção ou promessa de cobertura sem evidência e aprovação. A página não pode inferir que o tenant habilitou auditoria, Cofre, HTTPS ou um método de autenticação apenas pela presença deste catálogo.

Em desenvolvimento (`vite serve`), catálogo indisponível ou revisão stale apresenta uma Central vazia com aviso, sem divulgar afirmações antigas nem provocar falha do import/retorno à página anterior. O plugin acompanha os arquivos de evidência para recuperar após correção editorial. Build de produção e exportação continuam recusando catálogo inválido; o fallback não aprova conteúdo nem substitui revisão independente. A correção NA-0203 e suas evidências estão em `docs/changes/2026/11/NA-0203-extension-sequence/hardening-results.md`.
