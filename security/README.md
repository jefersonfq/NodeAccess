# Verificações de segurança locais

Execute com Node 24.21.0 e Docker:

```sh
npm ci
npm run security:check
npm run security:scan
npm run security:images -- nodeaccess-backend:security-local nodeaccess-frontend:security-local nodeaccess-frontend-k8s:security-local nodeaccess-tls-agent:security-local nodeaccess-mysql:8.4.12-1 nodeaccess-redis:8.2.10-1 nodeaccess-guacd:1.6.0-1
```

`security:check` grava auditorias npm e SBOM CycloneDX em `artifacts/security`, retorna 1 para qualquer vulnerabilidade conhecida e 2 para falha inconclusiva. `-- --runtime-only` restringe a decisão a runtime, mas ainda gera o relatório completo; não equivale a liberar uma release.

`security:scan` copia somente arquivos rastreados/não ignorados para uma pasta temporária, sem seguir symlinks. Executa Gitleaks com redação integral e Semgrep CE localmente, com métricas desligadas. As regras são baixadas do registro Semgrep; o comando usado não envia o código ao serviço. Imagens dos scanners estão fixadas por digest.

Escopo Semgrep: regras comunitárias TypeScript/JavaScript; testes e arquivos históricos `*-NOTE-JEFF.*` excluídos. A regra Express `direct-response-write` foi excluída porque tratava respostas `FastifyReply.send` de DTOs como HTML: Fastify serializa objetos em JSON e strings sem Content-Type explícito como texto. Isso não certifica ausência de XSS; HTML dinâmico, CSP e o proxy web exigem revisão específica. Timeouts/erros de parsing impedem aprovação.

Gitleaks continua examinando testes/documentação. As 44 ocorrências públicas conhecidas estão em `gitleaks-fixtures.json`: chaves descartáveis, marcadores PEM e placeholders. Cada exceção exige regra, linha e SHA-256 integral do arquivo iguais. Não há exclusão genérica de diretórios de teste, nem armazenamento do valor do segredo. Alterações exigem revisão humana; não regenere a lista automaticamente para obter verde. A verificação não cobre histórico Git; executar auditoria histórica antes de tornar um repositório público.

## TLS através de túnel

O proxy HTTPS autentica o hostname/IP original, mesmo conectando a loopback. Certificados privados/autossinados precisam de CA confiável configurada no runtime (por exemplo `NODE_EXTRA_CA_CERTS` montado somente leitura). Acesso que dependia de validação desligada passa a falhar; conferir esses destinos antes de publicar. Não reintroduzir `rejectUnauthorized: false`.

## Imagem gráfica corrigida

A autorização de integrar a versão mais atual na NA-0069 substitui a decisão
histórica de manter guacd 1.5.5 em 08/10/2026. A release usa a imagem própria
`nodeaccess-guacd:1.6.0-1`, com fonte Apache verificada, backport upstream de
compatibilidade FreeRDP e ALSA corrigido. Consulte `docker/guacd/README.md`.
Os relatórios antigos continuam em `docs/reviews/2026-10-08-stack-security-review.md`.

`guacd-image-triage.json` cobre somente três identificações de componente
incorretas, com pacote/versão/CPE/fonte/distro/tag exatos e expiração curta.
Não cobre ALSA nem achados novos; os resultados brutos são preservados.
Provas RDP/VNC e scanner são obrigatórios em cada atualização.

## Antes de liberar uma versão

- Auditoria de dependências e scanners aprovados, com exceções específicas documentadas.
- Build das imagens reais, inventário/SBOM e scan de SO/libs com Grype (o scan npm não os substitui).
- Validar migração e restore em banco descartável; ensaio com backup da instalação antes de migrar MySQL de produção.
- Regressão de login/MFA/SSO, isolamento de tenant, terminal, compartilhamento, SFTP e funcionalidades contratadas.
- Homologação da versão candidata, backup, plano de rollback e janela de atualização. Não fazer downgrade de volume MySQL atualizado; restaurar backup compatível.

MySQL 8.4.12, Redis 8.2.10, Prisma 6.19.3 e imagens Node/Nginx atualizadas foram ensaiados localmente em NA-0046/0047/0048. O gate de imagens preserva os relatórios brutos; três classificações Oracle/FIPS são restritas e expiram em security/image-triage.json. Alertas Medium/Low continuam registrados. NA-0056 aplica CSP à SPA nos quatro perfis Nginx e fornece override nonroot opt-in para API/gateway, com migração/rollback testados. A adoção em instalações existentes, isolamento do proxy web remoto e self-hosting do CDN Monaco permanecem revisões próprias. Consulte docs/OPERATIONS-compose-nonroot.md. Otimização do dashboard e decomposição das telas continuam sendo itens próprios de revisão. Não interpretar a aprovação deste scanner como conclusão de toda a auditoria de engenharia.

## Imagens de runtime e release

O target backend `runtime` permite testar API/gateway com as mesmas dependências de produção, sem distribuir agentes. O target `prod` exige os agentes atuais e assinados, e a chave pública via BuildKit secret `nodeaccess_release_public_key`; o script de release entrega essa chave a partir de `NODEACCESS_RELEASE_PUBLIC_KEY`. A ausência foi validada como falha de build. Não usar a imagem de laboratório como pacote final.

Dentro da imagem de produção, migrations usam `node node_modules/prisma/build/index.js migrate deploy`, sem baixar pacotes via npx. O perfil `dev` continua com npm. O job Helm e os scripts oficiais já usam esse comando. A base Node está fixada em 24.21.0; use `.nvmrc` para alinhar o desenvolvimento.
