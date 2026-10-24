# Escopo inicial — Android e macOS

Status: proposta para discussão. Não representa funcionalidades já implementadas.

## Objetivo

Oferecer acesso ao NodeAccess com uma experiência adequada a cada plataforma.

## Direção proposta

Começar como clientes da instalação NodeAccess existente, reaproveitando API, permissões, auditoria e gateway. Essa direção depende da confirmação do usuário. SSH direto é uma alternativa de escopo: exige decidir autenticação, credenciais, auditoria e operação sem servidor antes de implementar.

## Primeira versão candidata

1. Informar e validar o endereço da instalação.
2. Autenticar e selecionar o tenant conforme as permissões existentes.
3. Consultar hosts, buscar e acessar favoritos/recentes.
4. Abrir e usar uma sessão de terminal.
5. Tratar falhas de conexão, retomada, encerramento e expiração de sessão.

Macros, IA, SFTP, administração e protocolos gráficos devem ser priorizados após a prova do fluxo principal; sua disponibilidade não está prometida nesta primeira versão.

## Decisões pendentes

- Cliente do servidor existente ou também SSH direto.
- Quanto da interface web pode ser reaproveitado sem prejudicar a experiência.
- Tecnologia: decidir após prova técnica em Android e macOS.
- Distribuição e atualização; requisitos de instalação e versões mínimas.
- Recursos prioritários e disponibilidade de dispositivos para validação.

## Validação da prova técnica

- Autenticação e isolamento entre usuários/tenants, quando conectados ao servidor.
- Terminal com saída contínua, caracteres especiais, teclado, foco e resize.
- Rede interrompida, respostas atrasadas, suspensão/retorno e expiração da sessão.
- Ausência de envio duplicado ao recuperar conexão.
- Segredos fora de logs, notificações e relatórios.
- Validação em dispositivo Android e macOS reais antes de considerar a experiência homologada.

## Limites desta abertura

Apenas diretórios e documentação. Sem SDKs, dependências, mudança de API, alteração do terminal web, credenciais, publicação ou aplicativo funcional.
