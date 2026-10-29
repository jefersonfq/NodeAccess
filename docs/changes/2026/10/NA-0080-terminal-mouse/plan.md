---
change_id: NA-0080
title: Encaminhamento de mouse binário do terminal
type: fix
status: ready-for-tests
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
Contrato/adaptador xterm, sessão SSH e participante de sessão compartilhada; testes e revalidação do manual. Sem alterações de backend, geometria ou dependências.

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
Consultar implementation.md. Ensaios de navegador usam HTTP/WebSocket simulados. PTY real depende de HOST_ID descartável.

## Baseline
9a93fbd01e900cfa73eb6708199dcfe99592ae89; árvore inicialmente limpa.

## Rollback ou recuperação
Reverter somente o diff desta frente; sem migração ou configuração persistente.

## Aprovação
Usuário autorizou correção e simulação de efeitos colaterais. Não houve autorização de publicação nem homologação humana.

Decisão: GO_WITH_RISKS — correção validada em simulação; PTY real pendente. Não representa homologação humana ou autorização de publicação.

## Preparação do pacote solicitada
Em 28/10/2026, usuário autorizou geração do pacote e envio à VPS existente. Versão reservada: 2.1.1-na0080. Empacotador oficial exige commit limpo; commit local incluído no preparo autorizado. Não publicar GitHub nem declarar merge. Confirmar checksum após transferência para diretório de pacotes. Atualização dos containers depende da definição explícita de “subir”; upload por si só não reinicia serviços.
