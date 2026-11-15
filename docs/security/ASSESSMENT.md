# Inventário focal da Central de Segurança — 06/11/2026

Base examinada: `745253d1edb522db79aaa44fd96608ce434a2774`. Escopo: evidência editorial para a Central da NA-0172, sem pentest, alteração de autenticação ou auditoria exaustiva. Testes mapeados não foram executados nesta leitura; os resultados da implementação ficam no registro da frente. Catálogo público não fornece estado operacional por tenant.

| Controle | Estado da alegação | Evidência principal | Limite e texto publicável |
|---|---|---|---|
| Login e verificação adicional | Confirmado no fluxo local inspecionado | `auth.service.ts`: beginMfaForUser, verifyTotp; `auth-policy.ts` | Explicar conta individual e etapas de verificação; não generalizar cada provider externo nem afirmar a configuração atual do usuário. |
| Permissões de hosts | Confirmado no escopo da leitura | `ssh.repository.ts`; `inventory-acl-session-revocation.service.ts` | Explicar permissões por usuário/grupo. Revogação em todos os protocolos requer validação integrada; não prometer término universal imediato. |
| Cofre | Confirmado no escopo da leitura | `secret.service.ts`: toPublic, encrypt, findAccessibleActiveById; `shared/crypto.ts` | Armazenamento cifrado, metadados nas listagens e autorização de uso. Não afirmar que nenhum segredo pode chegar ao browser: entrada legítima e usos específicos precisam ser distinguidos. |
| Identidade dos hosts | Parcial | `ssh.session.ts`: buildConnectConfig; `host.service.ts`: trustHostKey | A instalação do hostVerifier depende da presença do campo trustedHostKeyFingerprint. A Central orienta tratar avisos e conferir o destino; não promete verificação universal de todos os caminhos/protocolos. |
| Auditoria | Confirmado como recurso condicional | `session-audit-policy.service.ts`: shouldAuditSession; `managed-ssh-session.service.ts` | Depende de recurso/licença/política/escopo. Não afirmar gravação ativa, retenção específica ou imutabilidade. |
| Qualidade automatizada | Confirmado como tooling disponível | Workflows Sonar/security e scripts audit/scan-local | Descrever análise de código/dependências/segredos e testes. Resultado histórico não certifica versão futura. |
| ZAP e Stryker | Planejado na base desta frente | PR61 separada; não existe security-assurance nesta base | Não publicar como ferramenta integrada nesta versão. Reexaminar após integração. |
| Segurança adaptativa e SSH CA | Planejado | Avaliação do plano v2 | Não publicar como capacidade entregue. |
| Estado da instalação | Não verificado | Nenhuma consulta ao runtime pela página | Não afirmar HTTPS ativo, scanner recente, controle habilitado ou ausência de vulnerabilidades. |

Os caminhos completos e hashes constam no catálogo interno. Os testes mapeados cobrem tokens temporários/políticas, ACL, revogação, Cofre/criptografia, política de auditoria e integração Sonar. Seu vínculo não substitui a execução no candidato final.

## Pendências para frentes futuras

Confirmar abrangência de host keys em cada caminho de conexão, revogação em cada protocolo, fluxo completo de credenciais/importação/integrações, isolamento multi-tenant e política de falha dos controles. São pontos de investigação, não vulnerabilidades demonstradas por esta leitura. Reusar ferramentas e matriz de testes existentes antes de introduzir novos scanners.

Nenhuma topologia real, credencial, dado pessoal ou limiar de detecção foi usado neste inventário.


## Revalidação focal NA-0174 — 15/11/2026

A descrição anterior registra a inspeção inicial. No candidato sobre master28685c5b2,
foram corrigidos os controles reproduzidos de tokens, identidade SSH/SFTP/bastion e
revogação nativa/distribuída. Catálogo interno revisto por conteúdo e hashes; alegações
públicas e estados partial preservados. `testsExecuted:false` refere-se ao inventário
editorial; testes realmente executados ficam na evidência da NA-0174, sem misturar os papéis.

Laboratórios exercitaram login/TOTP/HTTP/MySQL/Redis, ACL e Cofre com banco real, SSH/SFTP
com chaves distintas, encerramento nativo, ACK distribuído e PTY da aplicação completa.
RDP/VNC foram verificados nos contratos de gateway/registry com transporte injetado,
não em sessão gráfica real. Redis Pub/Sub não é fila durável; evento tardio pode encerrar
uma reconexão válida do mesmo principal. Estado operacional de produção não foi consultado.

O catálogo continua informativo, sem certificar uma instalação ou transformar a matriz
focal em auditoria exaustiva. Gates finais e entrega: docs/changes/2026/11/NA-0174-security-diagnosis.
