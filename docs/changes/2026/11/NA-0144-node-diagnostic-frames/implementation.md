# NA-0144 — Registro da implementação

## Pedido e objetivo

Corrigir ausência de coordenadas para assertionasync real. A asserção específica doCI continua desconhecida.

## Implementação

Base SHA: b568eccf0e2c8048842c8db830ec42639c59c287. Branchisolada; nenhuma fonte integração alterada.

## Validação

Reprodução before:3childrenreais, assertionexit1/log290B/diagnosticnull; TypeErrornormaltemposição e Error[TimeoutError] classificadoOTHER.

## Recuperação

Revertercommit; semmudança de serviços/política.

## Pendências

Contratos, revisão e checkpoint. Índices/workbook coordenados pela raiz.

## Diário de interações

### 2026-11-03T22:12:35.494979-03:00 — Causa e escopo aprovados

Não é falha de64KiB/capture: parserrejeita sufixo literal aberto porNode para inspecionarpropriedadesError. Corrigir formatos observados sememitirtextolivre e semregexcombacktrackingaberto.

### 2026-11-03T22:13:23.610652-03:00 — Correção focal validada

Alteradas somente duas linhas do helper: sufixo literal opcional aberto porinspeçãoNode e CR final deCRLF noframe, mais cabeçalho literal Error [TimeoutError]: reconhecido comoTIMEOUT. Não aceitartexto apósbrace, múltiplasbraces, tabs no lugar doespaço ou nomesforaallowlist. Boundsnuméricos, reader64KiB/O_NOFOLLOW/fstat e política permaneceminalterados.

42/42 contratos passaram; lint2arquivos e diffcheckPASS. Novoschildrenreais exercitam três erros catchasync+console.error: assertion agora projetaASSERTION+linha/coluna, timeout emitido comoError[TimeoutError] projetaTIMEOUT, TypeError mantémOTHER. Matriz5basenames×4sufixos×2terminadores e negativosmaliciosos/bounds passaram. Testesanteriores declassificação e logslongos mantidos.

A reprodução comprova defeito do parser, não que a falha histórica doCIfoi determinada assertion. FrenteNA0143 segueinvestigaçãofuncional; nenhuma espera/assertionfrontend alterada aqui. Semscanner/browser/instalação/VPS nesta frente; dependênciasNA0141 somenteleitura via symlink. Revisão independente emandamento.

### 2026-11-03T22:14:17.728142-03:00 — Revisão independente e checkpoint

Backend reproduziu42/42, incluindo3childrenasync reais e4inputsadversariais. Leu2fontes e evidênciabefore:PASS_WITH_WARNINGS, sembloqueador. Allowlist3campos e sufixosconstantes preservados; semscanner e sematribuir a falhafuncionaldoCIao caso sintético.

Docs sincronizadoscanônico; checkpoint local autorizado. Próxima etapa: integração e revalidação; NA0143 mantém investigação funcional. Índices/workbook coordenados pela raiz.
