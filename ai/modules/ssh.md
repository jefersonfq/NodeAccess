Responsabilidade:
Gerenciar conexão SSH via backend

Fluxo:
Browser → WSS → Node → SSH → Host

Lib: ssh2

Regras:
- suporta password e PEM
- pode usar bastion
- credenciais podem vir do 1Password
- sessão não persiste secret
- reconexao deve ser controlada pelo usuario

Pontos críticos:
- timeout
- reconexão manual
- múltiplas sessões simultâneas
- queda de websocket x queda de SSH
