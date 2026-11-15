# Consultar plantão durante uma sessão de terminal

Estado: implementação local NA-0084; homologação humana/publicação pendentes.

1. Na barra de ferramentas do terminal, use o ícone de prancheta **Plantão do host**. O indicador corresponde ao host em foco e às pendências abertas que você pode consultar.
2. Abra a janela para atualizar a consulta. O cabeçalho mostra o host e sua descrição cadastrada, quando disponível e autorizada.
3. Expanda uma pendência para consultar contexto, próximo passo, responsável, prioridade e prazo. **Anterior/Próxima** navegam em páginas de cinco itens.
4. **Abrir detalhe em nova aba** abre a pendência completa preservando a sessão atual.
5. Feche com **X** ou **Escape**. Fechar a janela não conclui a pendência; o foco retorna à mesma sessão, se ela continuar ativa.

A janela apenas consulta dados: não envia comandos nem altera a responsabilidade. Em tela dividida, clique no painel do host desejado antes de abrir o plantão. Trocar o host fecha o conteúdo anterior. Fullscreen mantém a janela dentro do terminal. No celular, o botão Fechar permanece disponível durante a rolagem.

## Indicador, atualização e permissões

A contagem é de um recorte recente autorizado; **9+** significa que foram encontrados pelo menos dez itens permitidos. O recorte não é um total histórico completo. Apenas acesso SSH não concede leitura de todas as notas: participação/concessão gerencial e ACL de host/auditoria continuam obrigatórias. Notas privadas não provocam um indicador de existência.

O indicador reutiliza uma consulta por host/identidade durante até 45 segundos. Abrir a janela ou usar **Atualizar** consulta novamente; a janela fechada não cria polling contínuo. Não há conteúdo de notas salvo permanentemente no navegador pelo novo componente. Mudança de usuário/tenant/permissões invalida o estado local; permissões também são verificadas na API.

- **Símbolo de indisponibilidade:** falha na consulta, não confirmação de zero notas. Abra e use Atualizar.
- **Nenhuma pendência visível neste recorte:** não foi encontrada pendência autorizada na seleção recente consultada.
- **Acesso retirado:** o conteúdo anterior é limpo; consulte o administrador para verificar permissões.
- **Enquanto lê:** copiar e selecionar texto usam o navegador; o teclado do painel não deve ser encaminhado ao SSH.

## Limites operacionais

Consulta inicial entrega apenas contagem compacta; detalhes não carregam histórico/snapshots. Backend limita varredura a 1000 metadados recentes por host e detalhes a cinco itens; não informa quantidade de registros privados nem cursor privado. Notas autorizadas mais antigas que o limite podem não aparecer neste atalho. O quadro/lista de plantão continua sendo o caminho para investigação completa.

O componente usa overlay, sem alterar o espaço do terminal ou chamar resize/fit. Testes capturam geometria, mensagens de resize, conexões e entrada; isso não equivale a garantia universal de ausência de regressões ou benchmark de produção.
