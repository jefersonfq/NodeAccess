# Inventário de dependências — NA-0128

Baseline CI: 19 nós, derivados de quatro advisories. Todos já presentes com as mesmas versões afetadas em 4a77f713. O número de nós não representa falhas distintas.

| Nó | Severidade | Origem | Tratamento |
|---|---|---|---|
| @eslint-community/eslint-utils | moderate | GHSA-g3hv-75wg-m249 | Atualização transitiva; nenhum advisory suprimido |
| @eslint/config-array | moderate | GHSA-g3hv-75wg-m249 | Atualização transitiva; nenhum advisory suprimido |
| @fastify/static | moderate | GHSA-3g3m-2fjr-6pw4, GHSA-g3hv-75wg-m249 | Atualização transitiva; nenhum advisory suprimido |
| @fastify/swagger-ui | moderate | GHSA-3g3m-2fjr-6pw4, GHSA-g3hv-75wg-m249 | Atualização transitiva; nenhum advisory suprimido |
| @typescript-eslint/eslint-plugin | moderate | GHSA-g3hv-75wg-m249 | Atualização transitiva; nenhum advisory suprimido |
| @typescript-eslint/parser | moderate | GHSA-g3hv-75wg-m249 | Atualização transitiva; nenhum advisory suprimido |
| @typescript-eslint/type-utils | moderate | GHSA-g3hv-75wg-m249 | Atualização transitiva; nenhum advisory suprimido |
| @typescript-eslint/typescript-estree | moderate | GHSA-g3hv-75wg-m249 | Atualização transitiva; nenhum advisory suprimido |
| @typescript-eslint/utils | moderate | GHSA-g3hv-75wg-m249 | Atualização transitiva; nenhum advisory suprimido |
| @vue/language-core | moderate | GHSA-g3hv-75wg-m249 | Atualização transitiva; nenhum advisory suprimido |
| eslint | moderate | GHSA-g3hv-75wg-m249 | Atualização transitiva; nenhum advisory suprimido |
| eslint-plugin-vue | moderate | GHSA-g3hv-75wg-m249 | Atualização transitiva; nenhum advisory suprimido |
| follow-redirects | high | GHSA-mrwp-f3q8-3g9p | Atualização transitiva; nenhum advisory suprimido |
| glob | moderate | GHSA-3g3m-2fjr-6pw4, GHSA-g3hv-75wg-m249 | Atualização transitiva; nenhum advisory suprimido |
| joi | high | GHSA-4528-x5fx-h6hg | Atualização transitiva; nenhum advisory suprimido |
| minimatch | moderate | GHSA-g3hv-75wg-m249 | Atualização transitiva; nenhum advisory suprimido |
| typedoc | moderate | GHSA-g3hv-75wg-m249 | Atualização transitiva; nenhum advisory suprimido |
| vue-eslint-parser | moderate | GHSA-g3hv-75wg-m249 | Atualização transitiva; nenhum advisory suprimido |
| vue-tsc | moderate | GHSA-g3hv-75wg-m249 | Atualização transitiva; nenhum advisory suprimido |

## Fontes primárias

- [follow-redirects: follow-redirects: Cross-realm sensitiveHeaders arrays are discarded and custom credentials can follow redirects](https://github.com/advisories/GHSA-mrwp-f3q8-3g9p)
- [glob: Glob: AbortSignal cancellation bypass allows post-timeout filesystem traversal](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4)
- [joi: joi: quadratic-time split in `string().email({ multiple: true })` allows denial of service](https://github.com/advisories/GHSA-4528-x5fx-h6hg)
- [minimatch: minimatch has potential denial of service via globparts amplification](https://github.com/advisories/GHSA-g3hv-75wg-m249)

## Compatibilidade e escolha

Não aceitos downgrades sugeridos automaticamente pelo npm. Mantidas versões de consumidores; overrides explícitos compensam ausência de ranges atualizados. Minimatch 11 usa motor novo: testes representativos não garantem equivalência universal de padrões arbitrários. Engines/export mantêm Node24 e CJS/ESM; glob14 requer path-scurry3 e minimatch11 requer novo nonrecursive-glob-match.

npm11.12.1 apresentou arestas workspace inválidas em ls/SBOM apesar dos overrides. Mesmo lock/instalação com npm12.2.1 passa ls e rotina security:check. A versão da ferramenta precisa ser reproduzida no CI; não se elimina o SBOM nem se aceita audit inconclusivo.
