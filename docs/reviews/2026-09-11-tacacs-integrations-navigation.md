# TACACS+ em Integrações e navegação de Hosts

O painel existente passou de Configurações do tenant para Integrações, com carregamento sob demanda ao expandir. Endereços antigos com `section=network-access` redirecionam para Integrações. O armazenamento, ACLs e auditoria continuam por tenant; nenhuma alteração de backend ou migration.

O aviso de Transition ocorria porque HostsView passou a ter três raízes após a inclusão de menu/modal de tags. Esses overlays agora estão dentro do contêiner existente, preservando dimensões e a estrutura do layout global/KeepAlive.

Validação:
- `npm run typecheck -w apps/frontend`: aprovado.
- `FRONTEND_BASE=http://127.0.0.1:5189 node tools/frontend/hosts-feedback-ux-playwright.cjs`: sete cenários aprovados com APIs e WebSocket de eventos simulados.
- Inclui edição de tags por teclado, erro de duplicidade, persistência de filtros, recuperação de falhas, navegação SPA repetida, ausência de aviso de raiz não animável, carregamento sob demanda de TACACS+, link antigo e recuperação de erro em viewport 390x844 sem overflow horizontal.
- Relatório: `/tmp/nodeaccess-hosts-feedback-ux.json`; captura: `/tmp/nodeaccess-tacacs-integrations-mobile.png`.
- A primeira execução identificou resposta simulada incompleta de features (`integrationProviders` ausente); corrigido o contrato da fixture e repetida a suíte com sucesso.

Não houve conexão a equipamentos ou alteração em políticas reais. Esta validação cobre a reorganização da interface, não uma nova homologação do protocolo TACACS+.

## Padronização visual

O card TACACS+ agora usa o mesmo `CollapsibleSection`, divisores e grade de casos práticos das outras integrações. Possui ícone, descrição e indicação de piloto, com seções Configuração e Casos práticos que resolve. O aviso/atalho de política de autenticação foi removido de Integrações; o editor permanece em Configurações do tenant.

O harness também verifica as duas seções, expansão por teclado, casos práticos sem consultas AAA e ausência do aviso removido. Typecheck aprovado. As APIs continuam simuladas, incluindo a configuração OIDC para evitar notificações causadas por fixtures incompletas.
