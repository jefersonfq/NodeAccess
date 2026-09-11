# Avaliação competitiva e evolução do NodeAccess

Data: 2026-09-10. Status: avaliação e propostas; não representa funcionalidades entregues nem cronograma aprovado.

## Conclusão competitiva

O NodeAccess tem oportunidade de vantagem em produtividade operacional para infraestrutura, suporte e MSPs. Não há benchmark que comprove superioridade geral de segurança, desempenho, usabilidade ou custo frente ao JumpServer.

Posicionamento recomendado: do chamado ao acesso autorizado, diagnóstico, correção verificada e evidência em um único fluxo.

Base local: `PROJECT-functional-context-nodeaccess.md`, `PROJECT-value-summary.md` e `PRD-lite.md`. Há diferenças de atualização entre documentos: foram encontrados módulos OIDC, SCIM e ACL no código e registros de evolução de playback. Não tratar esses recursos como ausentes apenas porque um resumo os apresenta como futuros. Existência de código não equivale a certificação em produção.

| Frente | Avaliação |
| --- | --- |
| SSH, RDP/VNC, MFA, auditoria | Base da categoria; não sustentam diferenciação isoladamente. |
| Terminal, autocomplete, snippets, SFTP | Candidatos a vantagem em produtividade, sujeitos a comparação prática. |
| Jira, sessão, diagnóstico e evidência | Principal hipótese de diferenciação integrada. |
| Agentes, redes privadas e colaboração | Valor depende de instalação simples, governança e confiabilidade. |
| Credenciais e diversidade de ativos | JumpServer anuncia rotação, descoberta, bancos e Kubernetes; comparar cobertura real por edição. |
| IA | Não é exclusiva: JumpServer também documenta automação com agentes de IA. |
| Preço | Community gratuita do concorrente impede presumir vantagem de licença; comparar custo total. |

## Prioridades anteriores preservadas

1. Confiabilidade de agentes e integrações 1Password/Jira/identidade e onboarding.
2. Completar aprovação temporária por ticket: aprovador distinto, conta/host, prazo, expiração, revogação e emergência auditada. Link JIT não equivale ao fluxo completo.
3. Avaliar ciclo de vida de credenciais nos destinos: rotação, verificação e recuperação. Rotação da chave de criptografia da aplicação é outro controle.
4. Consolidar evidências: playback, retenção, proteção contra adulteração, auditoria de consulta/exportação e SIEM. Checksum isolado não prova imutabilidade.
5. Runbooks com revisão, execução, verificação e evidência no Jira; reversão somente quando tecnicamente aplicável.
6. Operação multi-cliente e, havendo demanda, acesso nativo a bancos/Kubernetes com políticas próprias.

Para comprador de segurança corporativa, antecipar credenciais e auditoria. Para suporte/MSP, destacar atendimento integrado. Validar lacunas antes de implementar conceitos que já existem.

## Avaliação das três propostas do usuário

| Proposta | Decisão recomendada | Dependência/limite |
| --- | --- | --- |
| Postura de segurança por host e MCP | Aprovar como direção de produto modular | Runner separado, escopo explícito e resultados verificáveis; não prometer scanner universal. |
| Segurança dos agentes | Primeira prioridade técnica | Corrigir/validar fronteiras de confiança antes de ampliar capacidades de rede. |
| Topologia interativa por cliente/projeto | Aprovar MVP com inventário e desenho manual | Não inferir rede física ou dependências a partir de IPs/cadastros. |

Detalhes em `PRD-host-security-posture-lite.md`, `reviews/2026-09-10-agent-security-preliminary.md` e `PRD-client-topology-lite.md`.

Sequência: endurecimento dos agentes; topologia inicial sem descoberta ativa; postura de segurança via importação/coleta limitada; scans ativos governados; correlação entre risco, topologia, runbooks e Jira. A topologia inicial pode avançar independentemente da execução de scans.

## Prova de valor

Comparar ambos os produtos no mesmo ambiente e com os mesmos perfis: instalação até primeiro acesso, incidente até evidência no ticket, acesso temporário, revogação e recuperação de auditoria. Medir tempo, erros, intervenções administrativas, latência p95 e custo operacional. Registrar versões, edições, hardware, usuários simultâneos e configuração de auditoria; 300 usuários é alvo, não capacidade comprovada.

Para os novos módulos: medir tempo para documentar um cliente, tempo para identificar caminho de acesso e proporção de achados confirmados/corrigidos. Não usar quantidade de nós ou scans como prova de valor isolada.

## Fontes públicas consultadas

- [JumpServer: funcionalidades](https://www.jumpserver.com/features): identidade, autorização, credenciais e auditoria.
- [JumpServer: edições](https://www.jumpserver.com/pricing): Community gratuita; Enterprise anuncia JIT, rotação, SSO e recursos organizacionais. Validar contrato e versão antes de proposta comercial.
- [JumpServer: operação com IA](https://www.jumpserver.com/blog/ai-driven-it-operations-codex-jumpserver-skills): automação assistida também faz parte da oferta divulgada.

São informações do fornecedor, não resultados de validação independente.
