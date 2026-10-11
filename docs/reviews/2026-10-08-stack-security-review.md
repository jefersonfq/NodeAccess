# Segurança das dependências e da implantação do NodeAccess

Revisão de 8 de outubro de 2026. Há atualizações de segurança necessárias no runtime, nas dependências e nas imagens implantadas. A prioridade é atualizar o WebSocket efetivamente distribuído, migrar componentes fora de suporte e reconstruir as imagens com bases corrigidas, preservando os testes dos fluxos críticos.

As [treze pendências da revisão de engenharia](2026-10-08-engineering-followup.md) continuam abertas. Este registro acrescenta inventário, resultados de scanners, triagem inicial e proposta de ferramentas gratuitas. Não houve atualização de dependências, alteração de configuração ou reinício de serviços na VPS.

## Escopo e evidências

- `npm audit` 11.12.1 sobre o `package-lock.json` atual, com todas as dependências e com `--omit=dev`, usando `--package-lock-only --ignore-scripts`. Não foi executado `npm audit fix`.
- Consultas SSH somente de leitura para versões e identificadores das imagens em execução. API e gateway utilizam a mesma imagem backend 2.0.3.
- Grype 0.120.1 sobre cinco imagens locais cujos identificadores SHA256 coincidem com os das imagens da VPS. Scanner executado pelo digest `sha256:e4a44ef45d285b829ce6efe2642980329661bd2d18eab5fc539138d4adaebbbe`, com limite de CPU/memória. Banco Grype válido, construído em `2026-10-08T06:33:47Z`.
- Conferência de alertas prioritários nas fontes dos mantenedores. Presença de pacote em faixa afetada não comprova exploração no NodeAccess. Volumes e alterações na camada gravável dos containers remotos não fazem parte da varredura das imagens locais.

Evidências: [inventário da VPS](evidence/2026-10-08-security/runtime-inventory.json), [pacotes npm](evidence/2026-10-08-security/npm-findings.md), [JSON npm completo](evidence/2026-10-08-security/npm-audit-all.json), [JSON npm sem dev](evidence/2026-10-08-security/npm-audit-prod.json) e [resultados das imagens](evidence/2026-10-08-security/image-findings.md). O [metadado npm](evidence/2026-10-08-security/npm-findings.json) registra hash do lockfile, comando e instante de coleta.

## Resultados automatizados

| Escopo npm | Pacotes sinalizados | Critical | High | Moderate |
| --- | ---: | ---: | ---: | ---: |
| Lockfile completo | 47 | 7 | 32 | 8 |
| Lockfile sem dependências dev | 23 | 3 | 17 | 3 |

Esses números são pacotes sinalizados pelo npm, incluindo propagação por dependências transitivas, e não CVEs únicos. O recorte sem dev ainda inclui dependências do frontend e caminhos condicionais; não equivale à árvore exata carregada pelo backend de produção. Ambos os comandos retornaram código 1 com relatório válido por haver achados.

| Imagem implantada e examinada | Ocorrências Grype | Critical | High | Medium | Low | Unknown |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Backend 2.0.3 | 193 | 6 | 105 | 61 | 21 | 0 |
| Frontend 2.0.3 | 199 | 26 | 95 | 59 | 13 | 6 |
| guacd 1.5.5 | 167 | 11 | 55 | 91 | 10 | 0 |
| mysql 8.0 | 94 | 0 | 27 | 60 | 7 | 0 |
| redis 7 alpine | 52 | 6 | 19 | 15 | 12 | 0 |

Ocorrências Grype são associações entre pacote e advisory, com duplicatas possíveis por biblioteca, caminho e imagem. Não somar esta tabela aos números npm nem interpretá-la como quantidade de ataques possíveis. O Grype terminou com código 0 porque a coleta não utilizou `--fail-on`; os relatórios contêm vulnerabilidades. As evidências compactas preservam versão, caminho, identificador, fonte, correções indicadas e hash do relatório original.

## Versões encontradas

| Componente | Projeto ou imagem | Versão confirmada na VPS | Ação |
| --- | --- | --- | --- |
| Node.js | Dockerfiles `node:20-alpine` | 20.20.2 | Migrar para LTS suportado e corrigido, preferencialmente linha 24 após compatibilidade |
| Fastify | Lockfile 4.29.1 | 4.29.1 | Migrar para linha 5 suportada com plugins compatíveis |
| ws | Lockfile 8.21.0 | 8.20.0 | Rebuild e deploy de artefato com versão corrigida |
| fast-jwt | Lockfile 4.0.5 | 4.0.5 | Atualizar junto de `@fastify/jwt`, com regressão de autenticação |
| proxy-addr | Lockfile 2.0.7 | 2.0.7 | Atualizar dependência transitiva e conferir confiança no proxy |
| busboy Fastify | Lockfile 3.2.0 | 3.2.0 | Atualizar árvore de multipart para versão corrigida |
| Nodemailer | Lockfile 8.0.6 | 8.0.6 | Atualizar com teste de envio SMTP e configurações por tenant |
| Prisma e client | Lockfile 5.22.0 | CLI Prisma 5.22.0 | Manter no plano de compatibilidade Node e MySQL; ausência no npm audit não é certificação |
| ioredis | Lockfile 5.10.1 | 5.10.1 | Corrigir timeout conforme revisão de engenharia |
| ssh2 | Lockfile 1.17.0 | 1.17.0 | Nenhum alerta npm direto nesta coleta; preservar testes SSH nas migrações |
| Vue | Lockfile 3.5.31 | Bundle não foi atribuído a uma versão por inspeção remota | Atualizar árvore Vue e revisar alerta de SSR |
| Naive UI | Lockfile 2.44.1 | Bundle não inventariado | Revalidar compatibilidade e transitivas |
| Axios | Lockfile 1.14.0 | Bundle não inventariado | Atualizar e separar alertas de adapter Node dos caminhos de navegador |
| Vite e Vitest | 5.4.21 e 1.6.1 | Ferramentas do workspace | Atualizar cadeia de desenvolvimento e CI |
| MySQL | `mysql:8.0` | 8.0.46 | Planejar migração para 8.4 LTS com backup e restore |
| Redis | `redis:7-alpine` | 7.4.10 | Revisar advisories e ACL; atualizar imagem/base |
| guacd | `guacamole/guacd:1.5.5` | Tag e identificador confirmados | Atualizar para pelo menos 1.6.0 corrigido e conferir bibliotecas da imagem |
| Nginx do frontend | `nginx:alpine` | 1.31.1 | Rebuild com versão/base corrigidas e triagem dos módulos habilitados |
| Nginx do host | Pacote Rocky | 1.24.0 com release RPM específico | Validar erratas e backports do RPM, não apenas a versão upstream |
| Sistema do host | Rocky Linux | 8.10 | Verificar erratas aplicáveis e kernel efetivamente em execução |

Tags como `mysql:8.0`, `redis:7-alpine` e `nginx:alpine` não fixam o conteúdo. Os hashes do inventário identificam o que foi examinado. A próxima entrega deve registrar digest e SBOM de cada imagem e conferir sua implantação real.

## Prioridades e aplicabilidade dos alertas

### Atualizar o WebSocket que está em produção

O backend da VPS contém `ws 8.20.0`, apesar de o lockfile atual conter 8.21.0. A versão implantada está na faixa da **CVE-2026-48779**, esgotamento de memória por fragmentação de mensagens, corrigida em 8.21.0. É prioridade alta pelo papel do WebSocket no gateway. Limite de payload isolado não substitui a atualização. [Advisory do mantenedor](https://github.com/websockets/ws/security/advisories/GHSA-96hv-2xvq-fx4p).

Também está na faixa da **CVE-2026-45736**, corrigida em 8.20.1, cuja exploração depende de uso de `TypedArray` como motivo em `close()`. Não foi demonstrado esse caminho no NodeAccess. [Advisory do mantenedor](https://github.com/websockets/ws/security/advisories/GHSA-58qx-3vcg-4xpx).

Aceitação: nova imagem contém versão corrigida, scan repetido e testes de terminal, agentes, compartilhamento e PTY real passam; confirmar o hash em execução após a implantação.

### Migrar Node.js e Fastify para linhas suportadas

Node.js 20 está EOL na data desta revisão. O Grype também sinaliza CVEs no runtime 20.20.2; a aplicabilidade depende da função utilizada, como HTTP/2 ou permission model. O destino deve ser uma revisão atual e corrigida da linha LTS escolhida, sem assumir que qualquer Node 24 resolve todos os alertas. [Ciclo oficial Node.js](https://nodejs.org/en/about/previous-releases), [correções de segurança de junho de 2026](https://nodejs.org/en/blog/vulnerability/june-2026-security-releases).

Fastify 4 encerrou LTS em 30 de junho de 2025. A versão 4.29.1 está nas faixas de vários advisories atuais. Por exemplo, **GHSA-p68q-wchp-6fh7** trata de bypass em handlers de rota não encontrada; depende de fallback privado que devolva dados protegidos, cenário não comprovado nesta revisão. Não concluir que todos os endpoints permitem bypass. [Política LTS](https://fastify.dev/docs/latest/Reference/LTS/), [advisory](https://github.com/fastify/fastify/security/advisories/GHSA-p68q-wchp-6fh7).

Atualizar Fastify e seus plugins como conjunto compatível. Aceitação: autenticação, JWT/refresh/MFA, permissões, multipart, Swagger, rate limit, WebSocket, proxy e shutdown validados. Não aplicar atualização major automática sem esses testes.

### Atualizar multipart e triar os alertas de autenticação

`@fastify/busboy 3.2.0` está abrangido pela **CVE-2026-19484**, DoS por boundary multipart, e por outros advisories. A correção desse advisory está em 3.2.1; a árvore deve incluir também as correções posteriores, como 3.2.2 para o alerta de CRLF. Confirmar limites de upload e erros controlados. [Advisory de multipart](https://github.com/advisories/GHSA-xjh9-v7x6-24jw).

Os três pacotes Critical no recorte npm sem dev são `fast-jwt`, `proxy-addr` e `tar`. Precisam de atualização, mas sua prioridade de exploração depende do uso:

- **fast-jwt 4.0.5**: a **CVE-2026-44351** requer resolver assíncrono que devolva chave HMAC vazia. O plugin examinado usa `env.JWT_SECRET` como string, validada com mínimo de 32 caracteres. Essa condição específica não aparece no fluxo inspecionado. Outros advisories de algoritmo, cache e headers permanecem para triagem. [Advisory](https://github.com/advisories/GHSA-gmvf-9v4p-v8jc).
- **proxy-addr 2.0.7**: a **CVE-2026-90711** depende de uma sub-rede de confiança IPv6 mapeada configurada com prefixo inadequado. O código atual passa um booleano em `trustProxy`; não foi comprovada essa configuração vulnerável. Atualizar para versão corrigida e manter a revisão independente da confiança no proxy. [Advisory](https://github.com/advisories/GHSA-jqcg-44mw-7w3h).
- **tar 6.2.1**: sinalizado por vários advisories de extração, caminhos e consumo de recursos. Está presente na imagem, inclusive em cadeias de instalação. Determinar quais consumidores realmente processam arquivos não confiáveis; atualizar o pacote pai ou remover ferramentas desnecessárias do runtime. [Relatório de pacotes e referências](evidence/2026-10-08-security/npm-findings.json).

### Atualizar guacd e suas bibliotecas

A imagem implantada `guacamole/guacd:1.5.5` está na faixa da **CVE-2024-35164**, corrigida no Guacamole 1.6.0. O problema afeta o terminal de protocolos textuais do guacd. O adaptador gráfico do NodeAccess examinado admite RDP/VNC e o SSH principal usa ssh2; isso reduz a aplicabilidade direta desse caminho, mas não justifica manter a imagem antiga. O scan também encontrou bibliotecas antigas com alertas em OpenSSL, GLib, Expat e Ghostscript. [Relatório oficial Apache](https://guacamole.apache.org/security/).

Aceitação: imagem corrigida, scanner repetido, conectividade privada preservada e testes RDP/VNC/SFTP relevantes ao produto. Atualizar a imagem base junto do aplicativo, e não apenas trocar a tag em documentação.

### Migrar MySQL 8.0 com plano de recuperação

MySQL 8.0.46 é a última revisão da linha 8.0, que atingiu EOL em abril de 2026. Planejar migração para 8.4 LTS com revisão de autenticação, compatibilidade Prisma, migrations e consultas. Não trocar a versão major sobre o volume de produção sem ensaio de atualização e recuperação. [Release notes oficiais](https://dev.mysql.com/doc/relnotes/mysql/8.0/en/).

Os 94 registros do scanner da imagem também incluem bibliotecas do sistema; não são 94 falhas comprovadas no servidor MySQL. A aceitação exige backup restaurado, atualização ensaiada e integridade funcional verificada.

### Atualizar bases das imagens e verificar Nginx

As cinco imagens contêm ocorrências de vulnerabilidade. Frontend e guacd trazem bibliotecas mais antigas; reconstruir com bases corrigidas, reduzir pacotes desnecessários e repetir a varredura. Versão de correção indicada em uma linha do scanner resolve aquele advisory, não necessariamente todos os advisories daquele pacote.

Nginx 1.31.1 está em faixas de alertas publicados, incluindo **CVE-2026-42530** e **CVE-2026-90439**, dependentes de HTTP/3. O modelo Nginx examinado não habilita QUIC; conferir a configuração efetiva antes de atribuir exposição. Outros alertas envolvem módulos e diretivas específicos. O Nginx 1.24.0 do host é um RPM Rocky com release próprio: comparar erratas/backports antes de marcar a versão upstream como vulnerável. [Advisories oficiais Nginx](https://nginx.org/en/security_advisories.html).

Exemplo de divergência que exige triagem: o Grype classifica **CVE-2026-63073** em bibliotecas OpenSSL da imagem como Critical; o fornecedor classifica como Low e descreve um cliente CMP com condições específicas. Não há demonstração desse caminho no NodeAccess. Preservar o achado bruto e documentar a análise, sem converter a contagem do scanner em diagnóstico de comprometimento. [Advisory OpenSSL](https://openssl-library.org/news/secadv/20260825.txt).

### Restringir Redis conforme as funções utilizadas

Redis 7.4.10 foi confirmado. Além da imagem/base, há advisories oficiais cuja página ainda informa correção pendente: **GHSA-c8h9-259x-jff4** envolve RESTORE autenticado; **GHSA-93m2-935m-8rj3** envolve clientes bloqueados; **GHSA-8ghh-qpmp-7826** depende de réplica gravável e Lua. O scanner de imagem não cobre necessariamente todos esses avisos, demonstrando a necessidade de conferir o fornecedor.

Revisar rede, autenticação e ACL por serviço, removendo permissões desnecessárias como RESTORE quando não utilizadas. Não retirar Lua indiscriminadamente, pois clientes e controles podem depender dela. Conferir a topologia e correções publicadas antes de escolher a atualização. [RESTORE](https://github.com/redis/redis/security/advisories/GHSA-c8h9-259x-jff4), [clientes bloqueados](https://github.com/redis/redis/security/advisories/GHSA-93m2-935m-8rj3), [réplica e Lua](https://github.com/redis/redis/security/advisories/GHSA-8ghh-qpmp-7826).

### Atualizar frontend e ferramentas de desenvolvimento

Atualizar Axios, Vue e dependências transitivas com testes de navegador. Alertas relativos ao adapter HTTP Node do Axios não se transferem automaticamente ao uso no navegador. O alerta em `@vue/server-renderer` depende de SSR, não identificado no frontend SPA examinado. Esses caminhos precisam de classificação de aplicabilidade, além da atualização.

Vitest 1.6.1 está na faixa da **CVE-2026-47429**, relacionada ao servidor UI acessível. Não confundir a execução de testes em lote com esse servidor exposto. Atualizar Vitest, Vite e plugins juntos; manter serviços de desenvolvimento restritos ao ambiente necessário. [Advisory Vitest](https://github.com/advisories/GHSA-5xrq-8626-4rwp).

## Ferramentas gratuitas para validação contínua

O próprio **SonarQube Community Build** é uma opção gratuita e open source para qualidade e segurança do código. Exige operação de um servidor e tem recursos diferentes das edições comerciais; não substitui varredura de imagens, dependências e testes dinâmicos. [Produto oficial](https://www.sonarsource.com/open-source-editions/sonarqube-community-edition/).

| Camada | Opção | Uso no NodeAccess |
| --- | --- | --- |
| Código e padrões inseguros | [Semgrep Community Edition](https://semgrep.dev/products/community-edition/) | Análise local de JS/TS e regras para segurança; bom ponto de partida sem servidor próprio |
| Qualidade e acompanhamento | [SonarQube Community Build](https://www.sonarsource.com/open-source-editions/sonarqube-community-edition/) | Painel de qualidade, dívida e análise estática, caso a equipe queira mantê-lo |
| Dependências npm | npm audit e [OSV Scanner](https://github.com/google/osv-scanner) | Auditar lockfile em PRs e periodicamente, com triagem por pacote e caminho |
| Imagens e pacotes do sistema | [Grype](https://github.com/anchore/grype) | Já utilizado nesta revisão; executar na imagem final por digest |
| Configuração e inventário | [Trivy](https://trivy.dev/docs/latest/guide/) | Alternativa/complemento para imagens, IaC e SBOM; selecionar versão verificada e fixada |
| Segredos | [Gitleaks CLI](https://github.com/gitleaks/gitleaks) | Inspecionar alterações e histórico; redigir valores em relatórios. O CLI é MIT; conferir termos de wrappers/actions separadamente |
| Aplicação em execução | [ZAP](https://www.zaproxy.org/) | Testes dinâmicos em homologação com contas e dados descartáveis; escopo autenticado configurado |

Proposta inicial: **Semgrep CE + npm audit + Grype + Gitleaks CLI**, com ZAP em homologação. Acrescentar SonarQube Community Build se o painel central de qualidade trouxer benefício à equipe. Não é necessário operar todas as ferramentas de uma vez. Gratuidade de licença não elimina o custo do runner, armazenamento e triagem.

## Critérios propostos para a entrega

1. Associar scan, SBOM, commit, versão da base de vulnerabilidades e digest à mesma imagem que será implantada.
2. Bloquear novos achados altos/críticos aplicáveis, segredos confirmados e linhas EOL sem exceção aprovada com responsável, mitigação e validade. Fazer triagem inicial do passivo existente, sem ignorá-lo em bloco.
3. Falha de ferramenta, banco desatualizado ou relatório ausente deve aparecer como validação incompleta, nunca como zero vulnerabilidades.
4. Fixar versões/digests dos scanners e regras; verificar sua procedência e manter atualizações controladas.
5. Executar análise em PRs e reavaliar releases periodicamente, porque novos CVEs surgem sem mudança no código.
6. Validar compatibilidade em homologação e repetir o scan depois das atualizações. Para mudanças de transporte, executar os testes de terminal e PTY real exigidos pelo projeto.
7. Confirmar a imagem em execução após deploy; o caso de `ws` mostra que corrigir apenas o lockfile não conclui a remediação.

## Limites e próximos passos

Foram executadas análise de dependências, varredura das cinco imagens e triagem manual dos alertas prioritários. SAST completo, DAST autenticado, scan de segredos, SBOM completo e conferência de erratas de todos os RPMs do host permanecem pendentes. A detecção não garante ausência de falhas de lógica, isolamento de tenant ou vulnerabilidades ainda desconhecidas.

Sequência proposta: corrigir os achados próprios de SSRF/cache e controles de infraestrutura; atualizar ws e árvore de runtime; migrar Node/Fastify com regressão; reconstruir frontend/guacd/Redis; ensaiar migração MySQL; ativar os gates contínuos. Os passos podem ser separados em mudanças pequenas e reversíveis. Este documento registra pendências e critérios; nenhuma atualização foi aplicada nesta etapa.
