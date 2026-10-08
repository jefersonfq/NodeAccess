# Verificações de segurança locais

Execute com Node 24.21.0 e Docker:

```sh
npm ci
npm run security:check
npm run security:scan
```

`security:check` grava auditorias npm e SBOM CycloneDX em `artifacts/security`, retorna 1 para qualquer vulnerabilidade conhecida e 2 para falha inconclusiva. `-- --runtime-only` restringe a decisão a runtime, mas ainda gera o relatório completo; não equivale a liberar uma release.

`security:scan` copia somente arquivos rastreados/não ignorados para uma pasta temporária, sem seguir symlinks. Executa Gitleaks com redação integral e Semgrep CE localmente, com métricas desligadas. As regras são baixadas do registro Semgrep; o comando usado não envia o código ao serviço. Imagens dos scanners estão fixadas por digest.

Escopo Semgrep: regras comunitárias TypeScript/JavaScript; testes e arquivos históricos `*-NOTE-JEFF.*` excluídos. A regra Express `direct-response-write` foi excluída porque tratava respostas `FastifyReply.send` de DTOs como HTML: Fastify serializa objetos em JSON e strings sem Content-Type explícito como texto. Isso não certifica ausência de XSS; HTML dinâmico, CSP e o proxy web exigem revisão específica. Timeouts/erros de parsing impedem aprovação.

Gitleaks continua examinando testes/documentação. As 42 ocorrências públicas conhecidas estão em `gitleaks-fixtures.json`: chaves descartáveis, marcadores PEM e placeholders. Cada exceção exige regra, linha e SHA-256 integral do arquivo iguais. Não há exclusão genérica de diretórios de teste, nem armazenamento do valor do segredo. Alterações exigem revisão humana; não regenere a lista automaticamente para obter verde. A verificação não cobre histórico Git; executar auditoria histórica antes de tornar um repositório público.

## TLS através de túnel

O proxy HTTPS autentica o hostname/IP original, mesmo conectando a loopback. Certificados privados/autossinados precisam de CA confiável configurada no runtime (por exemplo `NODE_EXTRA_CA_CERTS` montado somente leitura). Acesso que dependia de validação desligada passa a falhar; conferir esses destinos antes de publicar. Não reintroduzir `rejectUnauthorized: false`.

## Exceção do guacd

Por instrução explícita do usuário em 08/10/2026, guacd 1.5.5 permanece inalterado. Os achados anteriores continuam registrados em `docs/reviews/2026-10-08-stack-security-review.md`; esta decisão não elimina os CVEs nem certifica sua não explorabilidade. Manter acesso restrito à rede do gateway e revisar protocolos expostos na futura implantação. Nenhum container guacd local/remoto foi reiniciado ou alterado nesta revisão.

## Antes de liberar uma versão

- Auditoria de dependências e scanners aprovados, com exceções específicas documentadas.
- Build das imagens reais, inventário/SBOM e scan de SO/libs com Grype (o scan npm não os substitui).
- Validar migração e restore em banco descartável; ensaio com backup da instalação antes de migrar MySQL de produção.
- Regressão de login/MFA/SSO, isolamento de tenant, terminal, compartilhamento, SFTP e funcionalidades contratadas.
- Homologação da versão candidata, backup, plano de rollback e janela de atualização. Não fazer downgrade de volume MySQL atualizado; restaurar backup compatível.

CSP efetiva, usuário não-root no perfil Compose, MySQL 8.0 fora de suporte, otimização do dashboard e decomposição das telas continuam sendo itens de revisão até haver evidência específica de conclusão. Não interpretar a aprovação deste scanner como conclusão de toda a auditoria de engenharia.
