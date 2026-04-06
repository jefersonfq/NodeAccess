Responsabilidade:
Autenticacao, autorizacao e seguranca de sessao.

Inclui:
- login local
- JWT + refresh token
- TOTP obrigatorio
- politicas de senha
- bloqueio por tentativas
- eventos de autenticacao

Pontos de atencao:
- nunca expor segredo, token ou hash
- validar regra no backend antes do frontend
- diferenciar authn (identidade) de authz (permissao)
- manter mensagens de erro seguras e objetivas
