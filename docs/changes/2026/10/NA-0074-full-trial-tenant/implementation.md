# NA-0074 — Registro da implementação

## Pedido e objetivo
Avaliar tenant de teste com experiência completa e avisos menos intrusivos, mantendo controle e isolamento.

## Implementação
Base SHA 3dcb1bb60a36a5d5359fd8d35f5a3e94284c80d1. Implementação full opt-in: administração/licença tenant, cotas e destinos, transportes, integrações, retenção e navegação normal. O diagnóstico inicial confirmou restrições no backend e UI; a correção não se limita à visibilidade dos menus.

## Validação
Ran: testes unitários, SQL descartável, navegador e terminal real conforme diário abaixo. Manual: usuário validou cadastro e host base da versão anterior. Planned: gates do SHA final, build oficial e implantação com backup. Homologação humana do perfil completo ainda não realizada.

## Recuperação
Código local alterado em branch separada; ambiente remoto ainda não alterado. Publicação exige backup novo de banco, imagens e arquivos. Após promoção, rollback automático para a retenção antiga bloqueado; correção adiante ou recuperação explicitamente revisada, preservando novas gravações.

## Pendências
Validar isolamento por módulo, integrações com credenciais próprias, permissões administrativas limitadas ao tenant e atualização dos perfis existentes. Implementação em andamento; publicação depende de revisão final, testes reais de runtime, build/CI, backup novo e conversão explícita do tenant autorizado.

## Diário de interações

### 2026-10-25T22:25:02-03:00 — Revisão da experiência completa

Registrado relato de cadastro/conexão bem-sucedidos e pedido de funcionalidades completas com indicação discreta do teste. Confirmadas limitações explícitas de papel, licença, política e interface. Proposta: capacidades configuráveis dentro do tenant, preservando controles operacionais e contas normais, com destaque de vencimento no último dia. Próximo passo: matriz de recursos e revisão de autorização antes de alterar produto.

### 2026-10-25T22:58:55-03:00 — Implementação full autorizada e host inicial automático

Usuário aprovou implementação fim a fim e conversão da conta de teste já existente; pediu um host inicial automático e status real de provisionamento. Branch isolada mantida. Inspeção remota somente leitura confirmou conta proprietária de trial ativo com host inicial, sem alterar seus dados. Identificador pessoal permanece fora do repositório.

Implementado em andamento: perfil full opt-in (ausência continua guided), licença tenant, promoção transacional/idempotente com papel ADMIN somente tenant e invalidação da sessão antiga; menus/CRUD normais com controles de recursos; painel recolhível e aviso final24h; atualização automática/retry do status de espera. Quotas de hosts/usuários incluem concorrência, reservas de convites e proteção do demo nas operações normais e em massa. Transportes adicionais recebem validade, identidade/destinos e limites; outbound e retenção ampliada em revisão. IA tem teto vitalício de requisições e concorrência, com leases duráveis, sem prometer medição de tokens.

Ran: baseline backend291PASS/59opt-in skipped; frontend102PASS. Incremental backend362PASS/62opt-in skipped; revisão independente96policiesPASS. SQL real novo4PASS (promoção, hosts concorrentes, usuários com reservas, IA); regressões SQL legado+full17PASS após corrigir dois fixtures antigos: nome de duas letras não atende contrato NA0073 e singleton de perfil ausente no teste isolado eliminava o lock usado em produção. Asserções de segurança preservadas. Retenção11SQLPASS e promoção independente2SQLPASS. Frontend106unitPASS, tipos/lint, browser full/normal/guided, manualcapturado5capítulos; testes de navegador usam APIs simuladas. Suíte global e runtime/PTY reais em andamento, ainda sem resultados finais.

Revisões identificaram e corrigiram fechamento de transporte antes de persistência em banco, revalidação após handshake e bypass de edição do demo via bulk. Outros ingressos (OAuth/LDAP/SCIM/SDK/SMTP) seguem em revisão explícita; não declarar todos certificados. Nenhuma implantação, novo e-mail ou alteração da conta real nesta etapa. Próximo passo: concluir cobertura de ingressos, executar gates reais e revisão independente, preparar pacote/backup e atualizar somente o alvo aprovado.

### 2026-10-25T23:29:35-03:00 — Validação local e compatibilidade das flags

Ran: suíte global2628PASS/115opt-in skipped; tipos globais PASS; SQL adicional hosts próprios9PASS, máquinas15PASS, notificações11PASS; promoção/CAS e quotas4PASS. Navegador real com MySQL/Redis: login/MFA, CRUD normal/full, SSH e SFTP; terminal oficial top/htop nos dois perfis4PASS. Provisionador e SMTP desse cenário foram doubles, não evidência de entrega real ou isolamento remoto. SQL do worker IA confirmou seleção antes de LIMIT e requeue exclusivo full, preservando filas normais. Quota de hosts testada com connection_limit=1:1PASS e zero consultas fora da transação.

Inspeção somente leitura identificou flags gerais MCP/IA/auditoria desligadas. Decisão: disponibilidade por snapshot full apenas no tenant, respeitando exclusões/licença; flags normais intactas. Provedores continuam exigindo configuração própria. Revisão corrigiu cancelamento indevido da fila normal e consultas fora da conexão transacional na quota de hosts.

Scan inicial: Semgrep sem achados; dois apontamentos Gitleaks eram fixtures sintéticas já registradas cujo hash mudou. Revisão independente confirmou natureza descartável e registro exato atualizado; rerun pendente. Lint global identificou dívida preexistente (902 erros/9164 avisos); gate dos arquivos alterados em execução sem desabilitar regras. Build e revisão final em andamento. Nenhum pacote novo, promoção ou publicação remota executados. Próximo: congelar fonte, commit autorizado, gates do SHA/CI e implantação com backup novo.

### 2026-10-25T23:36:44-03:00 — Gate local e correção concorrente final

Ran:2628 unitários passaram/116 opt-in não executados na suíte padrão; opt-ins relevantes executados separadamente conforme registros. Lint de todos os arquivos alterados passou sem avisos; tipos globais passaram; build passou (aviso conhecido de tamanho de chunks); manual check-reviewed passou. Security scan passou:44 fixtures revisadas, zero achados não revisados, Semgrep815 alvos sem achados/erros.

O rerun concorrente detectou uma regressão na primeira correção do pool: leitura consistente antes do lock permitia8criações para3vagas em REPEATABLE READ. Corrigido para FOR UPDATE antes de qualquer leitura consistente; aplicado também em update/delete e operações em lote, removendo consultas globais dentro da transação. SQL completo4PASS novamente; teste independente pool1 e8transações sincronizadas aceitou só a vaga disponível, preservando demo e destinos. Revisões independentes de backend/integrações/operação favoráveis, limitadas ao WIP e ambientes realmente exercitados. Tipagens/lint antigos nos arquivos tocados ajustados sem desligar regras.

Próximo: evidência de capacidades com flags gerais desligadas, commit autorizado e gates do SHA. Ambiente remoto permanece inalterado e homologação humana full pendente.

### 2026-10-25T23:37:38-03:00 — Candidato pronto para commit autorizado

Ran: prova real normal/full com senha e MFA, flags gerais desligadas; MCP normal403/full200, token com escopo limitado listou somente ferramenta permitida, recusou capacidade fora do escopo e foi revogado. UI de MCP/auditoria/IA renderizou; auditorias das sessões SSH anteriores disponíveis no próprio tenant. Sem chamada a provedor externo de IA. Lint alterado e scanner final passaram. Revalidação remota somente leitura confirmou versão anterior intacta, alvo/prazo/host preservados e sem sessões na leitura; não garante estado futuro do corte.

Decisão: consolidar candidato na branch conforme autorização já concedida; publicar PR e executar gates no SHA exato antes do pacote/implantação. Homologação humana ocorrerá na conta após atualização autorizada para validação, sem inferir aprovação funcional dos testes automatizados.
