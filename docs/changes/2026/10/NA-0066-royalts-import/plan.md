# NA-0066 — Importação Royal TS

## Objetivo
Adicionar Royal TS ao fluxo Importar Hosts, reaproveitando prévia, confirmação, duplicatas, hierarquia, política de rede e credenciais.

## Escopo e decisão
Suporte ao CSV exportado oficialmente por Data → Export → Comma Separated File, com Export Headers. Name/URI, Username, ConnectionType (inclusive ssh;SSH e telnet;Telnet), ObjectType, Port/RDPPort e FolderPath/ParentPath opcionais. Separadores vírgula, ponto e vírgula ou tab; UTF-8/UTF-16 BOM. Protocolo explícito escolhido pelo usuário quando ausente; não presumir por número de porta.
Documentos nativos .rts/.rtsx/.rtsz recebem orientação para exportar CSV; sem tentativa de descriptografia. RoyalJSON não é anunciado como exportação do Royal TS. Não converter macros, chaves, credenciais vinculadas, gateways, descrições ou opções avançadas. Senha literal usa consentimento administrativo existente.

## Implementação
1. Parser limitado e detecção por cabeçalhos; dados inválidos corrigíveis ficam na prévia.
2. Aba Royal TS com instruções, protocolo, erros e resumo de tipos ignorados.
3. Fonte royalts no contrato compartilhado; backend transacional existente.
4. Testes de parser, HTTP/serviço, Playwright com falhas, recuperação e regressão dos demais formatos.
5. Manual, capturas, evidências e registro.

## Fontes oficiais
- https://docs.royalapps.com/products/royalts/advanced/export.html
- https://docs.royalapps.com/products/scripting/objects/connections/royalsshconnection.html
- https://docs.royalapps.com/products/scripting/objects/connections/royalrdsconnection.html
- https://docs.royalapps.com/products/scripting/objects/connections/royalvncconnection.html

## Limites da homologação
Fixtures sintéticas baseadas nas propriedades documentadas. Sem aplicativo Royal TS instalado ou exportação real fornecida pelo usuário. Navegador usa API simulada; backend exercitado separadamente. Sem publicação.
