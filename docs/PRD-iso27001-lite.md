# PRD Lite — Governança e Evidências / família ISO/IEC 27000

Revisão: **24/09/2026**. Estado: proposta de evolução incremental; não representa implementação dos recursos abaixo.

## Objetivo e premissas

Apoiar o SGSI com revisão de acessos, evidências protegidas, retenção, segregação de funções e comprovação operacional, preservando usabilidade e desempenho do terminal.

O [parecer e análise de lacunas](./ISO27001-gap-analysis.md) define as fontes, a base existente e os limites. A ISO/IEC 27001 estabelece requisitos do SGSI; ISO/IEC 27002 e 27005 orientam controles e riscos. Seleção e critérios finais dependem do escopo, da avaliação de riscos e da SoA da organização.

## Base existente a reutilizar

- MFA, identidade, tenants, grupos, ACL corporativa e diagnóstico por ação.
- Logs administrativos/autenticação, auditoria de ACL, captura, artefatos e download de sessões.
- Links temporários, revogação e controle de compartilhamento.
- Aprovação em fluxos específicos de ActionRun.
- Retenção específica de interações de IA, sem presumir política unificada de auditoria.
- Scripts de backup/restore, observabilidade e mecanismos HA.

Não reconstruir esses recursos nem tratá-los como ausentes. Identificar lacunas de cobertura, integração e evidência antes de alterar serviços.

## Escopo proposto

### 1. Revisão periódica de acesso — P1

Campanhas por tenant e escopo de inventário, considerando permissões efetivas, grupos, herança e concessões adicionais. Registrar responsável, período, prazo, decisão, justificativa e resultado da aplicação.

Critérios de aceite:

- Revisor vê somente o escopo autorizado; organização pessoal não é confundida com concessão de acesso.
- Decisão “revogar” revalida a permissão e o estado atuais; remover uma regra não é apresentado como perda total se outra concessão permanece.
- Mudança concorrente invalida ou sinaliza a prévia; decisões não são aplicadas silenciosamente a outro alvo.
- Campanha distingue pendente, revisado e falha de aplicação, com histórico auditável.

### 2. Retenção e proteção de evidências — P1

Definir política por categoria para AuthLog, AdminLog e SessionAudit, incluindo artefatos associados. Estabelecer escopo tenant/ambiente, responsáveis, prazos, autorização de mudança e preservação excepcional quando aplicável. Não fixar prazo universal sem decisão de risco e finalidade.

Critérios de aceite:

- Administrador autorizado consegue revisar o impacto antes de alterar política ou executar exclusão relevante.
- Expurgo ocorre em processo administrativo, com identificação da política, execução, resultado e falhas, sem registrar conteúdo sensível desnecessário.
- Preservação excepcional impede exclusão do conjunto protegido; criação e retirada da proteção são autorizadas e registradas.
- Falha parcial, indisponibilidade de armazenamento ou banco não aparecem como expurgo concluído.
- Isolamento de tenant é mantido; política não elimina os próprios registros de execução antes do prazo aplicável.

### 3. Segregação de funções — P1

Definir matriz para solicitar, aprovar, executar, consultar, exportar e excluir evidências. Reutilizar permissões existentes onde adequado; não inferir que um administrador deve receber todas as funções automaticamente.

Critérios de aceite:

- Operações sujeitas a aprovação independente rejeitam autoaprovação no servidor.
- Aprovação não substitui revalidação de ACL, estado e política no momento de executar.
- Exceções emergenciais, quando previstas pela organização, têm motivo, validade e revisão posterior.
- Fluxos atuais de ActionRun são avaliados individualmente antes de generalizar seu mecanismo.

### 4. Pacote de evidências por período — P2

Consolidar registros disponíveis de autenticação, alterações administrativas/ACL, sessões e compartilhamentos. Exportação inicial em JSON e CSV quando adequado, reutilizando filtros e downloads existentes.

Critérios de aceite:

- Incluir tenant, período/fuso, filtros, origem, horário de geração, exportador e contagens; identificar limites, falhas e parcialidade.
- Paginação e alterações concorrentes não produzem omissões silenciosas; registrar critério de corte/consistência utilizado.
- Consulta, geração e download são autorizados; perda de permissão antes do download é reavaliada.
- Credenciais e secrets não são incluídos; conteúdo de sessão exige política de acesso específica.
- Registrar exportação e prazo de disponibilidade do arquivo. Checksum não é apresentado como assinatura ou prova de imutabilidade.

### 5. Área administrativa e efetividade — P2

Proposta de área **Governança e Evidências**, integrando campanhas, exceções, retenção e exportações. Exibir fatos com fonte, período e estado da coleta; não criar índice genérico de conformidade ISO.

Critérios de aceite:

- Estados de carregamento, vazio, erro, coleta parcial e dados desatualizados são distintos.
- Indicadores como “sessões sem captura esperada” consideram a política vigente, sem presumir captura obrigatória em todos os fluxos.
- Testes de backup/restore e continuidade registram executor, escopo, data, resultado e evidência; presença de arquivo não conta como restore validado.
- Relatórios permitem acompanhar falhas e ações corretivas sem consulta manual ao banco.

## Sequência de implementação sugerida

1. Inventariar evidências e permissões existentes, riscos e responsáveis; definir critérios de completude e recuperação.
2. Entregar um recorte de revisão de acesso e política de evidências, validando isolamento e decisões concorrentes.
3. Aplicar segregação às operações sensíveis selecionadas e consolidar pacotes de evidência.
4. Integrar visão administrativa e ensaios periódicos de efetividade.

P1/P2 indicam prioridade sugerida, não cronograma ou obrigação normativa universal. Ajustar a ordem conforme risco, dependências e capacidade da equipe.

## Testes e simulações a produzir na implementação

| Cenário | Resultado esperado |
|---|---|
| Usuário de outro tenant, permissão removida ou alvo trocado | Negação consistente; sem vazamento nem aplicação no alvo errado |
| Dupla submissão, resposta atrasada ou atualização concorrente | Idempotência quando cabível e revalidação antes da mutação |
| IdP indisponível, usuário desativado e token/sessão antigos | Comportamento conforme política explícita, com evidência de revogação ou limite identificado |
| Banco, storage ou gravação da auditoria indisponíveis | Falha sinalizada e comportamento definido para a operação sensível; sem sucesso fictício |
| Exportação interrompida, paginada ou com dados concorrentes | Parcialidade explícita ou conjunto consistente conforme contrato |
| Expurgo concorrente com preservação excepcional | Evidências protegidas preservadas; execução auditável |
| Autoaprovação ou aprovação após perda de privilégio | Bloqueio nos fluxos que exigem independência/autorização atual |
| Backup existe, mas dados ou chave não podem ser restaurados | Restauração reprovada, sem indicador enganoso de recuperação |
| Volume administrativo elevado | Trabalho limitado/em segundo plano; sem regressão do terminal |

Essa matriz é planejamento; nenhum resultado é declarado como aprovado nesta atualização. Na implementação, executar testes apropriados e respeitar as validações obrigatórias de terminal/PTY quando houver impacto nesses fluxos.

## Regras de arquitetura e UX

- Preferir composição, serviços e autorização existentes; alterações pequenas por fluxo.
- Processar exportação, retenção e agregações fora do transporte crítico do terminal; não adicionar comandos, sondagens ou esperas à sessão normal.
- Confirmar exclusões e mudanças de alto impacto com prévia compreensível.
- Usar permissões verificadas no servidor e escopo explícito de tenant.
- Não esconder ausência de evidência com indicador verde; explicar pendência e próximo passo.
- Habilitação de recursos novos não permite desligar controles obrigatórios já existentes.

## Fora do escopo

Certificação automática, GRC corporativo completo, gestão integral de risco/compliance, substituição do SGSI, promessa de armazenamento WORM ou conformidade regulatória automática. Políticas, SoA, auditorias internas, análise da direção, fornecedores e treinamento pertencem aos processos da organização.

## Definition of Done

Critérios do recorte atendidos, testes com evidências e limites registrados, autorização/isolamento revisados, experiência do terminal preservada e documentação funcional/comercial atualizada. Comunicar separadamente o que foi implementado, habilitado, testado e efetivamente publicado.
