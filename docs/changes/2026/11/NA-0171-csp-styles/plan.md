---
change_id: NA-0171
title: Endurecer CSP de estilos preservando terminal e editor
type: security
status: in-development
created_at: 2026-11-05T11:04:22.944133-03:00
base_branch: master
base_sha: 745253d1edb522db79aaa44fd96608ce434a2774
branch: security/NA-0171-20261105-csp-styles
owner: Codex
planner: csp_assessment
risk: medium
issue: null
---

# NA-0171 — CSP de estilos

## Contexto e situação anterior
ZAP real da NA-0170 encontrou Medium 10055-6: style-src permite unsafe-inline nas quatro configurações nginx. Integração das ferramentas permanece na PR61 em frente separada, com gates ZAP/CSP dependentes desta correção. Diretório principal tem trabalho preexistente; código isolado em /tmp/nodeaccess-NA-0171 e documentação canônica em docs do projeto atual.

## Problema e objetivo
Bloquear elementos style arbitrários sem autorização criptográfica e preservar interface, terminal e editor. Não esconder alertas nem ampliar script-src.

## Escopo
Nonce criptográfico por resposta HTML, integração Vite e emissores de estilos dinâmicos, configurações nginx/Docker e cache de navegação. Preferir APIs nativas; patches restritos e verificáveis de dependências somente quando necessários. Monaco local fixado poderá ser necessário para controlar emissão de estilos. Não alterar autenticação, autorização, transporte SSH, banco ou produção. Não corrigir outros alertas ZAP nesta frente.

## Critérios de aceitação
- [x] Style sem nonce e nonce incorreto bloqueados; nonce correto aplicado em navegador real.
- [x] Nonces distintos entre respostas, header/HTML consistentes, sem fallback previsível ou placeholder residual.
- [x] Scripts inline/eval continuam bloqueados; documentos externos do web proxy preservam sua política.
- [x] Login, temas, overlays NaiveUI, editor Monaco e terminal principal/supervisão funcionam.
- [x] Cache/SW não reutiliza documento com nonce; assets versionados preservados.
- [ ] Testes de interface, prints, terminal-experience, build, typecheck, Sonar e ZAP reais registrados.

## Estratégia técnica
Validar nonce nginx com fonte criptográfica que falhe de forma fechada. Vite html.cspNonce recebe placeholder substituído apenas em HTML. Emissores css-render/xterm/Monaco precisam propagar nonce sem interceptação global do DOM ou autorização automática de elementos desconhecidos. style-src-attr poderá ter exceção explícita somente mediante necessidade demonstrada e risco residual registrado; não equivale a eliminar todos os alertas. Não relaxar scanner para obter aprovação.

## Riscos e mitigações
CSS dinâmico pode quebrar editor/terminal: baseline e comparações visuais, testes negativos e fluxos reais. Nonce em cache pode ser reutilizado: validar SW/cache/304/offline. Dependências patchadas podem divergir: versões/hashes e falha explícita. Carga dos testes: ambientes descartáveis isolados.

## Matriz de testes e evidências
Contratos de geração/configuração/patches; respostas reais nginx; testes negativos de CSP; Chromium desktop/mobile claro/escuro, modais, editor e terminal; test:terminal-experience:web obrigatório. test:terminal-pty:real se houver impacto em geometria/resize/transporte. Build/typecheck e validate:sonar. ZAP real usando infraestrutura NA-0170 sem publicar gate reprovado como verde. Revisão independente obrigatória; homologação humana separada.

## Baseline
Base 745253d1edb522db79aaa44fd96608ce434a2774. Inspeção readonly confirmou CSS sem nonce em css-render 0.15.14 e xterm 5.3.0; Monaco CDN sem integração suficiente. ZAP NA-0170: 12 cenários, 18 mensagens, 62 regras, 1 Medium, 2 Low, 4 Info, cleanup completo. Browser Sonar NA-0170 falhou por pressuposição de ordem de requisições SFTP no harness; investigação separada em andamento, sem atribuir a CSP ainda não alterada.

## Rollback ou recuperação
Reverter PR da frente, sem alteração de dados. Preservar worktrees e evidências. Nenhuma instalação produtiva autorizada nesta etapa.

## Mudanças de escopo e decisões
Usuário autorizou corrigir CSP em frente separada com testes de interface. Esta é a implementação dessa escolha. Resíduos devem ser relatados honestamente, sem falso positivo automático.

## Aprovação
Decisão: GO_WITH_RISKS. Escopo autorizado pelo usuário nesta interação; análise de viabilidade readonly concluída. Validação funcional humana permanece pendente após resultado concreto.

### Correções necessárias identificadas na validação
Monaco local usa DOMPurify npm corrigido, comprovado no bundle; override isolado seria insuficiente devido à cópia vendorizada. Coleta real CSP adicionada à cobertura com cenários completos, hashes, cancelamento e limpeza restrita aos recursos próprios. Builds públicos têm permissões próprias; artefatos privados continuam protegidos. Nenhum threshold ou regra foi desabilitado.
