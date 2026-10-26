# Páginas do teste

Identificação e contato foram fornecidos/autorizados pelo responsável. Apenas o
endereço público de contato foi incorporado; nenhuma credencial SMTP acompanha
estes arquivos. O conteúdo descreve o comportamento implementado e não representa
certificação jurídica ou garantia geral de conformidade.

Marketing e convites a pesquisas usam opções independentes desmarcadas, revogáveis;
recusa não bloqueia a conta. Não reutilizar logs de terminal/credenciais/arquivos
para propostas ou segmentação. Uma futura exportação comercial precisa respeitar
finalidade, consentimento vigente, minimização e exclusão; não foi criada uma
plataforma automática de inteligência de marketing nesta entrega.

Referências primárias consultadas em 2026-10-24:
- [LGPD, especialmente arts. 7, 8, 9 e 18](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm).
- [Guia ANPD sobre legítimo interesse](https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/guia_orientativo_hipoteses_legais_tratamento_de_dados_pessoais_legitimo_interesse).

Não presumir que legítimo interesse autoriza coleta irrestrita nem que consentimento
para convite permite reutilizar conteúdo de sessões. Prazos de backups e logs de
infraestrutura exigem configuração operacional separada; a limpeza da base ativa
não apaga automaticamente esses registros.

Validação visual feita nas duas páginas em 390 e 1440 px, sem overflow horizontal;
links e foco devem ser novamente conferidos na publicação. Usar o HTML atual do
site para inserir o CTA e os links, sem substituir assets ou demais seções.

## Atualização do CTA (NA-0072)

`trial-cta.html`, `trial-cta.css` e `trial-cta.js` definem o CTA “Faça um teste”. Inserir o fragmento no lugar do link anterior do hero, carregar CSS/JS como assets próprios e preservar o restante do site. Tooltip disponível em hover/foco, dispensável com Escape e apresentado como texto em telas touch. Não é uma promessa de acesso antes da confirmação de e-mail. Publicar o aviso atualizado antes de habilitar o formulário com telefone.

O telefone é opcional, cifrado e destinado ao contato solicitado sobre a avaliação. Não muda as escolhas de marketing/pesquisa. Revisão jurídica humana permanece distinta da implementação técnica.

## Transição do CTA (NA-0075)

O CSS/JS do CTA apresenta feedback não modal ao abrir o cadastro, respeita movimento reduzido e preserva cliques para nova aba. O retorno pelo navegador limpa o estado. O href continua funcional sem JS. Na publicação atual, atualizar apenas `assets/trial-cta-na0072.css` e `.js`, servidos com `Cache-Control: no-cache`, com backup e CAS; não substituir o index.

## Movimento nativo de páginas (NA-0076)

Substitui o cartão visual da NA0075 pela saída do conteúdo principal (90ms ease-in, fade/-4px). A chegada do cadastro usa CSS scoped em TrialView (170ms ease-out, fade/+6px), igual ao padrão page do app. São origens distintas: atualizar os dois assets do site e a imagem do frontend. Movimento reduzido usa link nativo sem espera, e o retorno limpa a classe de saída. O aviso de carregamento permanece apenas para leitores de tela. Backend e dados não precisam de atualização.
