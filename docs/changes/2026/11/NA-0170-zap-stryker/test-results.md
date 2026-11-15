# NA-0170 — Resultados e achados

Estado: ferramentas instaladas e executadas localmente. Publicação em validação; sem implantação em produção. O gate de segurança do ZAP permanece bloqueado por um achado real.

| Controle | Execução observada | Resultado |
|---|---|---|
| StrykerJS 10.1.1 | 74 mutantes nas políticas de autenticação e ações MCP | Baseline 75,68%; após ampliar os testes, 97,30%: 72 detectados e dois equivalentes mantidos. Limiar de 80% global e por módulo. |
| ZAP 2.17.0 passivo | 12 cenários HTTP, 18 mensagens, 62 regras; rodada final de 93 segundos | Execução completa, limpeza confirmada; gate reprovado por um alerta médio. |
| npm audit | Dependências de runtime e desenvolvimento | Zero achados após correção restrita da dependência qs. |
| Compatibilidade | TypeDoc/minimatch, Fastify, consultas qs e entradas adversariais | Aprovada. O postinstall existente foi aplicado após a instalação inicial com ignore-scripts. |
| Sonar local | 806 Node aprovados, zero falhas, sete skips; nove harnesses de navegador aprovados | Scanner confirmou cinco correções e somente TOTP; decisão individual autorizada aplicada. API gate OK/zero issues abertas e hotspots pendentes. Execução completa no SHA publicado ainda necessária. |

## Achados ZAP

| Regra | Severidade | Observação | Estado e próxima ação |
|---|---|---|---|
| [10055-6](https://www.zaproxy.org/docs/alerts/10055-6/) | Média | A CSP permite estilos inline em `/login`. | Aberto e bloqueante. Não é um falso positivo. Corrigir pode afetar componentes, editor e terminal; usuário autorizou correção em frente separada, NA-0171, com testes de interface. |
| [10036-2](https://www.zaproxy.org/docs/alerts/10036-2/) | Baixa | O header Server revela versão em nove rotas ou recursos. | Aberto. Avaliar a configuração de server_tokens e repetir as verificações HTTP. |
| [2](https://www.zaproxy.org/docs/alerts/2/) | Baixa | IP privado encontrado no bundle JavaScript. | Aberto. Confirmar o contexto exato antes de classificá-lo como exemplo ou dado exposto. |
| 10015, 10109, 10111 e 10112 | Informativa | Observações sobre cache e identificação de aplicação, autenticação e sessão. | Não representam quatro vulnerabilidades confirmadas. |

Não houve scanner ativo, navegação JavaScript, avaliação SSH/WebSocket, teste cruzado entre tenants ou certificação TLS de produção. As rotas selecionadas não representam toda a aplicação. Os resumos publicados não incluem tokens, cookies ou corpos de resposta.

## Stryker: antes e depois

A primeira execução reprovou o limiar: autenticação com 82,93% e MCP com 66,67%. Foram acrescentados testes comportamentais para combinações de MFA/JIT/vinculação, valores inválidos e regras de expansão e autorização MCP. O código de produção permaneceu inalterado.

A rodada final atingiu 100% em autenticação e 93,94% em MCP. Não houve mutantes sem cobertura, timeouts, erros ou exclusões. Os dois sobreviventes MCP são verificações redundantes: o filtro seguinte já retorna vazio quando não há modo válido, e a busca na lista já rejeita um modo inválido. A revisão independente comparou 910 autorizações e 130 expansões; os sobreviventes continuam no denominador e no relatório.

## Testes e simulações dos executores

Os contratos cobrem entradas inválidas, relatórios vazios, antigos ou adulterados, escopo exato, SHA/fingerprint, concorrência, timeout, cancelamento e descendentes de processos. A revisão independente reproduziu processos órfãos e uma prova resumida insuficiente; os casos foram corrigidos e ganharam testes de regressão.

A coleta executa o Stryker real e testa o driver Python sob trace. As provas exigem um identificador novo por execução, hashes dos arquivos e relatórios, escopo e métricas reconciliados com o resultado bruto. Fontes modificadas no sandbox de mutação não recebem crédito como cobertura do produto. Simulações de Docker verificam o controle do laboratório, enquanto a execução real do ZAP valida sua integração.

## Falhas diagnósticas preservadas

- Readiness da API: o laboratório sem privilégios precisava de um diretório temporário de auditoria.
- API core.sendRequest: recusada pelo modo seguro do ZAP; o driver passou a gerar tráfego normal pelo proxy HTTPS, com a CA efêmera validada.
- Refresh: o driver assumia rotação do refreshToken; foi ajustado ao contrato existente, que renova o accessToken.
- Migração: ocorreu uma falha isolada sem diagnóstico suficiente para afirmar a causa. O probe do MySQL foi corrigido para TCP, evitando confundir o socket de inicialização com disponibilidade para a aplicação. Não foi adicionado retry genérico de migrations.

As falhas não foram convertidas em aprovação. As rodadas encerradas registraram limpeza completa; a última execução concluiu os fluxos e reprovou somente pelo alerta médio de CSP.

## Evidências e publicação

As evidências locais identificam a base Git e as alterações de trabalho por fingerprint. Os gates devem ser conferidos no SHA publicado. Os relatórios detalhados Stryker permanecem em `artifacts/mutation` no worktree; somente resumos sanitizados são destinados ao CI.

Documentos e evidências resumidas estão disponíveis na pasta canônica `NodeAccess-current/docs`. Homologação, publicação e implantação não são inferidas dos testes locais.
