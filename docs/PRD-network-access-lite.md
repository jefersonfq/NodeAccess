# Equipamentos de rede e TACACS+ — piloto

Estado: implementação de piloto, opt-in. Não constitui homologação de Cisco, Juniper ou outros fabricantes, nem certificação de capacidade para produção.

## Contrato de produto

- Host sem `device_profile` permanece **Servidor SSH**, independentemente do padrão atual do tenant.
- O padrão do tenant só é consultado ao criar host SSH sem perfil explícito. Alterações comuns não reclassificam hosts antigos. Protocolos gráficos permanecem com seu comportamento anterior.
- Perfis: servidor SSH, rede genérico, Cisco IOS/IOS XE e Junos (piloto). Perfil descreve capacidades; não concede autorização.
- Perfis de rede não oferecem SFTP nem inicialização/automação feita para shells de servidor. API SFTP, warm-up e operações SFTP por WebSocket também recusam esses perfis. Playbooks de servidor, ações SSH de IA e sessões MCP de automação recusam o perfil antes da execução. O terminal interativo continua disponível, sem comandos de descoberta ou alteração automática de paginação.
- Classificação consulta/configuração é indicativa. Um `show` com pipes/redirecionamento não é automaticamente classificado como consulta. A classificação nunca concede permissão.
- Na integração existente, o equipamento consulta seu AAA; NodeAccess é cliente SSH. É necessário utilizar a identidade AAA individual no equipamento, não uma credencial administrativa compartilhada.

## Serviço próprio opcional

Processo independente `tacacs-main`, sem importação ou inicialização de listener no API/gateway. Ativação global explícita e ativação individual por tenant. A configuração fica em **Configurações → Equipamentos de rede e TACACS+**.

Implementação de um subconjunto AAA da RFC 8907 com transporte exclusivo TLS 1.3/mTLS da RFC 9887: login PAP e ASCII, autorização shell com comandos exatos e accounting start/stop/update. Sem CHAP, MSCHAP, enable, multiplexação single-connect, AV-pairs específicos Junos ou certificação de conformidade completa. Opções não suportadas são negadas. Perfis de fabricantes não significam suporte a todos os seus modelos AAA.

Identidades AAA têm credencial própria, hash bcrypt custo 12, vínculo com usuário NodeAccess e ACL efetiva de conexão. Usuário/tenant inativos, usuário removido/bloqueado ou ACL revogada são negados no pedido seguinte. Não reutiliza automaticamente a senha web nem substitui MFA.

Equipamentos são vinculados a host do mesmo tenant pelo IP de origem e fingerprint SHA-256 exclusivo do certificado TLS validado. O SAN IP deve corresponder à origem; cadeia, validade, finalidade e revogação também são verificadas. Origem e certificado são exclusivos neste piloto; redes sobrepostas precisam de origem distinta. Pin alterado ou removido vale para o próximo pedido, inclusive durante autenticação ASCII. Não há segredo compartilhado, MD5 nem fallback não TLS. Certificados/CRLs do daemon são renovados com reinício controlado.

Autorização de comandos usa vetores completos de tokens: sem regex, curingas, expansão ou correspondência por prefixo. `show version` não permite `show version extra`, `sh version`, pipes ou alteração. Não há grant implícito para administradores. Autorizar abertura de shell exige ACL de conexão; executar comandos exige a lista explícita. Lista vazia nega comandos. O equipamento DEVE consultar a autorização para todos os níveis de comando; o serviço não intercepta a sessão SSH do equipamento.

## Auditoria e falhas

Configurações, credenciais, equipamentos, grants e remoções são auditados na mesma transação da mudança; falha de auditoria desfaz a alteração. Senhas, hashes de senha e segredos não aparecem nas respostas da interface. A auditoria administrativa de grants usa contagem e digest da política. Pedidos AAA registram tenant, equipamento, usuário, operação e resultado; argumentos com indicação de credencial são omitidos dos eventos.

Accounting só recebe sucesso após persistência. Falha de dependência retorna erro quando existe pedido válido decodificado; pacote inválido, origem/certificado desconhecido ou TLS inválido encerra a conexão. Não existe fallback permissivo no NodeAccess. Configurar fallback local no equipamento é uma decisão separada do administrador; pode permitir acesso mesmo com o AAA indisponível.

Limites por processo: 64 conexões, 8 por origem, 32 operações pendentes, corpo 8 KiB, 64 argumentos por pedido, timeout de operação/pacote inicial de 5 s, espera de resposta interativa ASCII de 30 s, vida de socket de 90 s e 60 inícios de autenticação por origem/minuto. Operações pendentes não liberam capacidade antes de realmente concluírem. A fila não cresce indefinidamente quando uma dependência trava. Rate limit é local ao processo, sem promessa de limitação distribuída.

## Compatibilidade e rollout

1. Aplicar as migrações aditivas `20260911120000_network_access` e `20261104230000_tacacs_tls_identity`; registros anteriores sem certificado ficam sem acesso. Ela não reclassifica hosts nem ativa TACACS+.
2. Atualizar API, gateways e frontend antes de cadastrar perfis de rede. Instâncias antigas continuam acessando servidores existentes, mas não conhecem os novos recursos; não usar uma implantação mista para validar capacidades de rede.
3. Manter novos recursos desativados durante o rollout. Validar um servidor antigo e um equipamento de laboratório antes de habilitar o tenant.
4. Configurar autenticação, autorização por comando e accounting no equipamento. Validar negação de comandos e indisponibilidade AAA **no próprio equipamento**, inclusive eventual fallback local.
5. Para interromper o piloto, desabilitar a política e parar o processo opcional. Não remover a migração nem apagar registros de auditoria.

O enforcement de comando acontece no equipamento/AAA e não depende de filtrar caracteres no terminal. Gateways antigos não devem ser considerados capazes de adaptar SFTP/automações aos perfis novos.

## Operação e validação

Consulte [guia operacional](./guides/network-access-tacacs.md). Testes unitários/TCP, laboratório MySQL com cliente Python independente, simulação de UX e certificação PTY são opt-in e não inserem sondagens no caminho normal de acesso.

Referências: [RFC 8907](https://www.rfc-editor.org/rfc/rfc8907.html) e [RFC 9887](https://www.rfc-editor.org/rfc/rfc9887.html). A integração informa de forma persistente que TACACS+ legado não é suportado por segurança. Porta padrão TCP300, mTLS obrigatório, sem 0-RTT. O suporte de transporte não constitui homologação de firmware nem certificação completa do protocolo.

## Diagnóstico operacional do piloto

Implementado monitoramento separado por heartbeat no Redis e interface administrativa com atividade exclusiva do tenant. Ausência de observação ou falha de monitoramento não confirma saúde nem altera acesso. O daemon possui prontidão local e watchdog de operações permanentemente pendentes, com reinício delegado ao supervisor. O laboratório inclui CLI simulada sobre SSH real, failover de listeners e carga com falhas/timeouts. Consulte o [relatório operacional](./reviews/2026-09-11-tacacs-operations.md) para evidências e limites; não equivale à homologação de firmware ou HA de produção.
