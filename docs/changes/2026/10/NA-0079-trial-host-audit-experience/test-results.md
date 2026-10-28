# NA-0079 — Validação e limites

Base: `b4f70480c3e7bee3738f92b8ed0283adf460719e`. Evidências locais de implementação em 27–28/10/2026, America/Sao_Paulo. O SHA final será associado aos checks e ao PR após o commit; estes resultados de trabalho não substituem os gates desse SHA.

| Critérios | Ran — evidência observada | Ambiente |
|---|---|---|
| C1–C3 | 203 testes unitários focados; revisão independente repetiu 91. Migração aditiva preservou evento antigo com metadata nula; lifecycle 5 casos SQL/HTTP, incluindo aceite ausente/desatualizado, concorrência, legado e participante. Retenção 11 e notificações 11 passaram isoladamente. | Banco NA0079 e dados sintéticos |
| C1–C3 visual | Quatro cenários 390/1440 claro/escuro: polling/visibilidade/desmontagem, rede/retry, alteração do prazo desmarca ciência, teclado, legado e marketing intacto. Revisão independente repetiu os quatro. Seis previews dos três e-mails em duas larguras, sem requests externos e sem depender de imagens. | Chromium local, APIs simuladas |
| C4–C6 | 204 testes de auditoria, repetidos pelo root; Bash PTY local recuperou o comando completo. Três papéis de navegação e dez casos do detalhe/reconstrução passaram em browser. | Shell descartável e browser sintético |
| C7–C12 | 52 testes unitários; quatro cenários cards/lista em 390/1440. Agent obrigatório/DIRECT/AUTO/conector fixado, mudança de estado, ACL, GET falho/retry, SSH/RDP/VNC por host e filtros foram exercitados. Root repetiu o harness de quatro cenários. | Browser com API/WS sintéticos |
| Convivência | Um teste real de tenant administrativo com flag ativa: senha temporária, MFA, inventário e criação de host passaram sem converter o tenant em teste. API temporária encerrada. | API atual e MySQL/Redis locais |
| Recuperação | Cliente Prisma da imagem backend atualmente publicada consultou o schema migrado. Onze simulações do roteiro operacional: pins, backup, publicação parcial, sessão ativa, redes e recuperação. | Imagem anterior e mocks locais |
| Manual/terminal | Captura oficial de cinco capítulos concluída; imagens inspecionadas. test:manual passou; test:terminal-experience:web passou. Geometria compartilhada de 60 estados passou dentro da captura. | Frontend local versão 2.1.0 |
| Gates integrados | Lint estrito e tipos passaram. Suíte geral: 2668 passaram e 121 opt-in não executados nessa chamada. Segurança final passou: zero achados Semgrep/erros e zero segredos sem revisão. | Workspace antes do commit |

## Correções encontradas durante validação

- A revisão encontrou cache de Agent antigo preservado após falha da consulta. Lista/status passaram a ser invalidados; o harness foi ampliado com online → falha → bloqueio da rota obrigatória → recuperação, mantendo DIRECT/AUTO. Os quatro cenários ampliados passaram; revisor independente conferiu o resultado.
- Dois achados do scanner eram placeholders PEM textuais idênticos à base. Revisão confirmou conteúdo inalterado e atualizou somente linha/hash das exceções exatas.
- Uma execução conjunta de SQL encontrou tombstones de outra suíte na contagem global de retenção; execução isolada passou sem relaxar asserções.
- Chromium ausente/Snap inviabilizou tentativas iniciais da auditoria; execução com Chromium fora do Snap passou sem reduzir cobertura.
- Roteiro operacional agora registra PUBLICATION_STARTED antes de mudar descriptor/pointer e recusa recuperação automática a partir desse marco, evitando estado inconsistente após falha parcial.

## Limites e checks restantes

- **Ran:** build integrado passou; manifesto editorial e checks do manual passaram. **Planned:** checks no SHA final, pacote, CI/PR e implantação com novo backup de dados.
- **Skipped:** testes opt-in não relacionados que requerem provedores/ambientes próprios. Os 121 skips da suíte geral não são apresentados como testes aprovados; SQL e coexistência relevantes foram executados separadamente.
- **Skipped:** certificação terminal-pty via SSH, pois não houve alteração de resize, WebSocket ou transporte; Ctrl+R foi reproduzido em Bash PTY local. A simulação de abertura RDP/VNC não certifica Windows/NLA nem um servidor gráfico real.
- **Manual:** homologação visual/funcional do usuário e entrega em clientes de e-mail específicos. Não foram enviados e-mails reais nesta frente.
- Ctrl+R recuperado permanece com baixa confiança: redraw não é prova atômica da execução. Multilinha, caracteres de largura ambígua e controles não suportados permanecem incertos; JSONL original é preservado.
- Não foram executados carga ou testes destrutivos em produção. A correção não certifica capacidade para quinze usuários simultâneos.
