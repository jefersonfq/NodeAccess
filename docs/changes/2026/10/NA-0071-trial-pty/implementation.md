# NA-0071 — Registro da implementação

## Pedido e objetivo

Corrigir a recusa de PTY nos hosts de degustação, descoberta na validação operacional da entrega 2.1.0. Implementação local autorizada pelo orquestrador; não executar em produção nem fazer commit antes do gate.

## Implementação

Base SHA: 55a9138d87678bf6e03ddddb1ea9adfcdb7ccc72. Branch fix/NA-0071-20261024-trial-pty no workspace principal. Provider adiciona CHOWN somente ao daemon de laboratório e exige essa lista exata na inspeção; README explica a atribuição do PTY. Blackbox passa a pedir shell PTY real com dimensões e resize, mantendo exec, SFTP e isolamento.

## Validação

Ran: RED real em Docker local confirmou `Unable to request a pseudo-terminal` antes da alteração (/tmp/na0071-pty-red.log). Ran: 10 testes unitários provider e sintaxe dos dois arquivos Node passaram. Primeiro GREEN aceitou PTY, mas revelou normalização insuficiente do harness; após corrigir CSI/CR, blackbox completo passou em 27,1 segundos (/tmp/na0071-pty-green.log): PTY 24x80, resize 37x111, exit 0, UID 1000, CapEff zero, NoNewPrivs 1, exec/SFTP, DNS/host/controles/outro lab bloqueados, restart, expansão, tombstones e proteção de endpoint alheio. Cleanup concluiu sem aviso de recursos pendentes. Sintaxe e git diff --check passaram. Lint-changed executado: nenhum TS/Vue afetado. Revisão independente trial_review retornou PASS, incluindo teste adicional de policy real para CHOWN ausente, NET_ADMIN extra e CHOWN duplicado recusados antes de exec. Certificação de navegador/target real posterior coordenada pelo orquestrador; não executada nesta frente ainda.

## Recuperação

Sem migração de dados ou mudanças remotas. Reversão do patch restaura a configuração anterior e a falha PTY. Containers existentes sem CHOWN são recusados por drift: não há recriação silenciosa. Root informou remoção dos laboratórios operacionais de teste antes da atualização, sem clientes públicos de degustação.

## Pendências

Commit, publicação, pacote e validação operacional permanecem sob gate do orquestrador.

## Diário de interações

### 2026-10-24T17:45:46-03:00 — Correção necessária de PTY

Orquestrador autorizou plano estreito e confirmou que testes provider PTY/resize são obrigatórios. Base limpa e ID livre verificados; branch e plano criados. RED reproduziu o erro. CHOWN aplicado mantendo cap-drop ALL, sessão sem capabilities e demais políticas. Primeiro teste posterior requer diagnóstico da saída PTY; nenhuma aprovação inferida.

### 2026-10-24T17:48:19-03:00 — Diagnóstico do harness

A saída sintética mostrou `24 80` após CSI de bracketed paste e retorno de carro isolado. A primeira assertion exigia newline e não reconhecia a resposta correta. O harness agora normaliza CSI e CR para comparar as linhas exatas, sem alterar produto ou valores esperados. Reprodução posterior passou: dimensões iniciais e finais exatas, sessão sem privilégios e fechamento normal.

### 2026-10-24T17:49:33-03:00 — Revisão independente

Trial_review revisou diff e artefatos, acrescentou regressão negativa de capabilities e retornou PASS no escopo. Dez testes unitários passaram novamente após a incorporação. Fonte local sem commit, pronta para gate do orquestrador; não há deploy ou homologação humana inferidos.

### 2026-10-24T17:50:26-03:00 — Correção de estrutura do plano

Após o commit local ainda não publicado, o gate de governança recusou títulos não canônicos, ausência de checklist e campo explícito de decisão. Ajustados somente títulos, organização e checklist do plano para o template oficial; critérios e escopo preservados. Nenhum código alterado. O orquestrador fará amend e repetirá os checks; esta correção não declara esses checks já aprovados.

### 2026-10-24T17:59:42-03:00 — Fixture de documentação e validação operacional

CI identificou hash desatualizado da fixture já revisada em scripts/trial-lab/README.md:64. Revisão independente confirmou placeholder idêntico à base, mesma linha/regra/motivo; apenas fileSha256 dessa entrada foi atualizado. Scanner deve ser repetido no novo SHA. Ran: no commit anterior, PTY/resize/isolamento real novamente PASS; sete grupos do runtime com imagens finais PASS. O build oficial gerou pacote da tentativa anterior, preservado; somente documentação/fixture muda neste incremento, sem alterações no código compilado ou artefatos assinados.

A instalação foi atualizada e os acessos normais reabertos com degustação desligada. Dados originais e nove credenciais passaram na comparação; backup final consistente e cópia externa verificados. A prova real de degustação passou e-mail, MFA, expansão/cota e cancelamento; PTY falhou antes desta correção. Labs próprios removidos e fila vazia. Conta técnica normal desativada: novo login recusado; JWT somente expirou naturalmente, comportamento anterior preservado, sem alegar revogação imediata. O aceite atual é NORMAL_ONLY_TRIAL_DISABLED; degustação, pacote final corrigido e publicação do site continuam pendentes. Não restaurar backup anterior sobre novas gravações após reabertura. Nenhuma homologação humana inferida.

Ran após correção da referência: scanner oficial PASS (44 fixtures revistas, zero achados novos; Semgrep 805 alvos, zero achados/erros). O provedor remoto recebeu apenas provider.mjs revisado com backup privado e troca atômica; restart propagado ao proxy por PartOf, TLS/autenticação/ociosidade PASS, containers da aplicação e guard intactos. Flag de cadastro permanece desligada; nova prova target pendente.
