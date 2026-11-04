# NA0149 — Validação local e limites

Atualizado em 2026-11-04T10:17:29-03:00. Base ee436402db8bcce7fab4378d6ba28c1673b282b5; candidato ainda não commitado, hashes em source-fingerprint.json. Não confundir estes testes com CI do SHA final.

| Validação | Resultado real |
|---|---|
| Baseline TLS manager/storage/prepare | 33/33 PASS antes das mudanças |
| Conjunto final Node focal | 69 testes:67 PASS,2 SKIP (Windows nativo/reparse; Linux não comprova Windows) |
| Git/status/proveniência/release | 13/13 incluídos no conjunto final; empacotamento a partir de cwd distinto e caminho com espaços |
| SSH real loopback | pin divergente:0 tentativas de senha; pin correto:1 autenticação; servidor silencioso:deadline e cleanup |
| TLS real em Docker | build estágio tls-agent PASS; Certbot/ACME/HTTP01, troca TLS, SSH PTY/WebSocket e recuperação PASS; containers próprios removidos |
| Doctor | 16 checks,0 findings,4 warnings previstos pelo fixture |
| Kubernetes/Ollama | 2 simulações de CLI: contexto explícito em todas operações; falha create não exclui cluster nem cria segredo. Não subi cluster/modelo |
| Reconstrução auditoria | 12 cenários PASS,nenhum extraFinding; transcript anonimizado preservado |
| Browser audit | 2 cenários desktop/mobile após correção do snapshot; reconstrução pronta,0 eventos de erro Vue |
| Browser investigações | 4 cenários desktop/mobile e estados; dados documentais visíveis |
| Lint | 34 arquivos JS/CJS/MJS:0 erros/0 avisos. Cinco tools TS/MTS fora da configuração existente: transpile/sintaxe PASS, não equivale a typecheck semântico |
| Bash/diff/workflow | bash -n e git diff --check PASS; YAML matrix/trigger validados |
| Política de imagens | 3/3 testes PASS; nenhuma regra de bloqueio alterada |
| Revisão independente raiz | 41 testes:39 PASS/2 Windows SKIP; PASS_WITH_WARNINGS (ACL Windows/mesmo UID/CI hospedado) |
| Sonar/CI publicado | Não executados nesta frente; raiz coordenará após integração |

## Falhas encontradas e corrigidas durante validação

1. Resolução inicial colapsava cadeia de symlinks e resolvia novamente ao retornar. Revisão raiz exigiu caminhada por readlink e retorno do alvo verificado. Negativo com diretório intermediário UID estrangeiro passou.
2. Cópia de release e contexto Docker omitiram novo helper. Teste isolado e build falharam; manifesto/teste/.dockerignore/COPY foram ajustados sem ampliação genérica do contexto.
3. Worker TLS inicia cwd `/`; guarda inicial classificava toda árvore do sistema como workspace, impedindo OpenSSL. Container sem rede reproduziu EXECUTABLE_IN_WORKSPACE. Caso raiz passou a rejeitar somente executáveis diretamente na raiz, preservando proteção de subárvore de projeto; integração real voltou a passar.
4. Novo teste de rollback com EROFS inicialmente injetava falha no início do step, antes de executar Nginx. A injeção foi movida para a gravação posterior à operação; asserção verifica duas chamadas de validação, rollback confirmado e código secundário.
5. Capturas audit mostraram toast apesar do pageerror vazio: mock `/reconstruction` retornava `[]` e componente acessava `metadata.issues.length`. Corrigido snapshot/histórico conforme schema e adicionada guarda do evento `nodeaccess:ui-error` e prontidão da reconstrução. Capturas audit-1/2 são antes dessa correção do harness; audit-fixed-1/2 são depois. Nenhum componente foi alterado.

## Revisão visual

Foram inspecionadas capturas desktop/mobile. O toast desapareceu após corrigir o fixture; IPs e nomes agora são sintéticos. Investigação mobile mantém conteúdo legível. No audit mobile, cabeçalho General information/Recolher ainda quebra palavras; é observação da UI inalterada nesta frente, não homologação visual plena nem regressão atribuída à anonimização. Capturas são ensaio com API simulada, sem backend operacional.

## Limites e riscos residuais

- Resolvedor não autentica conteúdo do binário nem isola atacante com mesmo UID/admin; valida caminho/propriedade/permissão e mantém ambiente explicitamente confiado.
- Windows requer raízes configuradas; bits POSIX não provam ACL NTFS. Check nativo adicionado ao matrix Windows/Linux/macOS, ainda pendente de CI hospedado.
- TLS webroot foi validado em Linux/Docker; não prometer comportamento ACL Windows ou proteção universal contra corrida do mesmo UID.
- Trial-live completo MySQL/Redis não foi executado; configuração e SSH descartável foram ensaiados, sem VPS ou host padrão.
- Risco TACACS/MD5 e defaults /tmp de backend não pertencem a esta frente e não foram encerrados.
- resolution.json contém propostas, não duplicata das dispositions nem autorização para aceitar riscos no servidor.
