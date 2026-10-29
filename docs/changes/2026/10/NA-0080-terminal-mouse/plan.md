---
change_id: NA-0080
title: Encaminhamento de mouse binário do terminal
type: fix
status: in-homologation
created_at: 2026-10-28T23:04:27-03:00
base_branch: master
base_sha: 9a93fbd01e900cfa73eb6708199dcfe99592ae89
branch: fix/NA-0080-20261028-terminal-mouse
owner: root
planner: root
risk: medium
---

## Contexto e situação anterior
Relato de cliques em cabeçalhos do htop sem efeito. O xterm instalado emite o protocolo DEFAULT por onBinary, sem consumidor no adaptador atual.

## Problema e objetivo
Encaminhar eventos binários de mouse sem transformar coordenadas em UTF-8 e preservar entrada textual e permissões.

## Escopo
Contrato/adaptador xterm, sessão SSH e participante de sessão compartilhada; testes e revalidação do manual. Sem alterações de backend ou geometria. Correção necessária ao gate de integração: patch vue-i18n 11.4.13 → 11.4.14, sem nova dependência.

## Critérios de aceitação
- [x] Cliques e soltura preservam bytes acima de 127; SGR e texto UTF-8 continuam funcionais.
- [x] Rolagem remota funciona; cliques no shell sem mouse tracking não enviam entrada.
- [x] Sem entrada binária fora da conexão ou sem controle autorizado.
- [x] Reconexão e desmontagem descartam listeners antigos.

## Estratégia técnica
Expor onBinary e converter cada code unit para Uint8Array. Usar os canais WebSocket existentes, sem passar pelo processamento textual de comandos/IA. Preservar broadcast explícito da sessão principal.

## Riscos e mitigações
Codificação incorreta corrompe coordenadas: verificar bytes reais no navegador. Listener duplicado repete cliques: testar descarte. Permissões: usar canInput existente e testar revogação, expiração e encerramento.

## Matriz de testes e evidências
Consultar implementation.md. Ensaios de navegador usam HTTP/WebSocket simulados. PTY real com top/htop e clique real no cabeçalho do htop passou em laboratório SSH descartável no candidato da entrega; evidências privadas preservadas em backups/NA-0080-20261029. Checks do próximo SHA documental serão registrados no PR.

## Baseline
9a93fbd01e900cfa73eb6708199dcfe99592ae89; árvore inicialmente limpa.

## Rollback ou recuperação
Reverter somente o diff desta frente; sem migração ou configuração persistente.

## Aprovação
Usuário autorizou correção, simulações, pacote, backup completo e atualização da VPS. Em 29/10/2026 autorizou integração no GitHub e nova conferência da instalação. Usuário confirmou teste local funcional em 29/10/2026; relatou dúvida sobre atualização na VPS.

Decisão: GO_WITH_RISKS — correção validada em simulação e SSH descartável, com revisão independente. Integração autorizada; merge depende dos checks atuais; homologação humana local informada pelo usuário.

## Preparação do pacote solicitada
Em 28/10/2026, usuário autorizou geração do pacote e envio à VPS existente. Versão reservada: 2.1.1-na0080. Empacotador oficial exige commit limpo; commit local incluído no preparo autorizado. Não publicar GitHub nem declarar merge. Confirmar checksum após transferência para diretório de pacotes. Atualização dos containers depende da definição explícita de “subir”; upload por si só não reinicia serviços.

## Situação da entrega e integração
Pacote 2.1.1-na0080 entregue e frontend atualizado na VPS, com backup privado e restore SQL isolado validados. A autorização posterior incluiu atualização dos containers; a operação recriou somente frontend. Em 29/10/2026, nova consulta HTTPS confirmou a versão no JavaScript e os cinco assets previstos. Após correção do acesso pelo usuário, SSH confirmou imagem frontend prevista, seis serviços ativos e hashes dos cinco assets idênticos ao HTTPS público. A integração GitHub agora está autorizada. Código do produto permanece idêntico ao candidato implantado; esta retomada reconcilia documentação e executa gates do PR.

## Correção necessária ao gate de integração
O check obrigatório dependencies do PR #58 bloqueou merge por cinco alertas altos na cadeia vue-i18n 11.4.13 já existente na base. Classificação: NECESSARY_CORRECTION. Atualizar somente vue-i18n e quatro pacotes @intlify para 11.4.14, versão corrigida informada pelo advisory oficial GHSA-83rm-6c8r-g728. Validar auditoria sem achados, tipos, build/CI e regressão de terminal. Risco localizado em interpolação/sanitização de traduções; sem alteração de traduções ou APIs. Não executar novo deploy por esta integração: a VPS conferida permanece na release 2.1.1-na0080, anterior a este patch de dependência.
