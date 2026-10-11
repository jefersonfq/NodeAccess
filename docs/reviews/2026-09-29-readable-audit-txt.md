# TXT legível da auditoria SSH

Revisão posterior: [simulações operacionais na tela e correção do prompt PostgreSQL](2026-09-29-audit-operational-simulations.md).

## Decisão e escopo

O download padrão passa a representar o **texto visível da sessão**, aproximando-se do uso cotidiano do log enviado como referência do MobaXterm. O seletor “Conteúdo do TXT” oferece:

| Opção | Conteúdo |
| --- | --- |
| Sessão legível (padrão) | Cabeçalho mínimo, prompts e saída do terminal; inclui os comandos que o servidor mostrou como eco |
| Somente comandos | Comandos já reconstruídos pelo processador existente, sem saídas; mantém SQL multilinha |
| Relatório técnico | Formato anterior com eventos, autoria, hashes, versão e diagnósticos |

O JSONL original e o playback continuam disponíveis. Não há alteração no transporte SSH, captura, interpretação de comandos, persistência, índices ou experiência do terminal ao vivo. Não é necessária migração SQL nesta entrega.

## Interpretação da apresentação

Foi adicionado `@xterm/headless` **5.5.0**, restrito ao backend e fixado no lockfile. A dependência fornece o emulador de terminal sem interface; evita implementar novamente a máquina de estados de ANSI, cursor e caracteres. A versão do xterm do terminal ao vivo não foi alterada.

O módulo `session-audit-text-export.ts` alimenta esse emulador apenas com eventos **stdout**. Entradas stdin não são repetidas no TXT visível: podem conter edição intermediária, eco duplicado ou dados que não apareceram na tela. A exportação de comandos usa o processador atual; não altera sintaxe SQL nem tenta completar conteúdo perdido.

A extração mantém linhas lógicas, unindo somente quebras automáticas de largura, e preserva as quebras explícitas. O teste de resize encontrou células vazias adicionadas pelo emulador que viravam espaços no meio de um SQL; a extração agora distingue essas células dos espaços realmente gravados. Saída anterior a clear/reset é preservada.

O processamento usa somente APIs públicas do emulador, incluindo buffer, marcadores e handlers de controles. Nenhuma resposta do emulador é enviada a um servidor; títulos, hyperlinks e sequências de clipboard não têm acesso a navegador ou clipboard. Controles de apresentação não são emitidos como escapes executáveis no arquivo.

Referências: [xterm headless](https://github.com/xtermjs/xterm.js), [codificação e fragmentação Unicode](https://xtermjs.org/docs/guides/encoding/), [hooks de interpretação](https://xtermjs.org/docs/guides/hooks/). A documentação do [MobaXterm](https://mobaxterm.mobatek.net/documentation.html) distingue o log de atividade do texto salvo do terminal; o exemplo fornecido tem resíduos do vim, portanto não é uma referência de reconstrução semântica perfeita.

## Limites explícitos

- Aplicativos que usam buffer alternativo, como vim/htop, geram aviso no TXT para consultar o playback. Seus quadros e redesenhos não são achatados em uma linha ilegível; o texto do buffer normal é preservado. O relatório técnico/JSONL mantém os eventos desses aplicativos. Não se promete transcrição integral da interface de uma aplicação em tela cheia.
- Texto já corrompido na captura não pode ser recuperado com certeza. Quando a fonte contém `�`, o TXT mantém o caractere e informa a limitação. Não se aplica conversão automática de charset sobre as gravações Unicode do NodeAccess.
- O log MobaXterm fornecido usa bytes compatíveis com Windows-1252. Sua conversão ocorreu **somente no teste de importação do exemplo**, não no fluxo da aplicação.
- Sem dimensões gravadas, utiliza-se 80 × 24, com aviso. Dimensões acima de 512 × 200 são limitadas com aviso. O TXT é uma representação textual, não uma reprodução visual pixel a pixel; graphemes complexos e programas fora do protocolo suportado pelo emulador exigem revisão pelo playback/JSONL.
- Lacunas de sequência reiniciam a interpretação da apresentação e recebem marcador; não se concatena texto através de um trecho ausente.
- Há limite de 16 MiB de stdout de entrada e de texto produzido no formato legível, com erro 413 e orientação para baixar JSONL. Não há truncamento silencioso quando esse limite é excedido.
- O buffer do emulador mantém 4.096 linhas de scrollback, drenadas incrementalmente com marcadores. O teste com 6.000 linhas verifica que o TXT não se limita às últimas linhas do buffer.
- Até duas exportações simultâneas por instância do serviço; excesso retorna 503. Lotes de escrita limitam o trabalho por ciclo e agregam eventos pequenos. Não há cache adicional de arquivos TXT nem cópia persistente em disco no servidor.
- Erros transitórios do endpoint de exportação são tratados localmente. Um 503 de exportador ocupado não agenda recarga global da página; autenticação e recuperação dos demais endpoints permanecem inalteradas, com testes no interceptor real do cliente HTTP.
- A autorização/retencão é revalidada após a renderização assíncrona, antes de enviar o download. Os três formatos mantêm os mesmos guards administrativos e isolamento por tenant.

## API e compatibilidade

`GET /api/v1/session-audit/:sessionId/transcript?format=terminal|commands|technical`.

O parâmetro é opcional: ausência seleciona `terminal`. Consumidores que dependam do antigo corpo detalhado devem usar `format=technical`. Os nomes são `session-audit-ID.txt`, `session-audit-ID-commands.txt` e `session-audit-ID-technical.txt`. Respostas permanecem UTF-8, attachment, no-store e nosniff.

Para instalação/build, executar o fluxo habitual com `npm ci`; a nova dependência de produção está declarada no workspace backend. Nenhuma publicação em produção foi realizada.

## Testes e simulações

Resultados: **249 testes de backend**, **39 testes de frontend** e **10 cenários Playwright** passaram. A regressão adicional do playback, incluindo sessão longa, erro/vazio/truncamento e 600 comandos, também passou em desktop/mobile. Typecheck do backend e frontend e lint dos novos arquivos de exportação e recuperação local passaram. A execução integrada local e os quatro casos de SQL também passaram. Os testes de tela exercitam os três downloads em desktop/mobile, além da navegação por teclado na comparação de versões.

Testes específicos cobrem: eco sem duplicação; stdin oculto; ANSI/OSC fragmentados; backspace; cursor e erase-in-line; SQL editado; resize; preservação de espaços reais; acentos, caracteres combinados, CJK e par substituto fragmentado; milhares de eventos pequenos; 6.000 linhas; clear e limpeza de scrollback; buffer alternativo encerrado ou ainda aberto; fonte com caracteres de substituição; lacunas; ausência de stdout; exportação grande demais; concorrência e liberação de recursos; snapshot original imutável.

Rotas validam formatos, nomes, UTF-8, conteúdo, formato inválido, autorização e retenção após renderização. A regressão do processador de comandos continua incluída.

Os eventos locais preservados dos casos 136/166/183/184 foram exportados nos novos formatos. Verificações automáticas confirmam:

- Contagens de comandos preservadas: 14, 9, 7 e 6.
- Os cinco SQLs de 509 caracteres da sessão 183 aparecem completos no TXT legível.
- Os quatro SQLs longos da sessão 184 (429/440 caracteres) aparecem completos.
- Os comandos também permanecem completos no formato “Somente comandos”.
- A geração dos TXT não modifica os snapshots.
- O exemplo MobaXterm mantém os comandos de referência e os acentos após a decodificação explícita do teste.

Na API integrada do laboratório, sessão 4177: 712 eventos, 10 comandos e três formatos aprovados. O relatório técnico tem 212.520 bytes; o legível, 6.054 bytes. São documentos de propósitos diferentes, não uma medição de compressão.

As simulações Playwright verificam desktop/mobile, os três downloads, nomes e conteúdo, falhas, comparação/reprocessamento existentes, avisos de fonte parcial, limite de tamanho e retenção. Os dados desses testes de tela são sintéticos.

```sh
AUDIT_EXPORT_REVIEW_DIR=/caminho/privado npx vitest run apps/backend/src/modules/session-audit
AUDIT_EXPORT_REVIEW_DIR=/caminho/privado MOBAXTERM_REVIEW_LOG=/caminho/exemplo.log npx tsx tools/session-audit/readable-export-review.mts
FRONTEND_BASE=http://127.0.0.1:5182 node tools/frontend/audit-reconstruction-playwright.cjs
FRONTEND_BASE=http://127.0.0.1:5182 node tools/frontend/session-playback-playwright.cjs
```

Os JSONL originais das quatro sessões não estavam mais disponíveis nesta revisão; o corpus usa eventos preservados na análise anterior, conforme documentado anteriormente. TXT com dados reais fica apenas em `/tmp/nodeaccess-readable-export-review`, fora do repositório. Evidências sanitizadas: `docs/reviews/evidence/2026-09-29-readable-audit-txt`.

## Arquivos principais

- Backend: `session-audit-text-export.ts`, serviço/controlador/rotas da auditoria e testes correspondentes.
- Frontend: `AuditReconstructionPanel.vue` e `sessionAudit.service.ts`.
- Dependências: `apps/backend/package.json` e `package-lock.json`.
- Ferramentas: `readable-export-review.mts`, revisão integrada local e cenários Playwright da reconstrução.
- Recuperação local: classificação específica de `/session-audit/:id/transcript` no cliente HTTP e teste `session-audit-export-recovery.test.ts`.

A tela de auditoria não está mapeada em `docs/manual/manifest.json`; não houve alteração nos procedimentos mapeados de Hosts/terminal ao vivo. Testes de PTY/área do terminal não se aplicam a esta renderização offline.
