# PRD Lite — Postura de segurança dos hosts

Data: 2026-09-10. Status: proposta, não implementada por esta tarefa.

## Objetivo

Exibir evidências de exposição e configuração, prioridades de remediação e evolução por host/cliente. Reutilizar inventário, ACL, diagnósticos, Jira e MCP. Este módulo avalia ativos do cliente; `PRD-security-assessment-lite.md` avalia a segurança do próprio NodeAccess.

## MVP e evolução

1. Importar resultados estruturados de ferramentas do cliente, validar formato/tamanho e mapear para hosts autorizados; mostrar origem, data e cobertura.
2. Coleta autenticada opcional de configuração/pacotes por playbooks revisados, com privilégio mínimo e evidências sanitizadas.
3. Adapter Nmap em runner dedicado para portas/serviços com perfis limitados, janela, limites de concorrência, timeout, cancelamento e consentimento de escopo persistido.
4. Avaliar integrações de vulnerabilidades/hardening (por exemplo scanner corporativo já contratado), sem instalar uma coleção de ferramentas em todos os agentes.

Nmap informa exposição e indícios de serviços; banner ou versão inferida não confirma CVE, especialmente diante de backports. Porta fechada ou scan incompleto não prova segurança. Não usar exploração, brute force ou scripts NSE arbitrários no MVP.

## Execução e confiança

- Runner separado de API/gateway e do processo de túnel; agente de acesso não ganha shell genérico ou privilégios administrativos por consequência.
- Tenant habilita capacidade de avaliação; permissão de conectar não implica permissão de varrer rede. Revalidar usuário, tenant, host, perfil, runner e destinos ao iniciar o job.
- Alvos do inventário autorizado; CIDRs somente mediante escopo separado. Resolução DNS e IP final devem obedecer à política no ponto executor, incluindo IPv6, endereços locais e metadata. Não permitir expansão de alvo por argumento livre.
- Invocar ferramentas com argumentos estruturados e perfis versionados, sem interpolação em shell. Limitar CPU, memória, rede, duração e tamanho de saída; parser deve tratar resultado como entrada não confiável.
- Sem scans no caminho normal de login/conexão SSH. Falha no módulo não prejudica acesso; fila/worker e resultados persistidos.
- Registrar origem de rede do runner: resultado observado de uma rede privada não demonstra exposição na internet.

## Classificação explicável

Achado contém host, origem, instante, evidência, versão da ferramenta/regra, severidade técnica, confiança, cobertura, recomendação e estado (aberto, confirmado, falso positivo, aceito até prazo, resolvido por nova validação).

Prioridade combina criticidade do ativo, exposição efetivamente observada, evidência técnica e exploração conhecida quando houver CVE validada. Usar regras determinísticas versionadas inicialmente; IA explica e sugere, não inventa CVEs nem altera evidência ou prioridade silenciosamente. Resultado desconhecido/desatualizado aparece explicitamente, nunca como risco baixo. Manter exceções justificadas e revalidação.

## MCP proposto

- Leitura: `security.list_findings`, `security.get_host_posture`, `security.get_evidence`, com ACL e sanitização também nas respostas.
- Ação: `security.plan_assessment`, `security.start_assessment`, `security.get_run`, `security.cancel_run`; nomes propostos, não tools existentes.
- Capabilities distintas para consultar e executar; plano identifica host, perfil, origem e impacto. Backend exige autorização aplicável, mesmo se IA declarar que houve aprovação.
- Idempotência, limite de execução por tenant/token, expiração, auditoria de iniciador e cancelamento. Saídas de scanners são dados não confiáveis, não instruções para o agente de IA.
- Remediação é ActionRun separado, com revisão e validação posterior; não corrigir automaticamente apenas com base em classificação.

## UX e aceite

No host, resumo de postura e CTA “Avaliar segurança” quando autorizado; detalhes mostram por que um achado tem prioridade e como validar/corrigir. Estados: não avaliado, agendado, executando, parcial, erro, cancelado, atualizado, desatualizado e sem permissão. Cor acompanhada de texto.

Aceite: teste de isolamento entre tenants; usuário de leitura não inicia scan via UI/API/MCP; destino fora do escopo bloqueado no executor; cancelamento encerra processo; evidência importada malformada rejeitada; ausência de cobertura não vira baixo risco; scan não afeta latência do terminal além do orçamento explicitamente validado em laboratório.

## Dependências e fontes

Antes de distribuir Nmap/Npcap com produto comercial, avaliar os termos aplicáveis e OEM; uso instalado pelo cliente não deve ser assumido como dispensa automática das condições de integração. [Termos oficiais Nmap](https://nmap.org/book/man-legal.html).

Escopo de varredura deve ser autorizado pelo responsável pela rede, com janela adequada. [Orientação Nmap](https://nmap.org/book/legal-issues.html).

Exploração conhecida pode informar priorização, quando a identificação da vulnerabilidade for sustentada. [CISA KEV](https://www.cisa.gov/known-exploited-vulnerabilities-catalog).
