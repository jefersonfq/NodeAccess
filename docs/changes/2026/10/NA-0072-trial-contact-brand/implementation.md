# NA-0072 — Registro da implementação

## Pedido e objetivo

Telefone opcional, identidade visual NodeAccess no trial e CTA Faça uma degustação com tooltip no site.

## Implementação

Base SHA: 5ab461f6eaaf3580e0e6d222f50248d16adc4fc5. Branch feature/NA-0072-20261024-trial-contact-brand. Implementação em andamento: contrato, cifra, retenção e consulta restrita a administrador de plataforma; marca existente e formulário opcional; CTA acessível e aviso versionado.

## Validação

Ran: checkout limpo e base sincronizada; 83 testes backend/contrato/provider/logger, sete testes de retenção MySQL e oito testes MySQL de transação/autorização HTTP passaram. Migração nullable preservou registro anterior com telefone nulo. Typecheck e lint backend passaram. Frontend/site e revisão independente descritos no diário. Manual: revisão jurídica não substituída por testes.

## Recuperação

Alteração aditiva; preservar versão e dados atuais antes de publicar. Não reutilizar rollback antigo.

## Pendências

Implementação, validação, integração e publicação.

## Diário de interações

### 2026-10-24T18:45:07-03:00 — Pedido de contato e identidade visual

Usuário pediu telefone opcional, logos/cores e CTA/tooltip. Decisão: finalidade de contato sobre a degustação, sem marketing automático; tooltip deve respeitar confirmação de e-mail. Consultadas fontes oficiais LGPD/ANPD sobre finalidade e necessidade. Nenhum dado pessoal real em testes.

### 2026-10-24T18:51:13-03:00 — Escopo administrativo e validação do site

Consulta do telefone limitada ao administrador da plataforma pela rota existente, sem novos privilégios para tenants. Telefone não é enviado ao provisionador ou notificações e não concede consentimento. Ran: site em 390/768/1440 px, link correto, teclado, Escape, hover sobre tooltip, apresentação touch e ausência de overflow. Screenshot mobile revisado. Migração e testes de aplicação em andamento. Snapshot operacional somente leitura encontrou zero sessões abertas e zero trials não removidos; nova conferência será necessária antes de publicar.

### 2026-10-24T18:54:50.134428-03:00 — Compatibilidade e privacidade validadas

Baseline backend encontrou dependências locais Zod3 incompatíveis com o lock atual. npm ci alinhou dependências sem alterar lock/source; baseline60 passou antes do produto. Após alteração, gates backend passaram: ausência/vazio/formato, cifra, reenviar sem sobrescrever telefone, resposta pública sem telefone, admin de plataforma com campo e no-store, anônimo401 e tenantadmin/user/trial403. Retenção apaga telefone em registro encerrado e preserva ativo. Revisão independente executou64 testes adicionais. Scanner encontrou somente fingerprint antigo de fixture sintética inalterada em logger.test.ts:8; atualizado apenas hash daquele arquivo após comparação exata com a base. Semgrep806 alvos sem achados/erros; repetição integral do scanner em andamento.

### 2026-10-24T18:55:37.302719-03:00 — Fonte validada para integração

Ran: frontend35 testes unitários com lock exato; typecheck, build e lint passaram. Navegador seis casos em temas claro/escuro e larguras390/768/1440 passou: marca, cor real, CTA, telefone inválido e foco, vazio omitido, falha503 preservando formulário, exibição administrativa e estados existentes. Limite maxlength40 confirmado no DOM após ajuste final. Build mantém aviso anterior de chunk grande. Site passou três larguras com teclado/Escape/hover/touch. Revisão independente GO.

Prova de migração: banco local descartável recebeu migrations da base5ab antes da coluna; inserido registro sintético PENDING_EMAIL, aplicada migração aditiva. Consulta confirmou um registro com mesmo identificador/nome/e-mail/status e phone_encrypted NULL (resultado booleano1). Fixture removida por identificador/e-mail próprios. Não houve alteração remota nesta validação. Artefatos em /tmp/na0072-{migrate-base,migrate-phone,migration-preservation}.log.

Integração, pacote e implantação ainda pendentes; fonte será congelada. Novo backup consistente e cópia externa serão exigidos antes da migração remota. Não inferir homologação humana dos testes automáticos.

Scanner final Ran:44 fixtures reconhecidas, zero achados novos, Semgrep806 alvos sem achados nem erros. O build de release regenerará o frontend para incluir maxlength40; o build local anterior ocorreu antes desse ajuste de atributo, validado depois no DOM e nos unitários.
