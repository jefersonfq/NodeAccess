# SonarQube + WSL2 + Docker Desktop + Codex — NodeAccess

> Guia operacional e instruções para agente de desenvolvimento. Consolidado a partir da conversa de 03/11/2026. **Não pressupõe que a instalação já foi executada.**

## 1. Objetivo e contexto

Integrar análise estática do SonarQube ao NodeAccess (Vue/Nuxt, Node.js, TypeScript/JavaScript), executando o scanner no Ubuntu WSL2 e hospedando SonarQube + PostgreSQL no Docker Desktop. O Codex deve interpretar os achados, corrigir problemas de forma supervisionada, executar testes e reanalisar.

Prioridades: segurança (RBAC, autenticação, autorização por host, cofre/PEM/secrets, sessões SSH/Telnet/RDP, auditoria, multi-tenant), confiabilidade, manutenção e cobertura de testes. **SonarQube não substitui pentest, SCA, testes de autorização, análise de arquitetura ou revisão humana.**

### Fluxo

1. Código NodeAccess no WSL2 → scanner SonarQube.
2. Scanner → SonarQube Server local (`http://localhost:9000`).
3. SonarQube → API de issues/Quality Gate.
4. Codex lê relatório e código → propõe alterações pequenas.
5. Testes → nova análise → comparação dos achados.

## 2. Instruções mandatórias ao agente

- Comece **inspecionando** o ambiente, repositório, versões, testes, configuração Docker e recursos. Não presuma monorepo, comandos npm, paths ou compatibilidade.
- Peça aprovação antes de instalar pacotes de sistema, alterar configurações persistentes do WSL/kernel/Docker, remover volumes, atualizar dependências, abrir portas na rede, ou modificar fluxos críticos.
- Não imprima tokens, senhas, chaves ou conteúdo do `.env` em logs, diffs ou respostas. Nunca comite credenciais.
- Não altere RBAC, autorização, autenticação, criptografia, auditoria, isolamento de tenants ou acesso ao cofre sem revisão e autorização explícitas.
- Não desative regras ou exclua diretórios apenas para melhorar indicadores; documente falsos positivos.
- Crie branch de trabalho; evite mudanças não relacionadas. Não sobrescreva alterações existentes do usuário.
- Faça até cinco correções de baixo risco por lote, com testes e comparação de resultados.
- Para execução não interativa, só automatize tarefas reversíveis e de baixo risco. **Não habilite correção irrestrita.**
- Valide a documentação e a compatibilidade da versão do SonarQube escolhida antes de fixar imagens, requisitos de kernel, banco e scanner. Prefira tags versionadas em vez de `latest`/tags móveis.

## 3. Diagnóstico inicial no WSL2

```bash
uname -a
cat /etc/os-release
docker version
docker compose version
node -v
npm -v
free -h
df -h .
cat /proc/sys/vm/max_map_count
cat /proc/sys/fs/file-max
```

No Docker Desktop: verificar **Settings → Resources → WSL Integration** para a distribuição Ubuntu. Planejar memória disponível para o SonarQube e PostgreSQL, observando o uso dos demais serviços.

Em instalações que usam Elasticsearch, conferir os pré-requisitos do host, incluindo `vm.max_map_count` (frequentemente >= 524288, conforme versão). Para teste temporário, **somente após validação e aprovação**:

```bash
sudo sysctl -w vm.max_map_count=524288
```

Para persistência no WSL2, avaliar a configuração correta da distribuição/WSL em vez de assumir que o sysctl temporário sobreviverá a reinícios.

## 4. Docker Compose — SonarQube e PostgreSQL

Manter fora do repositório:

```bash
mkdir -p ~/services/sonarqube
cd ~/services/sonarqube
umask 077
printf 'SONAR_DB_PASSWORD=%s\n' "$(openssl rand -hex 32)" > .env
chmod 600 .env
```

Criar `compose.yaml`:

```yaml
services:
  db:
    image: postgres:17
    restart: unless-stopped
    environment:
      POSTGRES_USER: sonar
      POSTGRES_PASSWORD: ${SONAR_DB_PASSWORD:?required}
      POSTGRES_DB: sonar
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U sonar -d sonar"]
      interval: 10s
      timeout: 5s
      retries: 10

  sonarqube:
    image: sonarqube:community
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    ports:
      - "127.0.0.1:9000:9000"
    environment:
      SONAR_JDBC_URL: jdbc:postgresql://db:5432/sonar
      SONAR_JDBC_USERNAME: sonar
      SONAR_JDBC_PASSWORD: ${SONAR_DB_PASSWORD:?required}
    volumes:
      - sonar_data:/opt/sonarqube/data
      - sonar_extensions:/opt/sonarqube/extensions
      - sonar_logs:/opt/sonarqube/logs

volumes:
  postgres_data:
  sonar_data:
  sonar_extensions:
  sonar_logs:
```

**Atenção:** este Compose é um ponto de partida da conversa, não garantia de compatibilidade entre tags. O agente deve verificar a matriz de compatibilidade oficial e **fixar versões suportadas** antes do deploy.

```bash
docker compose config --quiet
docker compose up -d
docker compose ps
docker compose logs --tail=100 sonarqube
curl -fsS http://localhost:9000/api/system/status
```

Esperar status `UP`. Interface: `http://localhost:9000`; login inicial tipicamente `admin`/`admin`, alterar imediatamente. Não publicar a porta em `0.0.0.0` sem necessidade. **Não executar `docker compose down -v`**: remove dados persistentes.

## 5. Projeto NodeAccess e scanner

Caminho previamente citado, **confirmar se ainda existe**:

```text
/mnt/d/OneDrive/Área de Trabalho/TRABALHO/SQUAD INFRA/PROJETOS/NodeAccess
```

Inspecionar:

```bash
cd '/mnt/d/OneDrive/Área de Trabalho/TRABALHO/SQUAD INFRA/PROJETOS/NodeAccess' || exit 1
pwd
find . -maxdepth 3 -name package.json -not -path '*/node_modules/*'
find . -maxdepth 3 \( -name 'vitest.config.*' -o -name 'playwright.config.*' -o -name 'jest.config.*' \)
git status --short
```

No painel SonarQube, criar projeto local `nodeaccess`, gerar token de **análise** com permissões mínimas. Nunca inserir o token em arquivo versionado.

Criar `sonar-project.properties` na raiz adequada (ajustar conforme estrutura real):

```properties
sonar.projectKey=nodeaccess
sonar.projectName=NodeAccess
sonar.sourceEncoding=UTF-8
sonar.sources=.
sonar.exclusions=**/node_modules/**,**/.nuxt/**,**/.output/**,**/dist/**,**/coverage/**,**/.git/**
sonar.javascript.lcov.reportPaths=coverage/lcov.info
```

Se houver monorepo, configurar fontes, testes e relatórios de cobertura para cada pacote; evitar exclusões amplas. Gerar `coverage/lcov.info` com os testes reais do projeto antes da análise (SonarQube **importa**, não calcula, cobertura).

Executar scanner no WSL2, após conferir requisitos de Node e scanner:

```bash
export SONAR_HOST_URL=http://localhost:9000
read -rsp 'SonarQube token: ' SONAR_TOKEN; echo
export SONAR_TOKEN
npx @sonar/scan
unset SONAR_TOKEN
```

Avaliar scripts npm como `sonar:analyze` **após** confirmar package manager e scripts existentes. Não gravar token no histórico do shell.

## 6. Exportação de issues para o Codex

Na raiz do NodeAccess:

```bash
mkdir -p .sonar-reports
printf '\n.sonar-reports/\n' >> .git/info/exclude
```

Com `SONAR_TOKEN` definido em sessão segura:

```bash
curl -fsS -u "${SONAR_TOKEN}:" \
  --get 'http://localhost:9000/api/issues/search' \
  --data-urlencode 'componentKeys=nodeaccess' \
  --data-urlencode 'resolved=false' \
  --data-urlencode 'ps=100' \
  -o .sonar-reports/issues.json
```

**Validar endpoint e filtros na versão instalada**: a API pode mudar entre versões. Implementar paginação para mais de 100 achados, retry moderado, tratamento de erro e resumo estruturado. Não enviar código ou segredos a serviços externos sem autorização. Relatórios podem conter caminhos e trechos sensíveis.

## 7. Prompt para o Codex

> Analise `.sonar-reports/issues.json` e o código do NodeAccess. Classifique achados por risco real, severidade e impacto em segurança, confiabilidade e manutenibilidade. Confirme cada ocorrência no código; se for falso positivo, justifique sem suprimir automaticamente a regra. Priorize bugs e vulnerabilidades, mas não altere autenticação, RBAC, autorização por host, isolamento de tenants, criptografia, cofre de credenciais, sessões privilegiadas ou trilhas de auditoria sem aprovação. Preserve contratos de API. Corrija inicialmente até cinco problemas de baixo risco em uma branch dedicada, crie/ajuste testes, execute a suíte relevante e mostre diff, resultados e riscos residuais. Reexecute o scanner e compare os achados. Não faça refatorações grandes nem mudanças destrutivas sem autorização.

## 8. Roadmap de evolução

| Fase | Entrega | Critério de aceite |
|---|---|---|
| 1 | SonarQube + PostgreSQL local | Containers saudáveis, UI acessível só localmente, dados persistentes |
| 2 | Scanner no NodeAccess | Análise concluída, fontes e exclusões revisadas, Quality Gate visível |
| 3 | Relatório para Codex | API exportada com paginação, sem segredos, issues reproduzíveis |
| 4 | Correção supervisionada | Lotes pequenos, testes verdes, diff revisado, nova análise |
| 5 | CI/CD e Quality Gate | Política para novo código, bloqueio de regressões conforme edição/plataforma |
| 6 | Segurança complementar | Testes RBAC/tenant/cofre/sessões e análise de dependências |

Verificar recursos de pull request/branch e integração de CI/CD disponíveis **na edição efetivamente instalada**; não presumir que todas as funcionalidades estão incluídas na Community.

## 9. Observações de performance e operação

- O NodeAccess foi citado em caminho `/mnt/d/OneDrive/...`. A leitura de muitos arquivos via filesystem Windows montado no WSL pode ser lenta. Comparar tempo de análise com uma cópia/clone de trabalho no filesystem Linux (`~/projects/NodeAccess`), **sem mover ou apagar o original** e respeitando a estratégia de sincronização OneDrive.
- Manter volumes do SonarQube no armazenamento Linux gerenciado pelo Docker, não em pastas OneDrive.
- Criar backup e plano de atualização do banco e dos volumes antes de upgrades.
- Conferir CPU/RAM com `docker stats`, logs com `docker compose logs` e espaço em disco.
- Para exposição futura a outras máquinas, definir autenticação, TLS, rede e controle de acesso; não expor a instância local diretamente.

## 10. Diagnóstico de validação final

```bash
echo '=== SISTEMA ==='; uname -a; free -h
echo '=== DOCKER ==='; docker version --format '{{.Server.Version}}'; docker compose version
echo '=== NODE ==='; node -v; npm -v
echo '=== SONARQUBE ==='; curl -fsS http://localhost:9000/api/system/status
echo '=== PROJETO ==='
cd '/mnt/d/OneDrive/Área de Trabalho/TRABALHO/SQUAD INFRA/PROJETOS/NodeAccess' || exit 1
pwd
find . -maxdepth 2 -name package.json -not -path '*/node_modules/*'
```

### Checklist de entrega do agente

- [ ] Inventário de versões, recursos e estrutura do projeto.
- [ ] Compatibilidade das imagens SonarQube/PostgreSQL verificada e versões fixadas.
- [ ] Compose funcional e dados persistentes.
- [ ] Configuração segura, credenciais protegidas, acesso restrito a localhost.
- [ ] Projeto SonarQube e scanner configurados.
- [ ] Cobertura importada quando houver testes e LCOV.
- [ ] Relatório de issues exportado com paginação e sem vazamento de segredos.
- [ ] Comando de análise documentado e testado.
- [ ] Primeira triagem de problemas e plano de correção.
- [ ] Nenhuma mudança crítica ou destrutiva sem aprovação.

## 11. Referências oficiais para validação pelo agente

- SonarQube Server: https://docs.sonarsource.com/sonarqube-server/
- SonarScanner for NPM: https://docs.sonarsource.com/sonarqube-server/analyzing-source-code/scanners/npm/
- SonarQube Web API: acessar `/web_api` na instância instalada e verificar a documentação da versão.
- Docker Desktop WSL2: https://docs.docker.com/desktop/features/wsl/

**Estado atual:** roteiro fornecido; instalação e análise ainda precisam ser executadas e validadas no ambiente real.

## Acompanhamento da execução — NA-0085 (03/11/2026)

Frente iniciada conforme solicitação do usuário. O caminho efetivo é
`/home/jeferson/projects/NodeAccess-current`, com código isolado em
`/tmp/nodeaccess-NA-0085` para preservar outras frentes. O roteiro acima é a
referência original; o estado observado, versões fixadas, decisões e limites
ficam no [guia operacional](OPERATIONS-sonarqube.md) e no
[registro da implementação](changes/2026/11/NA-0085-sonarqube/implementation.md).
Não interpretar exemplos/tag móvel do roteiro como configuração instalada.
