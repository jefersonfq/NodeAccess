---
change_id: NA-0149
title: Validar fronteiras das ferramentas e dos ensaios SSH/TLS
type: fix
status: ready-for-tests
created_at: 2026-11-04T09:41:57-03:00
base_branch: chore/NA-0093-20261103-sonar-delivery
base_sha: ee436402db8bcce7fab4378d6ba28c1673b282b5
branch: fix/NA-0149-20261104-tooling-boundaries
owner: tooling-agent
planner: tooling-agent
risk: high
issue: null
---

# NA-0149 — Fronteiras explícitas das ferramentas

## Contexto e situação anterior

A auditoria NA0145 distingue quatro melhorias tooling propostas de riscos condicionais de ambiente. Os 32 usos de PATH não são 32 exploits comprovados. A autorização atual permite implementar guardas objetivas, testes e simulações, preservando risco residual onde a plataforma não oferece prova suficiente. Frontes concorrentes exigem worktree próprio.

## Problema e objetivo

Impedir seleção inadvertida de destino SSH, remover identificadores operacionais desnecessários dos fixtures, validar seleção de ferramentas e proteger caminhos/diagnóstico TLS sem alterar protocolo, gates ou políticas aceitas.

## Escopo

- SQ0314/0319/0503: anonimizar somente identificadores em fixtures e expectativas coerentes.
- SQ0453: exigir host/porta/usuário e fingerprint SHA256 explícitos no trial-live, com hostVerifier real e deadline de handshake; nunca derivar identidade confiável da chave recebida. Provar antes de autenticação em SSH descartável loopback.
- 32 S4036: um resolvedor compartilhado sem dependência externa, consumo absoluto com argv/shell:false; conservar versões escolhidas pelo operador após validação. Reusar contratos/utilitários existentes quando compatíveis.
- TLS SQ0518/0519: verificar webroot e ancestrais/destino (owner, symlink, modo), evitar chmod de árvore estranha; arquivo exclusivo e cleanup apenas próprio. Desafio público0644 continua público.
- TLS SQ0533: preservar erro de aplicação/rollback e erro secundário de persistência, mantendo pending/recoveryRequired e contrato recuperável; nenhum erro sensível bruto na API.
- Trial credencial efêmera e CIDR explícito; denylist operacional configurável sem removê-la silenciosamente nem enviar seu valor a logs. Cluster/lab: verificar contexto explícito antes de criar secret onde o risco é objetivo.
- Exclusões: apps/backend e frontend de produto, TACACS MD5, volumes da VPS, baseline aceita, regras Sonar, autenticação/transporte do produto e outros achados dos agentes146–148. Os riscos /tmp de backend pertencem à raiz, não a esta frente.

## Critérios de aceitação

- [x] Fixtures deixam de conter os três identificadores operacionais, mantendo semântica e expectativas.
- [x] SSH recusa configuração ausente/chave divergente antes de enviar senha; sucesso somente com fingerprint esperado no servidor descartável; cleanup e deadline em falhas.
- [x] Consumidores executam caminho absoluto validado; PATH vazio/relativo/cwd, arquivo não executável, candidato/ancestral world-writable e symlink para alvo não confiável são rejeitados.
- [ ] Symlinks legítimos de gerenciadores de versão preservados somente com destino e cadeia confiáveis; Linux/macOS usam uid/mode e execução real. Windows respeita PATHEXT sem shell implícito e exige política explícita de raiz confiável quando ACL não puder ser comprovada; não afirmar suporte validado por mocks.
- [x] TLS recusa webroot/destino hostil sem chmod/write no alvo; desafio mantém leitura HTTP necessária; falha dupla mantém diagnóstico de ambas as etapas e estado de recuperação.
- [x] Credenciais temporárias/rede/contexto de laboratório não dependem de segredo conhecido ou destino operacional implícito.
- [ ] Testes do resolvedor e consumidores, TLS, SSH descartável e fixtures passam; revisão independente aceita limites; sem gate relaxado.

## Estratégia técnica

Antes de código, inventariar helpers existentes (git/trusted CLI/private artifacts), entrypoints CJS/ESM/TS e distribuição Docker. Preferir CJS interoperável com Node ESM e TS existentes, sem dependências. Resolução separada de execução: override absoluto explícito quando fornecido; do contrário examinar entradas absolutas do PATH sem fallback em cwd. Em POSIX validar arquivo regular executável, proprietário atual/root e ausência de escrita por outros em candidato e ancestrais relevantes; definir tratamento de ancestral sticky somente quando necessário para testes privados. Resolver symlinks e validar ambos os caminhos, sem prometer proteção contra administrador ou corrida do mesmo UID. Recusar scripts .cmd/.bat como execução sem shell; binários Windows .exe/.com e configurações de raiz serão tratados explicitamente, com testes de seleção e eventual CI Windows coordenado. Não inventar prova de ACL NTFS via bits POSIX.

A confiança em PATH continua operacional: aceitar uma ferramenta pertencente ao próprio usuário não a autentica criptograficamente. Se validar ancestral conflitar com instalações reais, apresentar contrato antes de expandir política. Migrar em lotes por consumidor, preservando executável selecionado e argumentos. Dockerfiles que copiem ferramentas precisam copiar o helper antes da execução, sem mudar imagens ou npm. TLS usa API pública de erro existente e campo de diagnóstico limitado/códigos, não concatenação de mensagens livres.

## Riscos e mitigações

| Risco | Mitigação | Critério de parada |
|---|---|---|
| Quebrar Windows/version managers | Seleção configurável, symlink verificado, testes de plataforma; não hardcode universal | Contrato necessário exige shell ou ACL sem prova: consultar raiz |
| Corridas FS/mesmo UID | Arquivos exclusivos, verificar caminhos e limitar confiança; documentar limite | Não prometer sandbox contra administrador |
| TLS dupla falha mudar resposta | Preservar códigos e estado, testes fault injection | Diagnóstico causa perda de informação/recuperação |
| Laboratório atingir host existente | Exigir destino/chave/contexto, apenas loopback descartável na validação | Qualquer destino não descartável |
| Amplitude dos consumidores | Lotes coerentes e comparação de argv/config antes/depois | Refatoração sem necessidade ou dependência nova |

## Matriz de testes e evidências

| Critério | Validação planejada | Ambiente |
|---|---|---|
| Resolvedor | negativos PATH, cwd, modo, symlink, PATHEXT; child real e argv | Node24.22.1; Windows real via CI quando disponível |
| Consumidores | Git status/provenance real; Docker/openssl disponíveis e doubles explícitos; executável adulterado rejeitado | worktree/laboratório isolado |
| Trial SSH | servidor ssh2 descartável, key mismatch/ausente/credencial efêmera/timeout/cleanup | loopback sem VPS |
| TLS | unitários manager/adapter, desafios HTTP e FS hostil, dupla falha | diretórios privados e containers coordenados |
| Fixtures | contratos e harnesses pertinentes, sem snapshots cegos | Playwright descartável coordenado |
| Qualidade | lint/types focais, governança, scanner integrado pela raiz | nenhum scanner concorrente |

## Baseline

- SHA: ee436402db8bcce7fab4378d6ba28c1673b282b5.
- Ran: leitura de contexto, skill, auditoria individual NA0145, criação/verificação da branch.
- Ran: baseline TLS manager/storage/prepare com Node24.22.1,33/33 PASS,zero skips (4,8s); nenhum Docker/acesso remoto.
- Known: riscos auditados não equivalem a exploração; produção não inspecionada.

## Rollback ou recuperação

Reverter commits da frente restaura ferramentas anteriores sem migração de banco. Recursos de testes terão prefixo próprio e cleanup; não apagar volumes/artefatos de outra frente. Alterações do worker não serão implantadas automaticamente em VPS. Novas exigências de ambiente devem ser documentadas com erro acionável.

## Mudanças de escopo e decisões

Autorização repassada pela raiz: implementação fim a fim, commits locais após revisão, sem push/merge. Planilha e índice canônicos coordenados pela raiz para evitar concorrência. Nenhuma mudança de produto realizada até a revisão deste plano.

## Aprovação

- Decisão: GO_WITH_RISKS
- Autorização de escopo: usuário, transmitida pela raiz em04/11/2026.
- Revisão técnica do plano: raiz autorizou GO_WITH_RISKS em04/11/2026; implementação realizada e revisão final/CI ainda pendentes.
