# NA-0083 — Registro da implementação

## Pedido e objetivo

Implementar etapa2 da jornada de IA e avaliar instalação Ollama/modelo via interface, inclusive em servidor dedicado e watchdog após homologação.

## Implementação

Base SHA: f4a44b4b7ae87a8f688b1246d9e52a31f9a104bc. Código em /tmp/nodeaccess-NA-0083; documentos canônicos em NodeAccess-current/docs. Implementados jornada, homologação da revisão, monitor opt-in, proteção CAS, quota e preparação assistida Docker com manifesto/SHA. Automação SSH especificada separadamente.

## Validação

Ran: 122 testes da frente, 61 regressões (com sobreposição), browser desktop/mobile, builds shared/backend/frontend, lint38arquivos e revisões independentes. Evidências/limites em test-results.md. Ampliação WSL: MySQL/Redis, API/browser e instalação Ollama CPU reais executados; detalhes e limites na seção final. GPU/ambiente final pendentes. Manual: homologação/publicação.

## Recuperação

NA0081/NA0082 preservadas. Sem commit/publicação. Não remover instalações/modelos remotos existentes.

## Pendências

Usuário confirmou que a máquina ainda não foi definida e pediu preparar fluxo/plano sem instalação real. Pedido posterior autorizou laboratórios descartáveis no WSL, incluindo instalação real apenas dentro do laboratório. Execução SSH automatizada exige extensão com job durável; preparação assistida pertence a esta entrega.

## Diário de interações

### 2026-10-30T09:20:56-03:00 — Escopo da etapa2

Usuário solicitou jornada completa e avaliação de provisionamento em máquina dedicada. Pesquisa oficial confirmou Docker/Linux e API local sem autenticação. Planejadores identificaram rascunho/teste e TTL na UI, e limitações do executor SSH para instalações longas. Definido pacote assistido seguro, homologação vinculada à configuração e monitoramento opt-in sem reparo automático; automação SSH detalhada como extensão. Próximo passo implementar baseline e contratos.

### 2026-10-30T09:28:01-03:00 — Sem instalação real

Usuário confirmou ausência de máquina definida; preparar fluxo e plano, sem instalar em servidor real. Mantidos pacote assistido, validações locais/simulações e monitoramento desarmado. Não acessar nem modificar VPS para esta frente.

### 2026-10-30T09:53:17-03:00 — Implementação e validação local

Jornada salva/testa a configuração efetiva, preserva rascunhos e descarta respostas antigas. Homologação explícita e monitor opt-in vinculados à revisão; worker fora do SSH, sem reparo, com CAS/lease/timeout/backoff e quota mensal. UI prepara pacote Docker com prévia e SHA, sem execução remota. Revisão corrigiu digest conforme documentação oficial, limite de saída, orçamento automático e payloads inválidos. Ran: suites e checks em test-results.md, todos aprovados; revisão PASS_WITH_WARNINGS por falta de ambiente real, sem bloqueantes. Servidor temporário encerrado; nenhum host/VPS alterado. Documentos canônicos sincronizados em NodeAccess-current/docs. LOCAL_WIP sem commit/push/PR/merge/deploy; próxima decisão operacional é selecionar o servidor e o caminho de rede protegido, sem presumir homologação.

## 2026-10-30T10:20:30-03:00 — Ampliação da validação

Usuário autorizou enriquecer testes/simulações e laboratório em container no WSL. Docker Engine28.1.1 e Compose2.35.1 disponíveis. Mantida frente NA-0083 e checkout isolado para preservar mudanças NA-0081/82. Planejada validação com MySQL/Redis e HTTP reais, além do instalador em ambiente descartável; sem acesso à VPS. Resultados pendentes de execução.

### 2026-10-30T10:30:02-03:00 — Laboratórios reais e correções necessárias

Pedido de enriquecer testes atendido com cinco harnesses/helpers em tools/ai-journey e comandos npm opt-in. MySQL/Redis/API/browser reais e instalador Bash/Python sem alteração executado em DinD exclusivo, Ollama/modelo pequeno realCPU. Descobertos e corrigidos deadlock na cota mensal (upsert exclusivo inicial) e falso conflito de porta após parada (SO_REUSEADDR sem SO_REUSEPORT). Alterações adicionais apenas de tipo/fixtures e robustez dos harnesses. Ran:122core,15data-plane,15HTTP/browser,10instalador,21unitários de correções e buildbackend; lint final40arquivos sem erros/avisos; resultados independentes PASS_WITH_WARNINGS. Teardown confirmado, sem containers/volumes remanescentes e sem acessar VPS. Documentos e guia de reprodução em docs do projeto atual; código no checkout isolado. Limites: GPU, máquina/rede definitiva, qualidade do modelo e filas completas/login não certificados. Próximo passo operacional permanece selecionar o ambiente definitivo; sem inferir homologação humana de clique automatizado. Sem commit/publicação.
