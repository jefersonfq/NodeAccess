# Evidências — imagens e regressão integrada

Validação local, sem deploy ou acesso à produção. Base NA-0047.

## Implementação

- Node 24.21.0, Nginx 1.30.5 e variante não-root fixados por digest; pacotes do SO atualizados no build. Timeouts de download evitam builds indefinidos. Inventário em docker/stack-images.json.
- API: dependências de desenvolvimento e npm/npx/Yarn removidos da imagem. Instalação, atualização, rollback e job Helm executam diretamente o Prisma instalado, preservando funcionamento offline. Build mantém ferramentas necessárias.
- Scripts de instalação de oito dependências aprovados por versão exata no package.json para compatibilidade com npm recente; sem autorização geral de scripts novos.
- Removido nginx-module-image-filter, sem uso nas configurações do projeto, e suas bibliotecas TIFF com alertas High.
- Worker TLS usa Node 24.21.0 e Certbot 5.6.0 em ambiente Python isolado, com dependências fixadas. cryptography 50.0.0 e urllib3 2.8.0 corrigem alertas trazidos pelo pacote Certbot da distribuição. Gerenciador pip removido após instalação.
- Corrigida precedência de location /assets/: a regex de extensões substituía o cache imutável pretendido. Os quatro perfis passam a usar ^~.
- Backend possui target runtime para testes da API. Prod depende obrigatoriamente da camada de agentes assinados, com chave pública entregue ao build por secret. Não foi criado pacote de distribuição sem assinatura.
- Novo gate de imagens por ID imutável, relatórios brutos e classificação estrita/expirável de dois falsos positivos Oracle/FIPS. Nenhum alerta foi apagado do scan.

## Testes executados

- Build real: API/runtime, frontend Compose, frontend Kubernetes e worker TLS.
- Novo harness cria rede, bancos, API, gateway e Nginx descartáveis. Executa migrations duas vezes, inclusive sem root e com filesystem somente leitura; valida carga do bcrypt/client e ausência das ferramentas removidas.
- HTTP real pelo Nginx: schema inválido, login, cadastro/validação de MFA, rejeição de token temporário, isolamento de tenants, refresh e revogação por logout. HTTPS valida a CA do laboratório; headers e assets são verificados nos dois perfis Nginx.
- Readiness passa a 503 na interrupção do Redis; liveness permanece 200. Recuperação e SIGTERM sem kill forçado na API/gateway aprovados.
- TLS/ACME real com Pebble: emissão, renovação, simulação, troca de certificado, rollback com configuração inválida, recuperação de volume read-only e continuidade da mesma conexão SSH/PTTY/WebSocket. Relatório tls-integration.json.
- A atualização Python/urllib3 detectou certificado de laboratório sem Authority Key Identifier; a fixture foi corrigida com AKI/SKI e keyUsage de CA, mantendo validação TLS habilitada.
- Helm lint/render e testes TLS unitários: aprovados. Sintaxe shell e diff-check aprovados.
- Auditoria npm completa: zero achados conhecidos. Scan final das seis imagens em image-scan.json: zero Critical; dois High brutos MySQL classificados conforme image-triage.md, sem High não revisado.
- Suíte geral na NA-0047: 1.839 testes aprovados. Integrações opcionais são registradas separadamente; não se somam testes ignorados à contagem de aprovações.

## Repetição

Workflow .github/workflows/stack-compatibility.yml prepara as imagens e executa upgrade/restore, contratos Prisma, stack por HTTP, TLS e gate de imagens. Foi preparado e validado localmente, sem execução remota no GitHub nesta etapa. Relatórios gerados ficam em artifacts/security; logs/credenciais descartáveis do laboratório não entram no pacote de release.

## Limites de liberação

Target runtime não distribui agentes. A geração posterior da release exige regenerar e validar os instaladores assinados a partir do lockfile atual, além da homologação com backup da instalação. Não foram validados provedores externos reais de SSO/1Password nem cenários RDP/VNC/guacd. CSP em modo efetivo e redução de privilégios do perfil Compose permanecem itens próprios da revisão de segurança; esta etapa não os declara resolvidos.

## Verificações finais

- SSH completo com a imagem real: usuário autenticado via MFA, bloqueio de host de outro tenant, desafio da host key e comparação independente com ssh-keygen no servidor descartável; aprovação via API, credenciais interativas, comando shell, resize confirmado por stty (31x101), SFTP home/list e sessão encerrada no MySQL. Relatório container-stack.json aprovado.
- Teste visual `test:terminal-pty:real` repetido com OpenSSH descartável: aprovado, relatórios e capturas em /tmp/nodeaccess-0048-pty. A fixture de interface tinha encerrado e foi reiniciada; não houve correção no produto para repetir esse teste.
- Build `--target prod` sem chave pública de release: rejeitado por secret nodeaccess_release_public_key ausente, conforme esperado. Nenhuma imagem de produção sem agentes foi exportada.
- Dois testes da política de imagens cobrem versões/fontes/distribuições divergentes, novo CVE, elevação para Critical e expiração; todos aprovados.
- Guias ativos atualizados para Node 24 e Prisma direto no container. Comandos npm do perfil de desenvolvimento foram preservados.

- Scan final de código: Semgrep 732 arquivos, zero achados/erros; Gitleaks 42 fixtures públicas já revisadas, zero ocorrências novas. Resultado source-scan.json.
- Integridade do workspace original: 1.912 arquivos conferidos por SHA-256, nenhum alterado; resultado original-workspace-integrity.json.
