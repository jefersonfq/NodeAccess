# Atalhos de hosts e ações de secrets

- `/forwardings` e `/links` agora navegam para `/hosts?hostId=ID`. A tela usa a consulta de IDs visíveis, independente da primeira página, mantém o filtro na recarga e oferece um marcador removível. A remoção preserva a visualização escolhida, mesmo com preferência inicial pela home. Host sem acesso/removido não é substituído por uma lista genérica. Ações em lote neste contexto ficam restritas ao ID selecionado.
- Secrets mantém “Usos” visível com ícone e contagem de hosts + snippets associados. As demais ações ficam no menu “Ações”, seguindo o padrão de usuários. Confirmações de revogação/exclusão foram preservadas; ações incompatíveis com secret revogado continuam desabilitadas.
- Contagens são obtidas em lote no backend, sem consultas HTTP por linha. Snippets com o mesmo placeholder repetido contam uma vez. Aliases com `_` ou `.` são literais, e espaços aceitos pelo resolvedor também são reconhecidos no inventário de usos.
- A contagem respeita as permissões existentes de gerenciamento. Não se expõem detalhes nem contagens a membros que só podem utilizar um secret. A API de detalhes não devolve o conteúdo dos comandos.

## Validações

- `npm run test:secrets:core`: 12 testes aprovados.
- `npm run test:secrets-vault:web`: contador, menu, busca/vazio, usos, cadastro, duplo clique, dados sensíveis, mobile e falha de conexão.
- `npm run test:host-shortcuts:web`: navegação pelas duas telas, host fora da primeira página, recarga, remoção do filtro e host indisponível.
- Build do pacote shared e typechecks de frontend/backend aprovados.

Para conferir manualmente: use “Ir para Host” nas duas telas, confira o marcador `Host #ID` e remova-o. Em secrets, compare o contador de “Usos” com os hosts/snippets do modal e abra o menu “Ações”.
