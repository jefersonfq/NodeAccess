# PRD - Dashboard do Host

## Objetivo

Criar uma visao centralizada por host para decisao, auditoria e suporte operacional. A tela deve permitir que admin e usuario consultem rapidamente o historico do host, entendam tendencia de uso e acessem as telas detalhadas ja filtradas.

## Valor

- Reduzir tempo de investigacao de incidentes e falhas de acesso.
- Consolidar evidencias de auditoria por host.
- Dar contexto operacional antes de abrir uma sessao SSH.
- Apoiar decisoes sobre hosts criticos, uso recorrente, erros, origem WAN e necessidade de ajustes.

## Publico

- Admin: ve o historico completo do host dentro do tenant.
- Usuario: ve o host que possui acesso e apenas suas proprias sessoes/auditorias, evitando vazamento de atividade de outros usuarios.

## Escopo MVP

- Rota autenticada: `GET /api/v1/hosts/:id/dashboard?periodDays=7|15|30|60`.
- Tela: `/hosts/:hostId/dashboard`.
- Periodos: 7, 15, 30 e 60 dias.
- Resumo do host: nome, IP, porta, usuario SSH, escopo, modo de conexao, bastion efetivo e tags.
- Indicadores: sessoes, sessoes ativas, falhas, usuarios unicos para admin, auditorias, eventos auditados, trafego auditado, compartilhamentos e forwardings.
- Graficos:
  - tendencia diaria de sessoes e falhas;
  - distribuicao por rota de conexao;
  - origens recentes por IP WAN/navegador;
  - postura de auditoria/risco.
- Lista de sessoes recentes.
- Atalhos para telas existentes com filtros por host/periodo quando suportado.
- Timeline do host com filtros por tipo/severidade e itens expansíveis.
- Drilldown dos graficos para sessoes e auditorias filtradas.
- Saude operacional do host com score, status e motivos.
- Indicador de cache, horario de geracao dos dados e botao para atualizar ignorando cache.

## Regras de Permissao

- Admin consulta todos os dados do host no tenant.
- Usuario comum precisa ter acesso ao host por escopo pessoal, equipe ou global.
- Usuario comum ve apenas dados vinculados ao proprio `userId`.
- Dados de outros usuarios nao aparecem na visao comum.

## Performance e Cache

- O resumo deve ser carregado por um unico endpoint.
- O backend pode usar Redis com TTL curto.
- Chave de cache deve considerar `tenantId`, `hostId`, `periodDays`, `role` e `userId`.
- TTL inicial recomendado: 45 segundos.
- A tela deve mostrar se a resposta veio do cache, o TTL e o horario em que os dados foram gerados.
- A tela deve permitir atualizar ignorando o cache em investigacoes operacionais.
- Futuro: expor tempo de cache e limpeza manual em configuracoes.

## Fora do MVP

- Timeline paginada completa.
- Historico estruturado de alteracoes do host quando o log antigo nao possuir `hostId` confiavel.
- Graficos com biblioteca externa.
- Configuracao visual do cache.

## Evolucao Recomendada

1. Criar timeline paginada: sessoes, auditorias, compartilhamentos, forwardings e alteracoes.
2. Estruturar logs administrativos de host com detalhes pesquisaveis.
3. Adicionar invalidacao de cache por evento alem do TTL.
4. Avaliar exportacao CSV/JSON do historico do host.
