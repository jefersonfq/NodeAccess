# Revisão preliminar de segurança dos agentes

Data: 2026-09-10. Método: leitura estática direcionada do código atual. Não foram executados scans, testes de exploração, auditoria de binários distribuídos ou alterações funcionais. Prioridades abaixo são de investigação/correção, não pontuação CVSS.

## Controles observados

- `apps/agent/src/index.js`: TLS validado por padrão e CA privada opcional; `--insecure` explícito; heartbeat e reconexão controlados.
- `apps/agent/src/agent-runtime.js`: suporte a arquivo de token; instalações de serviço documentadas usam arquivo protegido.
- `apps/backend/src/modules/agents/agent.service.ts`: hash SHA-256 de token, autenticação e operações com tenant/owner; revogação persiste estado e chama desconexão no registry local.
- `apps/backend/src/modules/agents/agent.registry.ts`: seleção de conector privado por tenant e política de destino/porta.
- `apps/agent/installer/windows/AgentUpdates.ps1`: HTTPS, bloqueio de redirects, validação de metadados, tamanho e checksum. Build Windows oferece assinatura opcional.

Presença desses controles não prova cobertura de todas as rotas ou versões distribuídas.

## Achados e próximos testes

| Prioridade | Evidência estática | Impacto e ação proposta |
| --- | --- | --- |
| P0 | `agent.registry.ts`: callback de mensagem chama `handleControl`/`handleBinary` sem identidade do remetente; handlers consultam mapas globais por `connectionId`, sem comparar `BridgeEntry.agentId`. | Falta de vínculo entre frame e agente proprietário. Se agente autenticado obtiver ID de outra conexão, o caminho permite atuar no stream/callback alheio. Reproduzir em teste isolado com dois agentes/tenants; exigir identidade do agente e instância WS em controles, dados e pendências. Não foi demonstrado vazamento ou exploração real. |
| P1 | `isPrivateAccessAllowed`: listas vazias de CIDR e hostname retornam true; `isPrivateAccessPortAllowed`: portas vazias aceitam qualquer porta. | Semântica permissiva confirmada nos helpers; alcance efetivo depende do restante da seleção/ACL. Tornar escopo privado vazio deny-by-default e exceção ampla explícita; avaliar migração de configurações existentes. |
| P1 | `apps/agent/src/index.js`, handler `connect`: recebe host/porta e chama `sock.connect`, sem aplicar uma política local de destinos. | Servidor é a autoridade exclusiva no trecho revisado. Adicionar limite local administrável pelo cliente e validar DNS/IP final, IPv4/IPv6, loopback, link-local e metadata; políticas locais não podem ser ampliadas silenciosamente pelo servidor. |
| P1 | `apps/agent/package.json`: scripts/targets de empacotamento ainda apontam para Node.js 18. | Runtime upstream EOL. Migrar empacotamento para runtime suportado e verificar versão real dos artefatos publicados; configuração não prova quais binários estão nos clientes. |
| P1 | `build-msi.ps1`: assinatura é opcional quando certificado não configurado; `AgentUpdates.ps1` valida hash do pacote, sem verificação explícita de editor nos trechos de atualização lidos. | Hash fornecido junto ao download não autentica editor diante de comprometimento do distribuidor. Exigir artefato/manifesto assinado, trust anchor independente e política de anti-downgrade para releases comerciais; validar Windows/Linux/macOS separadamente. |
| P1 | `agent.gateway.ts`/cliente usam token no fluxo de query da conexão WS. | Auditar exposição em logs de proxy/APM e migrar para header ou ticket curto quando compatível. Não foi constatado vazamento em logs. |
| P1 a validar | `agent.service.ts` revoga pelo registry local. | Testar revogação, rotação e desativação em múltiplas réplicas/gateways; a leitura não demonstrou propagação distribuída. Distinguir manutenção/drenagem de revogação de segurança. |

## Endurecimento adicional a verificar

- Identidade por instalação, registro de uso único/curto e renovação; avaliar mTLS ou credenciais vinculadas a chave do dispositivo com recuperação operacional.
- Privilégio mínimo do serviço e proteção de arquivos; separar executor de scans do relay, sem elevar privilégios do agente de acesso.
- Limites de frames, conexões, filas e buffers; mensagens inválidas não derrubam gateway. Validar backpressure e proteção contra exaustão.
- Política para modo insecure e versões abaixo do mínimo; metadado `tlsMode` autorrelatado não é atestação do dispositivo.
- Supply chain: SBOM, dependências, builds rastreáveis, assinatura e política de atualização emergencial.
- Simular servidor comprometido, token furtado e agente comprometido em laboratório; comprovar limites locais, isolamento, revogação e ausência de segredos em logs.

## Ordem e aceite

Primeiro reproduzir e corrigir ownership de frames; depois escopos e destinos, runtime/distribuição e revogação distribuída. Cada correção exige teste de regressão específico, preservando conexões autorizadas. Alterações em transporte SSH/resize exigem também `npm run test:terminal-pty:real` em host descartável conforme AGENTS.md; mudanças na área útil exigem `npm run test:terminal-experience:web`.

Não anunciar conformidade Zero Trust pela presença de túnel outbound: recursos e comunicações precisam de autenticação/autorização explícitas. [NIST SP 800-207](https://www.nist.gov/publications/zero-trust-architecture).

Node.js 18 consta como EOL na [tabela oficial de releases](https://nodejs.org/en/about/previous-releases). Integrar o plano de validação ao `../PRD-security-assessment-lite.md` e à evolução de `../PRD-zero-trust-connectors-lite.md`.

## Atualização após as últimas implementações

Ver [revisão complementar](2026-09-10-agent-security-followup.md): ownership de frames corrigido e testado; novo problema de revogação com registro duplicado reproduzido em memória. A classificação inicial acima é histórica e não deve ser interpretada como lista integral de pendências atuais.
