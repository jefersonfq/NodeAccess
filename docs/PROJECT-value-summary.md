# NodeAccess: resumo de valor

## Proposta de valor
O NodeAccess centraliza o acesso SSH da empresa em uma interface web unica, com foco em seguranca, rastreabilidade e operacao colaborativa. Em vez de depender de clientes locais, configuracoes manuais e conhecimento disperso entre times, a plataforma organiza o acesso a hosts, sessoes e credenciais em um ponto controlado e auditavel.

## O que ja entregamos
- acesso SSH centralizado via navegador
- MFA/TOTP obrigatorio e controle de autenticacao
- hosts com escopo pessoal, equipe e global
- suporte a senha, PEM e `PEM + senha`
- bastion/jump host
- sessoes multiplas no terminal web
- SFTP e acesso a arquivos
- acessos locais (`port forwarding`) integrados ao host
- integracao com 1Password por referencia
- Google SSO e base para integracao com Google Workspace
- administracao de usuarios, grupos, integracoes e logs

## Diferenciais do projeto
- auditoria de sessao SSH com reconstrucao de comandos e contexto operacional
- tratamento seguro de mudanca de host key, com aceite explicito e historico
- compartilhamento de acesso em dois formatos:
  - link para abrir sessao propria no host
  - sessao ao vivo para acompanhamento colaborativo
- sessao ao vivo com pedido de controle, concessao temporaria, retomada pelo owner e trilha auditavel
- dashboard e logs administrativos com visao operacional e filtros uteis
- melhorias de resiliencia e UX para sessao expirada, atualizacao de interface e uso continuo do terminal
- experiencia mais proxima de uma ferramenta operacional real, sem perder governanca

## Beneficios para a empresa
- reduz dependencia de ferramentas locais nao padronizadas
- aumenta rastreabilidade e controle sobre acessos sensiveis
- facilita suporte, operacao assistida e troubleshooting entre equipes
- organiza hosts, credenciais e acessos em uma camada central
- cria base para compliance, governanca e futuras evolucoes, como IA local controlada

## Resumo executivo
O NodeAccess nao e apenas um terminal web. Ele ja se posiciona como uma camada central de acesso operacional, combinando seguranca, auditoria, colaboracao e governanca. O ganho para a empresa e ter mais controle e visibilidade sem perder agilidade no dia a dia tecnico.
