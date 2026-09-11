# PRD Lite — Topologia e documentação por cliente

Data: 2026-09-10. Status: proposta; nenhum módulo visual implementado por esta tarefa.

## Objetivo e escopo

Módulo opcional para compreender caminhos de acesso e documentar projetos. MVP combina hosts cadastrados, bastions/conectores e elementos manuais, sem descoberta ativa obrigatória. Tenant é a fronteira de isolamento; projetos pertencem ao tenant. Não introduzir um cadastro paralelo de cliente sem validar o modelo comercial existente.

## Modelo mínimo proposto

- `TopologyProject`: tenant, nome, descrição, responsáveis, revisão e política de acesso.
- `TopologyNode`: referência ao host/conector/bastion existente ou elemento virtual (firewall, rede, VPN, internet, serviço externo), posição e anotações.
- `TopologyEdge`: origem/destino, tipo (caminho de acesso, dependência lógica ou ligação de rede), direção, protocolo/porta quando conhecidos, fonte e instante de verificação.
- Relação carrega proveniência: cadastrada, observada ou manual; sugestões inferidas ficam separadas até revisão. Uma conexão bem-sucedida prova alcançabilidade naquela origem/instante, não cabeamento ou dependência de aplicação.
- Host virtual não fornece conexão, credencial, licença de host ou acesso implícito. Vincular a host real exige ACL; excluir um nó do desenho não exclui o host.

Reaproveitar fonte de verdade do inventário. Layout e anotações não sobrescrevem configuração de bastion, agente ou ACL. Alterar um desenho não muda roteamento de produção.

## Experiência proposta

Página do projeto com resumo, responsáveis, diagrama e documentação. CTA inicial “Adicionar hosts”; seleção múltipla inclui apenas recursos permitidos. Usuário pode adicionar elemento virtual, conectar elementos, agrupar por ambiente/site, buscar e abrir detalhes.

Mapa inicial evidencia caminhos configurados (NodeAccess → bastion/conector → host), com rótulo quando se tratar de alternativas e não da rota efetivamente usada. Histórico observado tem data e origem próprias. IPs na mesma sub-rede não geram ligação automática.

Painel lateral mostra informações do nó, relações, proveniência e última atualização. Conectar exige permissão atual do host. Filtros por ambiente, site, protocolo e, futuramente, postura de segurança. Evitar carregar o catálogo inteiro para desenhar uma tela.

Estados: projeto vazio, carregando, falha com tentar novamente, salvando, salvo, conflito de revisão, recurso excluído, informação desatualizada e acesso restrito. Alteração concorrente deve produzir conflito explícito ou merge revisável; não sobrescrever silenciosamente.

Oferecer lista/tabela equivalente ao grafo, edição por formulário e teclado, foco visível e rótulos textuais. Em tela pequena, priorizar lista e detalhes. Não depender de drag-and-drop, hover ou cor para tarefas essenciais.

## Documentação e exportação

MVP: snapshot versionado com diagrama SVG/PNG e inventário/relações em JSON e Markdown; PDF e formato editável de ferramenta externa são evolução. Exportar projeto, data, revisão, legenda, fontes e limitações; distinguir projetado de observado.

ACL aplicada no servidor tanto ao grafo quanto à exportação: acesso ao projeto não amplia acesso aos hosts. Não vazar nomes, IPs ou relações ocultas por contadores, vizinhos ou endpoints. Metadados virtuais também seguem a política do projeto. Não exportar segredos, referências sensíveis ou links JIT/tokens.

Usar texto escapado e sanitizar anotações, links e SVG; evitar HTML arbitrário. Exportações são snapshots e podem ficar desatualizadas; não criar publicação pública por padrão. Auditar edição/exportação conforme política. Host excluído mantém referência histórica somente para quem pode consultá-la.

## Arquitetura e evolução

Manter serviços de projeto/grafo separados de inventário e transporte; API resolve referências autorizadas. No frontend, separar canvas, painel, lista acessível e estado de edição. Selecionar biblioteca somente na implementação, considerando licença, teclado, escala e exportação.

Integrações futuras candidatas: CMDB/NetBox, inventário cloud e ferramentas de documentação, mediante demanda. Importação deve preservar origem, reconciliar identidades e mostrar diff; nunca substituir inventário silenciosamente. Descoberta de rede, LLDP/SNMP e relações de aplicações ficam fora do MVP.

## Validação e valor

Validar projeto com hosts reais e virtuais, duas rotas alternativas, referência excluída, usuário com acesso parcial, exportação e edição concorrente. Testar teclado e tela estreita e definir orçamento de nós/arestas com dados reais antes de prometer escala.

Medir tempo para explicar caminho de acesso e gerar documentação do cliente. Principal risco: desenho parecer uma descoberta completa e atual da rede. Proveniência e data devem permanecer visíveis na tela e no documento exportado.
