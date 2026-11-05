# NA0156 — Registro da implementação

## Pedido e objetivo
Corrigir dois problemas concretos de credenciais em harnesses e comprovar três ocorrências propostas como falsos positivos, sem alterar gates ou decisões no servidor.

## Implementação
Base: 28a77996deb4c004690e828c4a3a1f6dd292d198. Worktree: /tmp/nodeaccess-NA-0156.
A senha sintética do POST negativo403 usa randomBytes(32) hex. O harness Ollama-only não cria mais Secret inutilizado nem informa existingSecret. Chart, guard CJS e permissões ACME de produção permanecem intactos. Testes adicionais exercitam import/CLI reais, leitor UID65534 e ausência de Secret na orquestração simulada.

## Validação
Ran: contratos Node, render Helm, probe AST, lint suportado, shell syntax e revisão independente. Planned: scanner e cobertura integrados. Manual: homologação humana pendente.
Baseline: 18 contratos PASS. Final: 22 contratos PASS em Node24.22.1, incluindo SSH loopback com pin/credenciais efêmeras, contextos e cleanup simulados, CJS real e permissões reais. Primeiro ensaio: 21 PASS/1 FAIL porque Node privado não podia ser iniciado pelo UID65534; fixture corrigida inicia Node e remove grupos suplementares/UID/GID antes de acessar o nonce. Nenhuma permissão do runtime compartilhado foi alterada.
Helm3.17.3 real por imagem local imutável, rede desabilitada: renders com/sem existingSecret byteidênticos, 3850 bytes e cinco recursos, sem secretRef. Evidência helm-template-proof.json. Sem Kind, cluster ou implantação.
Lint dos três testes alterados: zero erros/warnings. A tentativa incluindo .mts retornou warning de arquivo sem configuração; não foi ocultado. Transpile TypeScript do .mts: zero diagnósticos (não é typecheck semântico). Propriedade password extraída da AST real: 16 execuções, 64 caracteres hex e valores únicos, sem imprimir credenciais. Shell bash -n e git diff --check PASS.

## Recuperação
Reverter somente o commit desta frente. Sem banco, dados ou serviços de produção alterados.

## Pendências
Revisão independente, checkpoint local e integração pela raiz; cobertura e Sonar pendentes. Nenhum achado foi fechado no servidor. Replay estrito dos três FP pertence a NA0157. Homologação humana/publicação e atualização da planilha viva são coordenadas pela raiz, não concluídas nesta frente.

## Diário de interações
### 2026-11-04T12:21:56-03:00 — Planejamento
Raiz atribuiu quatro novos issues e aprovou incluir SQ0304. Plano registrado antes das fontes; baseline18 PASS.
### 2026-11-04T12:32:50-03:00 — Implementação e provas
GO_WITH_RISKS recebido antes das alterações. Dois fixes mínimos e três provas individuais concluídos. Render real e contratos acima executados nesta árvore isolada. Limites: teste UID requer root/Linux; mesmo UID/root e corrida privilegiada permanecem fora da proteção FS. Não houve execução trial completa com DB/browser nem homologação ACME por servidor HTTP real. A prova é leitura/escrita real com UID distinto. Próximo passo: revisão independente e análise integrada.

### 2026-11-04T12:33:30-03:00 — Revisão independente
Agente tooling leu os cinco arquivos alterados e reproduziu 19/19 contratos de Helm-context, restore-env e challenge-files, sem skips. Parecer PASS_WITH_WARNINGS: Helm render e trial-live não repetidos pelo revisor; limites preservados. Raiz coordena scanner/replay e homologação separadamente.
