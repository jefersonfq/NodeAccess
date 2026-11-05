---
change_id: NA-0169
title: TACACS+ exclusivo TLS 1.3 com identidade mútua e aviso de compatibilidade
type: security
status: ready-for-tests
created_at: 2026-11-04T20:29:34-03:00
base_branch: chore/NA-0093-20261103-sonar-delivery
base_sha: df8482674781c24a92f3f24d551c4e392297c9f1
branch: security/NA-0169-20261104-tacacs-tls
owner: NodeAccess
planner: Codex
risk: high
issue: null
---

# NA-0169 — TACACS+ exclusivo TLS

## Contexto e situação anterior
Piloto TACACS+ usa TCP e obfuscação MD5; usuário informou não ter clientes e substituiu decisão de manter legado por TLS exclusivo. PR59 da base permanece sem homologação/merge. Worktree separado preserva alterações alheias no projeto principal.

## Problema e objetivo
Remover transporte legado e MD5, implementar variante RFC9887 e informar claramente na integração que equipamentos sem TLS1.3/mTLS não são suportados por segurança. Confirmar scanner sem ocultar risco ou excluir fonte.

## Escopo
Inclui daemon/protocolo, identidade por certificado de equipamento, API/persistência/migração, configuração Compose, UI, guia, simuladores e testes reais locais. Preservar ACL/tenant/AAA/auditoria/limites/watchdog. Não inclui deploy VPS, homologação de firmware, emissão pública de certificados, fallback legado, alterações de SSH/websocket/terminal ou merge sem homologação.

## Critérios de aceitação
- [x] TLS1.3/mTLS obrigatório; plaintext/TLS1.2/cliente sem certificado/desconhecido/expirado/revogado negados.
- [x] Remover MD5; flag RFC9887 obrigatório e erro tipado antes do fechamento quando ausente.
- [x] Identidade do certificado e origem vinculadas ao equipamento/tenant; revogação/rotação invalida próximos pedidos.
- [x] Startup recusa material TLS/CRL ausente/inválido; limites incluem conexões antes do handshake.
- [x] UI informa ausência de legado e motivo, remove segredo compartilhado e orienta cadastro do certificado; estados desktop/mobile/erro/sem dados validados.
- [x] AAA positivo/negativo, framing/concorrência/timeout/watchdog/auditoria e isolamento regressados com TLS real.
- [x] Migração não habilita registros antigos implicitamente; documentação/planilha/evidência mantidas em docs canônico.
- [ ] Revisão independente, testes aplicáveis, Sonar e CI no SHA final; notaA só declarada se medida.

## Estratégia técnica
TLS direto na porta padrão300 com key/cert/CA/CRL por arquivos privados configurados. Certificado cliente deve ter SAN IP correspondente à origem e fingerprintSHA256 cadastrado; fingerprint não é segredo nem substitui validação CA/revogação. Origem exclusiva permanece limite do piloto. Backend consulta identidade em cada pedido; sem seleção de tenant pelo cliente. Migração aditiva torna segredo legado inerte e registra fingerprint, exigindo novo cadastro. Rotação por atualização de pin e reinício controlado para novo materialTLS/CRL; não prometer recarga automática. TLS sem0RTT; resumption não pode ignorar autenticação/revogação. Ajustar ferramentas de laboratório para TLS e clientePython independente.

## Riscos e mitigações
| Risco | Impacto | Mitigação | Stop criterion |
|---|---|---|---|
| Downgrade/identidade indevida | Acesso não autorizado | TLS/mTLS sem fallback, CA+CRL+SAN+pin, tenant/ACL por pedido | Qualquer aceite indevido |
| Regressão AAA/limites | Indisponibilidade ou acesso indevido | Regressões reais, falha fechada, watchdog preservado | Teste negativo ou auditoria falhar |
| Migração/PKI | Equipamentos não conectam | Registros antigos sempin negados, guia explícito, laboratório descartável | Dados/auditoria perdidos |

## Matriz de testes e evidências
| Critério/risco | Teste/harness | Ambiente | Evidência | Required |
|---|---|---|---|---|
| Transporte/identidade | TLS real e certificados descartáveis positivos/negativos | localhost | relatórios de testes | yes |
| AAA e isolamento | suites de serviço/protocolo/resiliência + MySQL/Python | laboratório isolado | relatórios | yes |
| Interface | Chromium desktop/mobile/teclado/erros | fixtures de API, UI real | prints e relatório | yes |
| Regressão/qualidade | lint/typecheck/build/Sonar/CI | candidato final | SHA e artifacts | yes |

## Baseline
Base df8482674781c24a92f3f24d551c4e392297c9f1: full validation eCI previamente PASS, SecurityD por únicoMD5OPEN. Baseline focal da API (27 testes) e captura prévia da UI foram realizados antes das respectivas alterações. Nenhuma aprovação anterior é transferida ao novoSHA.

## Rollback ou recuperação
Desativar daemon/política e restaurar artefato compatível com schema sem apagar registros. Não reativar listener legado como fallback; rollback operacional preferido é serviço desligado. Sem migração em produção. Certificados de laboratório descartáveis; chaves não entram noGit.

## Mudanças de escopo e decisões
IN_PLAN: pedido explícito de implementação fim a fim e aviso na integração. Semclienteslegados permite quebra deliberada do piloto. Migração aditiva e novo contrato de certificado necessários. Branch de basePR59 ainda pendente; não declarar entregue antesmerge/master-sync.

## Aprovação
- Decisão: GO_WITH_RISKS
- Aprovado por: usuário, pedido explícito nesta interação; orquestração define escolhas técnicas no escopo.
- Aprovado em: 2026-11-04T20:29:34-03:00


### Complemento necessário de validação
A primeira coleta completa executou os nove fluxos Chromium, mas a cobertura incremental ficou em59,8651%. Lacunas eram a interface com registros/permissões preenchidos e laboratórios reais fora do coletor. A frente inclui ampliação desses cenários e laboratório descartável obrigatório no coletor Node, com prova de execução/cleanup e cobertura Python real em Cobertura. Sem novo limite, exclusão de fonte ou aceitação de risco. Falha inicial de import foi preservada; bateria repetida com Vite auxiliar encerrado passou.


### Integração e documentação autorizadas em 2026-11-05
Atualizar base após merge da PR59,documentar ferramentas realmente usadas no README e distinguir propostas futuras. Usuário autorizou a integração das duas PRs. Nenhum teste manual em hardware ou deploy foi presumido. Nova revisão do CI exigida antes do merge; alterações locais alheias preservadas em worktree separado.
