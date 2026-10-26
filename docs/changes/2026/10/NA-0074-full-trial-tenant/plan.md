---
change_id: NA-0074
title: Tenant de teste completo com limites e provisionamento acompanhado
type: feature
status: ready-for-tests
created_at: 2026-10-25T22:34:04-03:00
base_branch: master
base_sha: 3dcb1bb60a36a5d5359fd8d35f5a3e94284c80d1
branch: feature/NA-0074-20261025-full-trial-tenant
owner: root
planner: root
risk: high
issue: null
---

# NA-0074 — Tenant de teste completo

## Contexto e situação anterior
O tenant já é isolado, mas o proprietário USER, licença parcial, allowlist HTTP e guardas de transporte/UI restringem a experiência. Usuário confirmou cadastro e conexão ao host base.

## Problema e objetivo
Oferecer os recursos normais do tenant dentro de limites configuráveis, sem acesso administrativo à plataforma. Provisionar um host inicial automaticamente e comunicar estados reais da preparação.

## Escopo
Incluído: perfil completo opt-in compatível com snapshots antigos, licença tenant completa, administração tenant, cotas atômicas, validade e proteção de destinos em todos os transportes; UI normal com prazo discreto e alerta final24h; provisionamento acompanhado; atualização idempotente apenas da conta autorizada e perfil para novos testes; manual, testes, pacote e implantação com backup.
Excluído: privilégios globais, acesso a segredos de outros tenants, uso ilimitado de serviços pagos, restauração de banco antigo sobre novas gravações. Integrações continuam exigindo configuração própria e disponibilidade do provedor.

## Critérios de aceitação
- [ ] Perfil full permite todas as funcionalidades tenant autorizadas pela licença; snapshots legados continuam restritos até conversão explícita.
- [ ] Proprietário administra apenas seu tenant; recursos e credenciais de outros tenants permanecem inacessíveis.
- [ ] Cotas de usuários/hosts/sessões e vigência não podem ser ampliadas pelo administrador do teste nem ultrapassadas por concorrência/importação/reativação.
- [ ] Todo teste novo recebe um host demo automaticamente; demais hosts usam cadastro normal dentro da quota, sem formulário extra obrigatório.
- [ ] Tela de espera apresenta estado real e atualização automática, inclusive retry/falha; nunca percentuais fictícios.
- [ ] SSH/SFTP/RDP/VNC/agentes/túneis/MCP/ações e compartilhamentos preservam checagens de destino, identidade, limites e encerramento na expiração quando utilizados no teste.
- [ ] Menus normais disponíveis; detalhes de teste discretos, aviso destacado no último dia; acessibilidade/mobile/terminal preservados.
- [ ] Conta de teste indicada recebe perfil full sem reset de senha/MFA, perda de hosts/dados ou alteração de validade não solicitada; contas normais intactas.
- [ ] Retenção cobre os novos domínios graváveis; revisão independente e evidências vinculadas ao SHA antes da publicação.

## Estratégia técnica
Centralizar diferenciação full/legado no perfil e políticas, mantendo autorização tenant original. Reutilizar fluxos normais, adicionar apenas guardas de cotas/destinos necessários. Auditar callbacks e credenciais externas antes de liberar rotas. Atualização de snapshot existente explícita, transacional e auditada, sem efeito global retroativo.

## Riscos e mitigações
| Risco | Impacto | Mitigação | Critério de parada |
|---|---|---|---|
| Rotas antes inacessíveis | Fuga de tenant/SSRF | Revisão de autorização e destinos por superfície | Qualquer bypass sem teste |
| Mais domínios graváveis | Credenciais após expiração | Revogação e retenção completas | Segredo retido fora da política |
| Concorrência | Quotas ultrapassadas | Locks comuns e testes SQL reais | Corrida reproduzida |
| Update com cliente ativo | Perda de estado | Backup novo, drenagem, preservação comprovada | Backup/evidência ausentes |

## Matriz de testes e evidências
| Critério/risco | Validação | Ambiente | Evidência | Obrigatório |
|---|---|---|---|---|
| Perfil/política/isolamento | unitários + API + SQL concorrente | local descartável | /tmp/na0074-* | sim |
| Transportes/expiração | real SSH PTY e recursos afetados | hosts descartáveis | relatórios por transporte | sim |
| UI/provisionamento | navegador desktop/mobile + terminal-experience | local | capturas/report | sim |
| Retenção | SQL sem dados reais | local | relatório | sim |
| Compatibilidade | tipos/lint/build/manual/CI | local+CI | SHA/checks | sim |
| Publicação | backup/checksums/normal coexistence/target read-only | remoto | evidência sanitizada | sim |

## Baseline
Base SHA3dcb1bb6. Trials291 testes passaram,59 opt-in não executados no baseline; frontend102 passaram. Suites opt-in relevantes serão executadas em ambiente descartável. Antes: proprietário USER e licença limitada, painéis trial destacados.

## Rollback ou recuperação
Backup atualizado de banco, imagens, configurações e arquivos antes da publicação. Preservar tenant/hosts existentes e credenciais. Reverter código/configuração apenas após verificar compatibilidade; nunca restaurar backup antigo após reabertura e novas gravações. Script de promoção guarda snapshot privado e valida estado antes de mutação.

## Mudanças de escopo e decisões
Usuário autorizou implementação fim a fim e ajuste da conta já cadastrada. Complemento: um host inicial automático, demais cadastrados pelo usuário, status real durante espera. Não registrar identificador pessoal no repositório.

## Aprovação
Escopo explicitamente aprovado pelo usuário nesta interação. Decisão: GO_WITH_RISKS, após revisão independente do plano, sujeita à revisão independente das superfícies antes de liberar recursos. Baseline concluído; nenhum bypass amplo autorizado.


### Decisões necessárias da implementação
- Full habilita MCP/IA/auditoria por tenant, com exclusões explícitas e licença; flags e filas normais preservadas, sem habilitação global do servidor.
- Quotas de hosts usam lock antes de leitura consistente em MySQL, na mesma conexão; regressão concorrente e pool1 verificados.
- Provedores externos usam credenciais próprias, HTTPS/TLS e transporte limitado; IA tem orçamento vitalício de requisições, não de tokens.
- Testes reais locais cobrem SSH/SFTP/MFA/PTY/SQL. Serviços externos foram simulados; Windows/NLA continua sem host de teste disponível conforme usuário. Homologação humana full e comprovação remota permanecem etapas separadas.
