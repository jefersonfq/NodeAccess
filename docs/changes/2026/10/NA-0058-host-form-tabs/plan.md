---
change_id: NA-0058
title: Cadastro e edição de hosts por abas contextuais
type: feature
status: ready-for-tests
created_at: 2026-10-22T11:14:19-03:00
base_branch: master
base_sha: 1755022aa2e8d884ddf295e3e2470acfdcb5ad24
branch: feature/NA-0058-20261022-host-form-tabs
owner: jefersonfq
planner: codex
risk: medium
---

# NA-0058 — Formulário de hosts por abas

## Contexto e situação anterior
Revisão no navegador identificou 3043px de conteúdo para 700px úteis na edição expandida, cabeçalhos recolhíveis fora da navegação por Tab, campos sem labels associados e agrupamento de ACL, organização e macros. Evidências anteriores em NodeAccess-current/imgs_debug/hosts-ux-review.

## Problema e objetivo
Abrir Conexão por padrão e permitir navegação previsível por quatro abas, preservando campos, regras de acesso, APIs e protocolos existentes.

## Escopo
- Conexão, Acesso, Organização e Recursos; contexto compacto, ações fixas, responsividade e labels.
- Reorganizar campos existentes, sem criar capacidades de protocolo/backend; manter valores ao trocar abas/protocolo.
- Validação local com seleção da aba/foco do campo; testes, simulações e manual.
- Fora: transporte/terminal, autenticação, permissões backend, dependências novas, WIP MCP/MSI e publicação.

## Critérios de aceitação
- [x] Cadastro/edição abrem Conexão; navegação por teclado e mouse preserva dados.
- [x] Campos/recursos condicionais respeitam SSH, Telnet, RDP e VNC; teste TCP não promete sessão gráfica.
- [x] ACL permanece explícita; obrigatórios e erros selecionam aba/campo; salvar/testar/loading/erro/sucesso funcionam.
- [x] 1440/768/390px, temas claro/escuro, abas legíveis, sem overflow horizontal do modal e ações acessíveis.
- [x] Secrets, PEM, bastion, links e macros preservam payloads e regras.
- [x] Manual, capturas e manifesto revalidados; lint/typecheck/build e regressões aplicáveis passam.
- [x] Validação independente registra achados e limitações.

## Estratégia técnica
Manter estado e operações existentes em HostsView.vue; extrair shell de abas acessível e sem regras de negócio. Reagrupar template sem reescrever APIs. Usar v-show para preservar valores internos. Internacionalizar textos novos PT/EN. Harness de navegador com APIs simuladas, sem mutações reais.

## Riscos e mitigações
Campos ocultos/credenciais perdidas: testes de alternância e payloads. Erros fora da aba: foco e associação label/input. Mudança de inventário/ACL: preservar normalização e permissões. Não alterar área útil do terminal; manual:capture executa sua regressão própria.

## Matriz de testes e evidências
| Critério | Validação | Obrigatório |
|---|---|---|
| Abas/estado/protocolos/validação | Harness Playwright dedicado | sim |
| Credenciais/bastion/macros | Harnesses existentes e payloads | sim |
| Responsividade/teclado/temas | Capturas e asserts navegador | sim |
| Compilação | lint, typecheck, build | sim |
| Manual | capture, test:manual, check-reviewed | sim |

## Baseline
Base origin/master conferida após fetch. Worktree separado para preservar alterações não relacionadas. Revisão anterior e baseline de Secret; resultados em implementation.md.

## Rollback ou recuperação
Reverter somente esta frente; nenhuma migração ou configuração backend. Worktree original permanece intacto. Usuário autorizou integração em 2026-10-22 após avaliar o preview. Publicar via PR, aguardar checks obrigatórios, mergear e sincronizar preservando o WIP não relacionado.

## Mudanças de escopo e decisões
Plano deriva da proposta aprovada na conversa; correções de acessibilidade e seleção de erro necessárias à troca de navegação. Protótipos/referências não equivalem a homologação humana.

## Aprovação
- Decisão: GO_WITH_RISKS (formulário extenso, exige regressão de payloads).
- Aprovado por: usuário, pedido explícito de implementar fim a fim em nova branch.
- Aprovado em: 2026-10-22, conversa atual.

## Situação da entrega local
Critérios automatizados e revisão estática atendidos no conteúdo LOCAL_WIP; capturas inspecionadas e manual revalidado. Usuário homologou o preview e autorizou merge; solicitou polimento adicional de alinhamento e transição. Commit candidato, checks de CI e sincronização serão registrados no PR para evitar SHA recursivo no documento. Evidências locais em imgs_debug/host-form-tabs e registro detalhado em implementation.md.

## Polimento autorizado e integração
Alinhar pelo topo os pares usuário SSH/autenticação e modo de conexão/bastion. Entrada das abas com CSS de 140ms, respeitando prefers-reduced-motion, sem remontagem dos campos ou dependências. Harness verifica alinhamento ≤1px, foco e movimento reduzido; integração no workflow Manual pilot mantém essa cobertura no CI. Revisão independente incremental: PASS. O pedido explícito de merge autoriza commit, push da topic, PR e merge após os gates; não autoriza deploy/release de produção.

## Correção necessária dos gates de integração
CI detectou advisories novos em ferramentas dev existentes, sem achados runtime: patch Vitest/coverage e família 4.1.11→4.1.12 e markdown-it transitivo do TypeDoc 14.3.2→14.3.3. Nenhuma dependência nova ou atualização major. Gitleaks exigiu renovar hashes integrais de três arquivos editados; fixtures comparadas byte a byte com a base e inalteradas. Scanner/regras preservados. Correções necessárias para o merge já autorizado, registradas e verificadas sem relaxar gates.
