# ACL de pastas: isolamento e resiliência

## Regra preservada

ACLs são concessões aditivas de usuário, grupo e role, locais ou herdadas.
Conectar/Editar implicam Visualizar; Administrar implica todas. Uma concessão
local menor não nega a concessão herdada. A ausência de fontes aplicáveis nega
acesso. Pastas pessoais organizam atalhos e não concedem acesso corporativo.
Administrar via HTTP também exige o perfil global de administração de hosts;
a ACL efetiva do item continua sendo verificada pelo serviço.

## Matriz executada

| Frente | Cenários e verificações |
| --- | --- |
| Permissões | Todas as 16 combinações de flags; normalização sem conceder Conectar por Editar |
| Usuários e grupos | Usuário específico; vários grupos; soma de fontes; retirada de um grupo preserva concessão individual; retirada da última fonte nega |
| Árvore | Herança descendente; nenhum acesso à pasta irmã ou ancestral por concessão no filho; criação posterior herda; mover host troca a herança |
| Isolamento | Usuário e grupo de outro tenant rejeitados; tenant diferente não lê a árvore nem permissões do host; role Todos os usuários restrita ao tenant |
| Organização pessoal | Vínculo com pasta pessoal permanece sem produzir acesso após revogação corporativa |
| Backend/HTTP | Anônimo, MFA pendente, usuário comum e gestor sem Administrar ACL bloqueados; tenant/ator vêm do JWT, não da query; payload inválido não grava |
| Persistência | Falha no banco não publica sucesso; repetição de upsert mantém uma entrada; falha ao resolver acesso não vira autorização |
| Sessões | Testes existentes repetidos de encerramento seletivo por perda de Conectar e alteração de associação a grupo; túneis revalidados |
| Hosts | Testes existentes repetidos de criação/movimentação com Edit/Admin no destino e validação da pasta corporativa |
| Modal | Primeira abertura; falha de carregamento e retry; trocar Alice por Bob antes da resposta; erro de preview; cancelar; 403 ao salvar e retry |
| Concessão/revogação | Grupo e usuário específico; Administrar normaliza as quatro flags; falha ao revogar preserva entradas; remover grupo preserva usuário |
| Concorrência | Formulário muda enquanto preview está pendente; confirmação grava o snapshot apresentado, sem trocar principal/permissões |
| Interface | Modal cabe em viewport 390x844; bateria existente de árvore corporativa, teclado, busca, expansão e exclusão com erro/sucesso |

## Correções realizadas

`InventoryAclDrawer.vue` usa gerações de consulta para impedir respostas antigas
no carregamento do item e na consulta do usuário. Inicializa também quando montado
já aberto, limpa resultados ao trocar item/fechar e invalida consultas ao desmontar.

A confirmação captura item, principal e permissões da prévia. Operações pendentes
não podem confirmar em outro item. Revogação trata erro com mensagem e preserva
a concessão e o diálogo para nova tentativa. Nenhuma regra de concessão do backend
foi alterada.

## Evidência

- 105 testes de serviço/repositório/rotas passaram (96 na bateria e 9 HTTP).
- 1 integração MySQL real passou, com vários cenários dentro de transação e
  rollback obrigatório. Verifica ausência dos dois tenants temporários ao final.
- Fluxos Playwright de ACL na pasta, ACL no host e árvore corporativa passaram,
  usando o frontend real e HTTP controlado.
- Typecheck frontend/backend passou. Lint dos dois arquivos novos de teste
  TypeScript passou; diff e sintaxe do workflow também foram validados.
- Lint integral dos arquivos legados não está limpo: há pendências anteriores
  de mocks async/any no teste de serviço e formatação/retornos no componente.
  Os handlers alterados usam tratamento de erro tipado; não houve reformatação ampla.
- Captura local: `/tmp/nodeaccess-acl-resilience.png`.

## Repetir

```bash
npm run test:acl:core
npm run test:acl:mysql
FRONTEND_BASE=http://127.0.0.1:5177 npm run test:acl:web
```

A bateria web exige frontend ativo e Chromium; `PLAYWRIGHT_EXECUTABLE_PATH`
permite selecionar outro executável. A integração MySQL exige schema atualizado
em banco local: usa `ACL_TEST_DATABASE_URL` ou `apps/backend/.env`, recusa hosts
não locais e não confirma fixtures. Não executar contra produção.

`.github/workflows/acl-resilience.yml` automatiza as três camadas com MySQL
isolado. O workflow foi validado sintaticamente; a execução remota ainda não ocorreu.

## Limites

Essa matriz não é prova de ausência de qualquer falha. A validação HTTP usa JWT
assinado de teste e repositório controlado; a integração MySQL exercita SQL real.
A UI usa respostas controladas para reproduzir atrasos deterministicamente.
Revogação de sessões foi repetida em testes do serviço, sem abrir SSH real nesta
rodada. Falha de comunicação entre múltiplas réplicas, indisponibilidade prolongada
do banco e perda de eventos distribuídos exigem certificação separada.
Não houve alteração de ACLs existentes, publicação ou atualização de produção.
