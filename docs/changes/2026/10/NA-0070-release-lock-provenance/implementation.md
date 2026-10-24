# NA-0070 — Registro da implementação

## Pedido e objetivo

Concluir a release2.1.0 autorizada após detectar divergência de origem no build.

## Implementação

Base fcad4cb041497ae1c508cd33b151c5405940ae1f. Preservar lock canônico no prune.
NA-0069 integrada/master sincronizada; stash original c59cd19 preservado.

## Validação

Ran:48 hashes comparados entre fonte e builder, só lock diverge; modificação em
metadados dev/devOptional de magicast. Validação assinada foraDocker PASS.
Planned: rebuild real, hashes, assinatura, runtime, scanner e pacote.

## Recuperação

Reverter correção por PR; nenhum banco alterado. Artefatos de tentativa preservados.

## Pendências

Pacote oficial, implantação e validação final no VPS. Windows/NLA não homologado.

## Diário de interações

### 2026-10-24T16:43:55-03:00 — Correção necessária ao empacotamento

Usuário mantém autorização para integração/commits/deploy. Revisão independente
confirmou causa e menor correção. Pipeline não será contornado. Produção inalterada.

### 2026-10-24T16:48:10-03:00 — Gates da correção e limite Windows

Ran: build prod com validador assinado Windows/Linux/macOS PASS; prova Docker da
identidade completa após prune PASS; scanner backend PASS (3Medium); runtime real
7grupos PASS, incluindo login/MFA, isolamento, SSH/SFTP, resize, Redis failure/recovery
e encerramento. Vitest/Vite/Playwright/ESLint ausentes; peers opcionais necessários
como TypeScript podem permanecer, conforme o lock e npm. Revisão independente GO.

Usuário confirmou não ter host Windows de teste. RDP Linux/TLS e VNC passam;
Windows/NLA permanece Skipped por ambiente indisponível, sem alegar homologação.
Pacote anterior incompleto preservado; próxima tentativa terá diretório novo.
Scripts privados de cutover receberam revisão independente condicional ao pacote,
backup externo e restore reais; não foram executados. Runtime padrão root será
preservado, overlay nonroot segue opt-in. Nenhuma alteração em produção nesta fase.

### 2026-10-24T16:51:42-03:00 — Confirmação de arquitetura e governança

Usuário perguntou se foi criada uma instalação NodeAccess paralela. Esclarecido:
a mesma instalação será atualizada; a flag habilita onboarding público e não
reclassifica tenants normais. Tenants de degustação e normais coexistem. Apenas
labs de demonstração são provisionados separadamente; cópias de fonte/containers/
volumes são de teste e recuperação, não uma segunda aplicação para clientes.
Produção ainda antiga no momento da resposta. Escopo original mantido.

O CI detectou ausência da seção formal Aprovação/Decisão no plano, embora a
autorização e revisão já estivessem descritas. Seção corrigida sem mudar escopo
ou código. A tentativa de pacote anterior é preservada e será substituída por
novo destino ligado ao SHA atualizado, sem contornar a verificação de origem.
