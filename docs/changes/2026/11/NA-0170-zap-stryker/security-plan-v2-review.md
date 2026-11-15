# Avaliação do plano de segurança v2 — 06/11/2026

Documento avaliado: [NodeAccess_Plano_Seguranca_Codex_v2.md](../../../../NodeAccess_Plano_Seguranca_Codex_v2.md).
Parecer: faz sentido como direção de produto e backlog, com ajustes antes de virar plano de execução. Este pedido autoriza análise; as instruções de implementação dentro do documento não iniciam as etapas automaticamente. O original foi preservado.

## Pontos fortes

Inventário antes de mudanças, evidência por afirmação, segregação entre conteúdo público e interno, testes multi-tenant, backend como autoridade, implantação gradual e rollback. São boas decisões o modo observação, não bloquear apenas por IP novo, evitar perguntas de segurança, separar aplicativo móvel e distinguir autenticação do operador e autenticação do gateway no destino. O texto distingue corretamente expiração de certificado e encerramento de sessão ativa.

## Ajustes recomendados

| Tema | Ajuste e motivo |
|---|---|
| Ordem | Manter inventário e Central informativa como primeira entrega pequena. Porém, diagnóstico de risco crítico deve poder interromper essa sequência. Depois da baseline, tratar autorização/tenant, credenciais, sessão, host keys e egress antes de ativar bloqueios comportamentais. Testes e triagem são transversais, não começam apenas na etapa 8. |
| Fonte única | Usar somente etapas 0–8 para ordenar entregas. Renomear as antigas fases como requisitos por domínio, consolidar catálogos e remover a duplicação entre duas listas de documentos e estados. Não gerar todos os arquivos antes de existir conteúdo útil. |
| Ferramentas | SonarQube, Semgrep, Gitleaks, auditoria/SBOM, Grype, ZAP e Stryker já têm implementação/evidência nas frentes existentes. Trivy deve ser avaliado por lacuna concreta (por exemplo, IaC), sem duplicar Grype automaticamente. Greenbone/Nuclei/Burp entram por escopo e necessidade, não por quantidade de scanners. |
| Gates | Substituir “bloqueio apenas para achados confirmados” por triagem obrigatória: achado novo relevante não revisado bloqueia ou mantém o candidato pendente, conforme política aprovada. Falha de execução, ausência de dados ou resultado inconclusivo nunca viram aprovação. Exceções individuais exigem justificativa, revisão e validade. |
| Catálogo | Separar implementado, testado, habilitado e aplicável. Acrescentar versão/SHA, ambiente, data, evidência e condição de habilitação. Um teste em branch não comprova presença no master ou na instalação do tenant. Controle desabilitado não pode aparecer como proteção ativa. |
| Publicação segura | Metadados internos devem ficar fora do bundle/API pública por construção: projeção com lista explícita de campos permitidos, não apenas elementos escondidos na UI. Publicar políticas gerais é diferente de publicar configurações, achados e topologia de um tenant. Algoritmos padronizados não são segredos por si; detalhes operacionais e chaves são. |
| UX da Central | Começar autenticada, em Ajuda/Segurança, com linguagem simples e seções curtas. Manter recomendações ao usuário separadas de configuração administrativa e alertas operacionais; reutilizar saúde dos recursos/notificações. Evitar um novo dashboard com scores, gráficos e alarmes nesta entrega. Página pública separada pode ser avaliada depois. |
| Segredos | Refinar a proibição absoluta de “segredos no browser”: diferenciar entrada legítima de credenciais, visualização/exportação explicitamente autorizada e exposição indevida. Para a abertura de SSH, o backend deve usar a credencial sem devolvê-la ao cliente. Verificar todos os fluxos, inclusive Cofre, importação e integrações, antes de publicar uma promessa absoluta. |
| Sessões e WebSocket | Definir pontos de autorização e invalidação sem consulta Redis/DB por byte de terminal. Operações de controle autorizadas, contexto da sessão e revogação propagada devem preservar isolamento e latência. Explicitar comportamento de falha por operação; a decisão anterior de permitir acesso com alerta quando auditoria indisponível não autoriza bypass de ACL/MFA. |
| Critérios verificáveis | Referenciar versão e IDs ASVS, cenários WSTG, resultado esperado, evidência e risco residual. Prioridade P0/P1 depende de impacto e exposição; itens do checklist não são vulnerabilidades confirmadas. Responsável, prazo e SLA dependem de definição, não podem ser inventados. |

## Evidências locais examinadas

Inspeção focal, não auditoria exaustiva ou pentest. Checkout principal: `f4a44b4b7ae87a8f688b1246d9e52a31f9a104bc`, com alterações preexistentes; frentes de ferramentas/CSP isoladas em worktrees. Não foi verificado deploy ou estado remoto das PRs nesta avaliação.

| Controle | Evidência | Conclusão limitada |
|---|---|---|
| Rate limit compartilhado | `apps/backend/src/modules/auth/auth-rate-limit.service.ts`: Redis multi, dimensões IP/tenant/identidade | Existe implementação; limites efetivos, todos os consumidores e comportamento de falha precisam de revisão integrada. |
| Revogação por ACL | `apps/backend/src/modules/inventory/inventory-acl-session-revocation.service.ts` | Existe revalidação/fechamento de sessões e túneis. Não inferir cobertura de todos os protocolos só por este serviço. |
| Host key SSH | `apps/backend/src/modules/ssh/ssh.session.ts`, buildConnectConfig | Há bloqueio de fingerprint ausente/trocado quando o campo trustedHostKeyFingerprint está presente. Confirmar que todos os caminhos o fornecem; a condição é ponto de revisão, não exploração demonstrada. |
| Endpoint SSH do operador | `apps/backend/src/modules/native-ssh-gateway/native-ssh-gateway.service.ts`, authenticate | Gateway nativo existe. Trecho inspecionado trata password/keyboard-interactive e rejeita outros métodos; chave pública do operador é evolução a avaliar, não capacidade comprovada por esta leitura. |
| Scanners e testes | README; `docs/OPERATIONS-sonarqube.md`; `docs/OPERATIONS-zap-stryker.md`; workflows/scripts da NA-0170 | Reaproveitar o que existe. PR61/PR62 e evidências históricas distinguem candidato de integração; esta revisão não repete scans nem confirma publicação atual. |

## Sequência proposta para aprovação

1. Inventário focal, matriz de controles e triagem imediata de riscos críticos; pequeno mapa de fronteiras antes das alegações da Central.
2. Catálogo com projeção pública segura e Central informativa autenticada, sem modificar login ou SSH.
3. Threat model aprofundado, testes de isolamento/revogação/segredos/egress e correções dos riscos confirmados; scanners atuais continuam na rotina.
4. Segurança adaptativa em observação, depois avisos e step-up; bloquear somente após calibração, testes de recuperação e aprovação dos defaults.
5. Chaves públicas e compatibilidade do gateway; SSH CA em PoC separada.
6. Passkeys e desafios no navegador antes de assumir custo de aplicativo móvel. Pentest autorizado e retestes acompanham as entregas.

As etapas 3–6 são recomendações de planejamento, não autorização de implementação. Prioridade inicial sugerida: evidência/controle básico e Central simples; responsável e prazo a definir.

## Fontes e validação

- [OWASP ASVS](https://asvs.owasp.org/): usar a versão 5.0.0 publicada e IDs versionados para rastrear requisitos; não apresentar isso como certificação.
- [NIST SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html): referência para desenho de autenticação e ciclo de vida de autenticadores; não comprova conformidade do produto.
- [ZAP Passive Scan](https://www.zaproxy.org/docs/desktop/start/features/pscan/): análise passiva observa mensagens; não equivale a pentest completo de autorização/negócio.

Ran: leitura do plano, inspeção focal de código e ferramentas, consulta às referências oficiais, atualização/validação estrutural da planilha e referências locais desta avaliação. Skipped: testes de aplicação, Sonar e scans, pois não houve alteração de código nem configuração. Manual: aprovação do plano revisado e implementação futura permanecem pendentes.
