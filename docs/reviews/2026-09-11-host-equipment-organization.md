# Formulário de host: tipo de equipamento

Perfil do equipamento e sistema operacional movidos dos campos principais para Acesso e organização, no grupo Tipo de equipamento. O cabeçalho mostra o perfil efetivo (incluindo padrão do tenant) e o sistema informado mesmo recolhido. Protocolos não SSH não exibem perfil SSH no resumo. A grade principal passa a acomodar protocolo, endereço e porta.

Nenhuma mudança no payload, ACL, persistência ou regra de capacidades. A descrição do perfil esclarece disponibilidade de SFTP e automações. Label do novo grupo traduzido para português e inglês; sistema operacional possui nome acessível explícito.

Validação em Chromium com APIs simuladas: oito cenários aprovados no harness `tools/frontend/hosts-feedback-ux-playwright.cjs`. O novo cenário verifica campos dentro da seção, visibilidade ao recolher, padrão Servidor SSH, escolha de Ubuntu, resumo atualizado e preservação das capacidades de automação ao alternar perfil. Executado também em viewport mobile 390x844.
