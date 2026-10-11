# Família ISO/IEC 27000 — parecer de governança e compliance do NodeAccess

Revisão: **24/09/2026**. Avaliação documental e técnica preliminar, baseada no código e na documentação do workspace. Inclui alterações locais não necessariamente publicadas. Não é auditoria formal, certificação ou comprovação de conformidade da instalação em produção.

O nome deste arquivo foi preservado para manter os links existentes. Ele passa a contextualizar a família ISO/IEC 27000, com foco na ISO/IEC 27001 e nos controles apoiados pelo produto.

## Parecer executivo

O NodeAccess possui uma base técnica relevante para governança de acesso: identidade, MFA, ACL, credenciais protegidas, colaboração controlada e rastreabilidade. A evolução prioritária é transformar esses controles em evidências contínuas, protegidas e revisadas, com responsáveis e processos definidos.

A presença de um controle no código não demonstra sua configuração correta, cobertura ou efetividade ao longo do tempo. Não há fundamento nesta revisão para atribuir percentual de conformidade, declarar certificação ou garantir atendimento integral à norma.

## Referencial normativo

| Referência | Papel | Aplicação à avaliação |
|---|---|---|
| ISO/IEC 27000 | Visão geral e conceitos do SGSI | Vocabulário e contexto da família de normas |
| ISO/IEC 27001:2022, com emenda de 2024 | Requisitos do Sistema de Gestão de Segurança da Informação | Escopo, responsabilidades, riscos, controles, avaliação e melhoria |
| ISO/IEC 27002:2022 | Orientações para controles de segurança | Referência para acesso, registros, criptografia e operação |
| ISO/IEC 27005:2022 | Orientações para gestão de riscos de segurança | Avaliação e tratamento de riscos de acesso, credenciais, integrações e indisponibilidade |

Referências oficiais consultadas na revisão: [ISO/IEC 27000](https://www.iso.org/standard/27000), [ISO/IEC 27001](https://www.iso.org/standard/27001), [ISO/IEC 27002](https://www.iso.org/standard/75652.html) e [ISO/IEC 27005](https://www.iso.org/standard/80585.html).

O mapeamento abaixo é temático. A avaliação normativa controle por controle exige o texto aplicável, escopo do SGSI, riscos e Declaração de Aplicabilidade — SoA. As funcionalidades sugeridas não são, isoladamente, exigências universais da ISO.

## Escopos e responsabilidades

Distinguir três objetos de avaliação:

- **Produto NodeAccess:** capacidades e limitações do software.
- **Organização que desenvolve/opera o NodeAccess:** desenvolvimento seguro, acessos internos, fornecedores, mudanças, incidentes e operação do serviço dentro do seu SGSI.
- **Organização cliente:** riscos, configuração, usuários, concessões, destinos, retenção e processos de uso da plataforma dentro do SGSI do cliente.

A certificação de um SGSI tem escopo definido; utilizar a plataforma ou uma integração não transfere certificação entre essas organizações.

## Controles existentes e evidências necessárias

“Base existente” indica implementação identificada, não teste de efetividade em produção.

| Área | Base existente | Evidência ou lacuna a tratar |
|---|---|---|
| Identidade | Login local, MFA/TOTP, Google, LDAP/AD, OIDC e SCIM conforme configuração | Demonstrar provisionamento, desligamento, revogação e comportamento com IdP indisponível; não presumir compatibilidade universal |
| Autorização | Tenants, grupos, ACL corporativa herdada e permissões por ação | Campanhas formais de revisão, responsáveis, decisões e tratamento de exceções; consulta de ACL não equivale a recertificação |
| Credenciais | Cofre, referências de secrets e AES-256-GCM para material sensível | Gestão/rotação das chaves, recuperação e privilégios de administração; não implica cifragem integral de banco ou backups |
| Rastreabilidade | Logs de autenticação/administração, auditoria de ACL, sessões, participantes e comandos derivados | Verificar cobertura, completude, sincronização temporal e proteção contra alteração/exclusão |
| Evidências | Download de auditoria, artefatos, replay textual e relatórios específicos | Consolidar pacote por período, registrar exportação e permissões; reconstrução de comandos pode ser incompleta |
| Retenção | Configuração e mecanismo de expiração específicos para interações de IA | Não foi confirmada política unificada para AuthLog, AdminLog e SessionAudit com expurgo rastreável e preservação excepcional |
| Acesso temporário | Links com expiração/revogação e controle em sessões compartilhadas | Justificativa, aprovação quando exigida, revisão posterior e teste após expiração |
| Aprovações | Aprovação em fluxos específicos de ActionRun | Não comprova dupla aprovação geral nem impedimento de autoaprovação em todos os fluxos |
| Operação | Observabilidade, scripts de backup/restore e mecanismos HA | Restauração comprovada, RTO/RPO medidos, tratamento de falhas e acompanhamento periódico |
| IA e integrações | Tokens/escopos, políticas e provedores configuráveis | Classificação dos dados enviados, acesso aos provedores, retenção externa e revisão humana |

Fontes: [datasheet](./DATASHEET-NodeAccess.md), [matriz de revisão do produto](./reviews/2026-09-24-datasheet-review.md), [rotas de logs](../apps/backend/src/modules/logs/log.routes.ts), [auditoria e downloads](../apps/backend/src/modules/session-audit/session-audit.routes.ts), [retenção de interações de IA](../apps/backend/src/modules/local-ai/ai-interaction.repository.ts) e [aprovações de ActionRun](../apps/backend/src/modules/ai-ssh-actions/ai-ssh-action.routes.ts).

## Prioridades de evolução

| Prioridade | Entrega proposta | Resultado verificável |
|---|---|---|
| P1 | Revisão periódica de acessos | Responsável, prazo, decisão manter/revogar, justificativa e histórico por escopo |
| P1 | Política de retenção e proteção de evidências | Categorias e prazos definidos, autorização de exclusão, preservação excepcional e execução rastreável |
| P1 | Segregação de funções | Matriz de quem solicita, aprova, executa, consulta e elimina; regras de autoaprovação explícitas |
| P2 | Pacote de evidências por período | Exportação autorizada com tenant, período, origem, horário e exportador; resultado completo/parcial distinguido |
| P2 | Ensaios de efetividade | Falhas e recuperação testadas com responsável, data, resultado e correção das não conformidades |

A ordem é uma recomendação de produto e deve ser ajustada ao risco. A implementação pode ser incremental, começando pelo inventário das evidências e permissões já existentes. Nenhuma prioridade representa recurso novo entregue por esta atualização documental.

## Área proposta: Governança e Evidências

Área administrativa para reunir revisões de acesso, exceções, acessos temporários, retenção e exportações. Reutilizar os serviços e as autorizações existentes, sem criar um GRC completo ou substituir a gestão corporativa de riscos.

Indicadores devem apresentar fatos, escopo, período e origem, por exemplo:

- Acessos sem revisão dentro do prazo definido.
- Exceções vencidas ou sem responsável.
- Sessões sem captura esperada pela política vigente.
- Falhas de exportação ou lacunas de coleta.
- Último teste de restauração com evidência e resultado.

Ausência de dados não deve aparecer como controle atendido. Não criar percentual genérico de “conformidade ISO” a partir de funcionalidades habilitadas.

## Evidências e proteção

Definir quem pode consultar, exportar, alterar e excluir registros, inclusive administradores de plataforma e operadores do banco/armazenamento. Avaliar proteção externa ou armazenamento com restrição de alteração conforme risco; WORM não é declarado como recurso existente nem imposto como solução única.

Checksum de um relatório permite conferir integridade em relação a um valor conhecido; sozinho não comprova autoria, assinatura digital ou ausência de adulteração anterior. Logs, artefatos e replay podem conter dados sensíveis produzidos pelo destino. Retenção e exportação precisam respeitar classificação, finalidade e acesso autorizado.

O indicador de backup por presença/idade de arquivo não comprova integridade ou restauração. Um processo de expiração de IA não prova retenção completa de auditoria. Políticas de comando não substituem a autorização do sistema remoto.

## Validação operacional recomendada

1. Desativar usuário com sessão ativa; observar tokens, novas conexões e sessões existentes em cada fluxo contratado.
2. Revogar ACL e agente; verificar negação, impacto nas sessões e registro da decisão.
3. Expirar/revogar compartilhamento; confirmar que reconexão ou evento atrasado não restaura acesso.
4. Indisponibilizar IdP e dependências de auditoria; verificar comportamento definido, sinalização e ausência de concessão silenciosa.
5. Exportar evidências com paginação, concorrência e interrupção; demonstrar completude ou parcialidade explícita.
6. Simular retenção, preservação excepcional e falha do expurgo; conferir isolamento de tenant e registro da execução.
7. Restaurar banco, artefatos e chaves em ambiente isolado; medir RTO/RPO e verificar leitura das evidências recuperadas.

São ensaios propostos, não testes executados nesta revisão. Cada ensaio deve produzir escopo, configuração, executor, data, evidência, resultado e ação corretiva. Preservar a experiência do terminal; processamento administrativo deve ser desacoplado do fluxo crítico.

## O que depende da organização

Política de segurança, inventário/classificação de ativos, gestão de riscos, SoA, donos dos controles, onboarding/offboarding, gestão de incidentes e fornecedores, treinamento, auditorias internas, análise pela direção e continuidade precisam existir no SGSI.

O produto pode apoiar esses processos com dados e mecanismos. Configuração, operação, avaliação de efetividade e tratamento de desvios continuam necessários.

## Posicionamento técnico-comercial

Formulação sustentada por esta revisão:

> O NodeAccess oferece controles de acesso, gestão de credenciais e rastreabilidade que apoiam a implementação de controles de segurança em um SGSI baseado na ISO/IEC 27001.

Não declarar “certificado ISO”, “100% conforme”, “garante compliance” ou capacidade de certificação automática sem evidência correspondente e escopo definido.

Evoluções e critérios de aceite: [PRD de Governança e Evidências](./PRD-iso27001-lite.md). Esta atualização altera somente documentação e não confirma implantação, testes de produto ou auditoria formal.
