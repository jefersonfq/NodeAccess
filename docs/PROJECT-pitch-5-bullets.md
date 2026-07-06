# NodeAccess: pitch em 5 pontos

## Versao curta
- Centraliza o acesso SSH pela web e por SSH Gateway, reduzindo clientes locais, configuracoes manuais e credenciais espalhadas.
- Aplica seguranca antes da conexao, com MFA obrigatorio, permissao por escopo, bastion, cofres de segredo, controle de host key e acesso JIT temporario.
- Entrega auditoria para investigacao e compliance, com logs administrativos, trilha de sessao e contexto de quem acessou, quando e qual host foi usado.
- Acelera a operacao tecnica com hosts organizados, favoritos, recentes, SFTP, acessos locais, snippets, alternador rapido e comandos diretos via gateway.
- Permite colaboracao e diagnostico controlados, com sessao ao vivo, pedido de controle, playbooks de baixo risco, resumo por IA e rastreabilidade.

## Versao para abertura comercial
O NodeAccess e uma plataforma de acesso operacional seguro para ambientes Linux/SSH. Ele centraliza o acesso aos servidores em uma interface web e tambem permite conexao por cliente SSH nativo via gateway auditavel, mantendo controle, MFA, permissao, credenciais protegidas e rastreabilidade.

## Dor que resolve
- Acessos SSH dependem de configuracao local, conhecimento informal e ferramentas diferentes por usuario.
- Credenciais, chaves e bastions ficam espalhados, dificultando governanca, revisao de acesso e offboarding.
- Auditoria costuma ser limitada ou inexistente, tornando investigacao e compliance mais dificeis.
- Suporte e troubleshooting entre times exigem compartilhamento inseguro de tela, senha ou comandos.
- Novos usuarios demoram para encontrar hosts, entender padroes e realizar a primeira conexao com seguranca.

## Diferenciais comerciais
- Combina terminal web, SSH Gateway nativo e governanca em uma unica camada de acesso.
- Mantem credenciais do host dentro do NodeAccess; o usuario final nao precisa receber senha ou PEM do servidor.
- Aplica MFA, permissao, bastion e controle de host key antes da abertura da conexao.
- Oferece experiencia operacional proxima de ferramentas desktop, mas com controle centralizado.
- Ajuda liderancas a enxergar uso, risco e rastreabilidade sem travar a rotina tecnica.
- Cria base para governanca mais forte, automacao controlada e suporte a compliance sem trocar a base do produto.

## Recursos e melhorias recentes
- Sessao ao vivo evoluida com pedido de controle, concessao temporaria, retomada pelo owner e auditoria multiusuario.
- Acessos locais mais claros, com porta ativa/fallback, criacao a partir do host e melhor separacao entre configurado e ativo.
- Links JIT de acesso temporario, com uso unico, expiracao, PIN opcional, revogacao e logs administrativos.
- Bastions com visibilidade de uso, bastion efetivo por host/grupo e reaproveitamento de PEM cadastrada.
- Vault de secrets e snippets seguros com referencia `{{secret:alias}}`, auditoria mascarada e mascaramento defensivo.
- Dashboards pessoal e administrativo de adocao, feedback do usuario e licenciamento/entitlements por tenant.
- Playbooks de diagnostico com execucao controlada, detalhe por comando e resumo por IA.
- MCP inicial para integracoes com assistentes de IA usando contexto e tools governadas.
- Busca por abas no terminal para localizar sessoes abertas por nome, IP ou porta.

## Prova rapida de valor
1. Login com MFA.
2. Busca de host com favoritos ou recentes.
3. Conexao pelo terminal web com alternador rapido de hosts.
4. Localizacao de sessao aberta pela busca de abas.
5. SFTP ou acesso local criado a partir do host.
6. Link JIT temporario com expiracao curta.
7. Sessao compartilhada com pedido de controle.
8. Playbook de diagnostico com resumo por IA.
9. Consulta de logs/auditoria e dashboard admin.
10. Conexao por cliente SSH nativo via gateway.

## Frase de posicionamento
NodeAccess centraliza, protege e audita o acesso SSH da empresa sem tirar velocidade dos times tecnicos.
