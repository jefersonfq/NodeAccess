---
change_id: NA-0196
title: Cofre — política de entrega e liberação de itens pela tela, com motivos claros para o usuário
type: feature
status: ready-for-review
created_at: 2026-11-23T23:00:00-03:00
base_branch: master
base_sha: 012ea6b690797425369e9fe4dcbe678aa498ae87
branch: feature/NA-0196-20261123-vault-delivery-settings
owner: Jeferson Quintana
planner: Claude Code
risk: medium
issue: null
---

# NA-0196 — Política de entrega e liberação de itens pela tela

## Contexto e situação anterior

Revelar/copiar exige: política do tenant (revelar/copiar ligados), permissão da ação (dois gestores), item liberado para entrega, escopo e prova recente. Permissões, gestores, tempo de confirmação e validade das propostas têm tela (NA-0186/0188); **política e liberação de item só existem na API** (proposta + aprovação). Na homologação de 2026-11-23 o responsável tinha a permissão, mas a política estava desligada e o item não liberado: o portal pediu senha + código e respondeu só "sem permissão", sem dizer onde agir.

## Problema e objetivo

Gestores conseguem ligar a política e liberar itens pelo portal, com o mesmo fluxo de proposta/aprovação; usuários sabem, antes de confirmar a identidade, por que não podem revelar/copiar e a quem pedir.

## Onde fica cada opção (avaliação)

| Opção | Lugar escolhido | Alternativas descartadas |
|---|---|---|
| Política (revelar, copiar, cota) | Seção **Permissões do cofre (gestores)** da página do cofre, bloco **Entrega de senhas no tenant**, junto do tempo de confirmação e da validade das propostas | Guia Configurações do tenant: separaria regras do cofre e exigiria outro fluxo de aprovação; guia Usuários: é por pessoa, não do tenant |
| Liberação de item | Na linha do Secret: **Ações → Entrega do item…** (gestores) abre a administração restrita ao item, como a guia Usuários faz por pessoa; a seção dos gestores lista os itens liberados com **Retirar** | Lista de todos os itens só na seção dos gestores: descolada de onde o item é visto e mostraria nomes de itens que o gestor não vê na lista; campo no cadastro do Secret: misturaria edição (dono) com decisão de dois gestores |
| Motivo para o usuário | Na coluna **Valores** de cada Secret (em vez dos botões) + um aviso único no topo quando o motivo é geral (política ou permissão), com **Abrir configurações do cofre** para gestores | Botão desativado só com dica (`title`): invisível no celular e para leitores de tela; mensagem só depois da senha: custo para o usuário sem resultado |
| Aprovação | Aviso de pendências e lista de propostas existentes, com o conteúdo (item pelo nome; política com os valores) | Tela nova de aprovações: duplicaria o fluxo da NA-0188 |

## Escopo

- Backend:
  - `POST /vault-security/availability` (autenticado, origem conferida, limite 30/min, sem desbloquear): `{ policy: {reveal, copy}, grants: {reveal, copy}, items: number[] }`. `grants` usa a mesma regra de `tx.secret` (dois gestores diferentes, nenhum é o próprio usuário); `items` são só os Secrets liberados, não revogados e **visíveis ao usuário** (ADMIN, dono, escopo TENANT ou grupo). Só orienta a tela; cada entrega continua decidida no servidor.
  - Visão geral da administração passa a devolver `policy.reveal/copy/tenantQuota`, os itens liberados `{id, alias}` e, nas propostas de item, o nome do item; o aviso de pendências e o portal aprovam propostas de política/item.
- Portal:
  - bloco **Entrega de senhas no tenant** (interruptores + cota → proposta);
  - modo restrito ao item na administração, aberto por **Ações → Entrega do item…**; lista de itens liberados;
  - coluna **Valores**: botões só para ações disponíveis; motivo curto quando não ("Desligado no tenant", "Sem permissão", "Item não liberado"); aviso geral com orientação;
  - textos em pt-BR/en.
- Docs: manual (capítulo do cofre), operação, contrato (nota sobre `availability`).

Fora: tela "por que este usuário não consegue" para gestores; liberação em lote; extensão (E2 já trata item recusado).

## Critérios de aceitação

- [x] Gestor liga revelar/copiar pela tela; outro gestor aprova vendo os valores; a política muda.
- [x] Gestor libera um item pela linha do Secret; outro gestor aprova vendo o nome; o item aparece como liberado; **Retirar** faz o caminho inverso.
- [x] Usuário sem política/permissão/item vê o motivo na linha e no aviso, sem que o portal peça senha; com tudo liberado, os botões aparecem e abrem a confirmação.
- [x] `availability` não expõe itens fora do escopo do usuário nem dados de outros usuários.
- [x] Simulação no navegador (desktop e celular) cobre o fluxo completo, com capturas e checagem de poluição visual.

## Mudanças de escopo e decisões

- 2026-11-23 (pedido do responsável durante a frente): **Dispositivos conectados** saiu do corpo da página do cofre para um botão ao lado de **Importar chave PEM**, com janela; a identificação mostrada é a mesma que a extensão exibirá no rodapé (parte da extensão entra na NA-0195, que altera o popup).
- 2026-11-23 (simulação): proposta igual já pendente troca o botão por **Aguardando aprovação** (a simulação mostrou duas propostas idênticas para o aprovador desembaraçar); a janela do item mostra a regra em uma frase e o estado/ação primeiro; avisos com texto por papel (usuário: "peça aos gestores"; gestor: onde agir); a seção e a janela do item compartilham a sessão de administração (uma confirmação de identidade serve às duas dentro da janela de 60 s).
- 2026-11-23 (revisão independente, PASS_WITH_WARNINGS): propostas de item para Secret revogado/removido ficam fora da lista e da contagem; ids por instância; "Retirar liberação" com o nome do item; leitura de disponibilidade só vale a mais recente; comparação de propostas independente da ordem das chaves; lista de itens liberados truncada (1000) não marca item como não liberado.
- Limitações registradas: no celular, a coluna **Valores protegidos** fica na rolagem horizontal da tabela (anterior a esta frente; o aviso geral aparece); cada aprovação bloqueia o cofre de todos, então aprovar várias mudanças pede a identidade a cada uma (regra de segurança mantida).

## Riscos e mitigações

- Usuário passa a saber se um item visível está liberado e se tem a permissão: informação de orientação, sem valor nem dados de terceiros; risco baixo, aceito para eliminar pedidos de senha inúteis.
- Gestor aprovador vê o nome de um item que pode não ver na lista (proposta de item): necessário para aprovar com consciência; gestores já são papel de confiança.
- Mudanças continuam por proposta de um gestor e aprovação de outro, com incremento da versão da política (bloqueia o cofre de todos, como hoje).

## Estratégia técnica

Reaproveita o fluxo de proposta/aprovação existente (tipos `policy` e `item` já aceitos pelo backend); a leitura `availability` usa `inspect()` (origem exata e limite) e as mesmas regras de `tx.secret`; o portal só orienta, sem decidir entregas.

## Matriz de testes e evidências

vitest (backend: availability e escopo, overview, summary; frontend: componente e tela); `test:vault:real` (SQL de availability e itens com MySQL real); simulação `test:vault-administration:web` ampliada (fluxo completo + celular + capturas); `test:vault:frontend` (CI); `tsc`, `vue-tsc`, `lint:changed`, `security:scan`, `manual:check-reviewed`; revisão independente.

## Baseline

2026-11-23 sobre `2cd4932dc`: vitest vault-security + componentes do cofre + views + shared: 538 PASS, 47 skipped.

## Rollback ou recuperação

Revert da PR; sem migração. A API de proposta/aprovação de política e item já existia.

## Aprovação

Decisão: `GO` — responsável aprovou em 2026-11-23 ("Pode seguir sim"), pedindo validação dos lugares e do fluxo por simulação.
