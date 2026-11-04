# NA-0161 — Registro da implementação

## Pedido e objetivo

Concluir CI e resolver colaterais da conformidade Sonar.

## Implementação

Base SHA b32a6c9c19e6233ddfe024c70c82023f09701685. No macOS, os.tmpdir usa /var/folders, alias de /private/var/folders. O resolvedor retorna corretamente o alvo físico; cinco asserções da fixture comparavam o alias textual. Canonicalizar somente a raiz temporária criada pelo teste; preservar o resolvedor e todos os negativos de permissões/symlink. Acrescentado contrato de alias de diretório com rejeição de executável gravável.

## Validação

Ran:11 testes PASS/2 Windows ignorados em Linux; novo contrato de alias também PASS. macOS/Windows reais aguardam CI, sem inferir aprovação de plataforma.

## Recuperação

Branch recuperável, sem migração.

## Pendências

CI e revisão independente complementar pendentes.

## Diário de interações

### 2026-11-04T14:22:14-03:00 — Comparação de caminhos no macOS

Log hospedado confirmou retorno físico versus alias textual. Correção apenas na fixture e contrato negativo preservado. Ran:11 testes PASS/2 Windows ignorados em Linux; novo contrato de alias também PASS. macOS/Windows reais aguardam CI, sem inferir aprovação de plataforma. Próximo passo: integrar após terminar a validação em curso e repetir checks no SHA final.
