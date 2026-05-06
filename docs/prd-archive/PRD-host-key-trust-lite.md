# PRD Host Key Trust Lite

## Objetivo
Tratar primeira conexao e mudanca de host key com transparencia, bloqueio seguro e aceite explicito do usuario.

## Problema
Hoje a plataforma nao expõe um fluxo claro para:
- primeira conexao em host sem chave confiada
- chave do host alterada apos rebuild, reprovisionamento ou rotacao
- diferenciar troca legitima de risco potencial de MITM

Sem esse fluxo:
- o usuario perde contexto
- a conexao falha sem orientacao suficiente
- nao existe trilha clara de quem confiou ou atualizou a chave

## Fase 1
- detectar host sem chave confiada
- detectar mudanca de host key confiada
- bloquear conexao automatica nesses casos
- mostrar no frontend:
  - motivo: primeira confianca ou mudanca
  - fingerprint apresentada
  - fingerprint anterior quando existir
- permitir acao explicita:
  - confiar e salvar
  - cancelar
- apos confiar, tentar reconexao manual assistida pela UI
- registrar auditoria administrativa do aceite/atualizacao

## Regras
- nunca atualizar host key silenciosamente
- mudanca de host key deve exigir aceite explicito
- aceite deve persistir no host para futuras conexoes
- trilha minima:
  - host
  - usuario
  - fingerprint anterior
  - fingerprint novo
  - timestamp

## Escopo inicial
- fingerprint `SHA256`
- validacao no backend durante handshake SSH
- persistencia simples no host
- modal no terminal para confiar e seguir

## Fora de escopo inicial
- historico detalhado de rotacoes no host
- aprovacao por fluxo administrativo
- politicas por tenant para exigir aprovador especifico
- tratamento avancado por algoritmo/tipo de chave

## Evolucao recomendada
1. exibir ultima verificacao no detalhe do host
2. criar historico curto de rotacao
3. politicas diferentes para host pessoal, equipe e global

## Fase 2
- exibir no detalhe/edicao do host:
  - fingerprint atualmente confiada
  - data da ultima verificacao
- exibir historico curto baseado em auditoria:
  - primeira confianca
  - atualizacoes posteriores
  - quem confirmou
  - quando confirmou
- reaproveitar `admin_logs` antes de criar tabela dedicada
- enriquecer os eventos com:
  - fingerprint anterior
  - fingerprint nova

## Fase 3
- aplicar regra de aprovacao por escopo:
  - `personal`: dono do host ou admin
  - `team`: admin ou usuario com permissao de gerenciar hosts
  - `global`: somente admin
- manter bloqueio explicito quando a troca exigir aprovador diferente
- mostrar no terminal uma mensagem clara quando o usuario nao puder confiar/atualizar a chave
