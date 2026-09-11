# Rede e TACACS+ — implementação e validação de piloto

## Entrega

- Perfil explícito de equipamento no cadastro, com Servidor SSH como compatibilidade para registros antigos. Padrão por tenant somente para novos hosts.
- Perfis de rede adaptam SFTP e automações no formulário, terminal e backend. Autocomplete de caminhos de servidor também é desativado. A ACL de conexão continua sendo a fonte de autorização para acesso.
- Serviço TACACS+ opcional em processo separado, com identidade AAA vinculada a usuário, equipamento/origem vinculados a tenant/host, autorização de comandos exatos e accounting.
- Interface administrativa com busca de usuários/hosts, credenciais e segredos não retornados, confirmação de ativação e troca de permissões, estados vazios/erro/retry e auditoria legível.
- Alterações administrativas e auditoria na mesma transação. Revogações efetivas no próximo pedido AAA; falha de dependência não concede acesso.
- Migração aditiva aplicada no banco local. TACACS+ não foi ativado para tenants existentes, e nenhuma implantação de produção foi publicada.

## Correções encontradas nos testes

1. O schema de PATCH reaproveitava defaults de criação. Fastify/AJV injetava campos omitidos, inclusive usuário SSH vazio. A edição agora preserva os campos ausentes. Há três regressões pela rota HTTP real, além das validações de serviço.
2. O gateway emitia `connected` antes de instalar o receptor de entrada. Comandos e controles enviados imediatamente podiam desaparecer. O receptor agora é registrado antes do anúncio de prontidão, sem atrasar a conexão com rotinas auxiliares.
3. O botão SFTP condicionado dentro de um tooltip deixava o componente sem elemento de referência durante carregamento. A condição foi movida para o tooltip inteiro; os testes de terminal foram repetidos.
4. Os rótulos de campos precisam alcançar o input, não somente o contêiner visual. Inputs e seletores receberam identificação acessível; botões longos agora quebram linha em telas pequenas.
5. Falhas do módulo de rede são tratadas localmente, para não recarregar o aplicativo e perder campos em edição.

## Evidências

Resultados consolidados: [JSON de validação](./2026-09-11-network-access-validation.json).

| Verificação | Resultado |
|---|---|
| Suíte focada (`npm run test:network-access`) | 101 testes, 7 arquivos, aprovados |
| Typecheck shared/backend/frontend | Aprovado; backend repetido após correção de prontidão |
| Build backend e frontend | Aprovados; frontend mantém aviso de chunk vendor grande |
| Compose do serviço opcional | Configuração validada sem publicação |
| Prisma e migração | Schema validado e cliente regenerado; comparação somente de leitura sem divergências nas novas tabelas de rede ou em `device_profile` |
| MySQL + API + cliente Python `tacacs_plus==2.6` | PAP/ASCII, senha errada, comando negado, isolamento, revogação, accounting e rollback da auditoria aprovados |
| Executável TACACS+ compilado e independente | Os mesmos cenários TCP passaram em processo separado |
| UX em navegador | Retry, vazio, validação, confirmação/cancelamento, edição de grants, auditoria, teclado, mobile e seleção de perfis aprovados |
| Terminal com perfil de rede | SFTP oculto, nenhuma descoberta de caminhos e entrada funcional |
| API/gateway com SSH real descartável | Perfil persistido, SFTP recusado nas duas interfaces, macro recusada, sem warm-up e sessão preservada |
| `test:terminal-experience:web` | Aprovado |
| `test:terminal-pty:real` | `top` e `htop` aprovados, sem findings |

As medições `authorizationMs` são chamadas ao serviço de autorização com banco e persistência da auditoria, não latência de um roteador nem benchmark de produção. O cliente Python exerce o protocolo de forma independente; o host SSH real era um Linux descartável com perfil de rede. Não foi testado um roteador/switch físico executando AAA.

## Limites e ativação

É uma entrega de piloto, não homologação de produção do servidor AAA. Ainda não inclui TLS TACACS+, AV-pairs Junos, automações CLI específicas por fabricante, políticas reutilizáveis por grupo/conjunto ou teste de carga de produção. Perfis de fabricantes não equivalem à certificação de seus firmwares.

Atualizar API, gateways e frontend antes de usar os novos perfis; manter o serviço desligado durante o rollout. O equipamento deve consultar autorização para os comandos relevantes e ter comportamento de falha/fallback validado. O NodeAccess não consegue garantir a política de um equipamento configurado para ignorar o AAA.

Instruções: [guia operacional](../guides/network-access-tacacs.md). Contrato: [PRD do piloto](../PRD-network-access-lite.md).

O laboratório foi encerrado: tenants temporários removidos, host SSH de teste ocultado por soft delete com auditoria preservada, container descartável removido e processos de teste encerrados. Instâncias principais não foram reiniciadas.
