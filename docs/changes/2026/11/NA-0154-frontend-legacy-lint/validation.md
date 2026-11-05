# Validação NA0154

Node24.22.1, Chromium1234; dependências compartilhadas apenas para executar.

- ESLint antes:57erros568warnings emduasfontes. Depois0/0 com --max-warnings0. Nenhuma regra suprimida.
- Autocomplete28/28PASS, typecheckfrontendexit0, gitdiffcheckPASS.
- Emissão JS do parser idêntica após considerar somente letcached→const. HA idêntico após excluir da base apenas o computedlazyhaSetupComplete, sem consumidores (nenhum efeito de avaliação). Tipos de erro/retorno são apagados; não mudaram handlersasync/await/ordem.
- Renderer NÃO é byte-idêntico:11literais receberam espaços de borda pela formatação. Lista emequivalence.json; ASTigual após normalizar somente esses espaços, sem diferenças de operadores/props/listeners. CSSbyteidêntico.
- HarnessHA existente mocked-read-only:7cenários antes/afterPASS (healthy/loading/degraded/empty/unlicensed/api-error desktop1440 ehealthymobile390), findings[]. APIs/WS reais bloqueadas pelo servidor loopback, backendmockado, nenhuma operação de HA real. Baseline visual usa NA0152 com template/CSSoriginal02e7521; única mudançaHA ali éregexISO0152, que não afeta os estados capturados. Não afirmar baselineproduto inteirobyteidêntico.
- Capturas desktop/mobile/error abertas. Defeito anterior comprovado:mobilecorta conteúdo interno àdireita e toasts transientes cobrem cabeçalho emambasversões, apesar medidorhorizontalOverflowdocument=false. Não atribuir regressão nem declarar responsividade universal. PropostaUXseparada comunicada àraiz; nenhuma ampliação nesta frente.
- Revisão independente backend PASS_WITH_WARNINGS:28testes e equivalência rerodados em/tmp/NA0154-independent-{tests.log,equivalence.json}; browser atribuído ao autor. Sem scanner, leitor de tela formal ou infraestrutura HA real.
