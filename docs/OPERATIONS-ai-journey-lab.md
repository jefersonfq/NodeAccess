# NA-0083 — Laboratório da jornada de IA no WSL

Este laboratório amplia os testes unitários com MySQL/Redis reais, HTTP, navegador e execução do pacote de instalação em Linux descartável. Não usa `.env`, credenciais, banco, volumes ou serviços da VPS. Código da frente ainda em `/tmp/nodeaccess-NA-0083`; documentação canônica em `NodeAccess-current/docs/`.

## Pré-requisitos e execução

Usar o checkout da NA-0083 com Node24, dependências instaladas, Prisma Client gerado, pacote shared compilado e Docker acessível. Para navegador, instalar Chromium do Playwright ou informar `PLAYWRIGHT_EXECUTABLE_PATH` apontando para um executável existente. As suites são opt-in; não fazem parte do uso normal do NodeAccess.

```bash
npm run test:ai-journey:core
npm run test:ai-journey:data:real
npm run test:ai-journey:http:real
npm run test:ai-journey:browser:lab
npm run test:ai-installation:real
```

HTTP e browser compartilham harness; executar browser já inclui os cenários HTTP. Não somar seus números como testes independentes. Os três laboratórios criam recursos próprios e removem seus containers/volumes ao concluir, inclusive em falhas tratadas. Interrupção abrupta do processo ou daemon pode exigir limpeza manual dos nomes exclusivos impressos/identificados pelas labels; não executar `docker system prune`.

## O que cada laboratório verifica

| Harness | Real | Controlado/simulado |
|---|---|---|
| `tools/ai-journey/data-plane-real.mts` | MySQL8.4.11, Redis8.2.10, Prisma, repositórios, jornada e worker; CAS concorrente, cota, lease, persistência e indisponibilidade Redis | Relógio, resposta do provider e decisão de elegibilidade |
| `tools/ai-journey/http-journey-real.mts` | Sockets HTTP, JWT/guards, rotas/controller/serviços, banco, licenciamento, homologação e opt-in; browser opcional com formulário e rotas de IA reais | Provider Ollama controlado para503/JSON inválido/modelo ausente/resposta vazia/atraso; relógio; endpoints externos à tela de integração são fixtures |
| `tools/ai-journey/installation-real.mts` | Script gerado sem substituições, Bash/Python/Linux, Docker próprio, download Ollama/modelo, geração CPU, bind, volume, retomada e flock | Nenhuma resposta Ollama simulada; usa modelo minúsculo de laboratório, sem certificar qualidade de auditoria |

## Isolamento e recursos

MySQL/Redis usam nomes exclusivos `na0083-*`, portas aleatórias em127.0.0.1, credenciais sintéticas, schema vazio via Prisma db push e limites CPU/memória. Não é ensaio de upgrade/migração de banco existente. Serviços HTTP/Vite também ficam em loopback e portas temporárias.

O instalador roda em **Docker-in-Docker privilegiado**, com daemon exclusivo em socket Unix interno, sem montar diretórios/socket do host e sem publicar portas externas. O container tem limite6GiB/2CPU. Ele compartilha o kernel do WSL; não equivale a uma VM nem a uma fronteira de segurança. Executar apenas o código revisado deste laboratório. A exigência de privilégio do DinD está documentada na [imagem oficial Docker](https://hub.docker.com/_/docker).

Imagem DinD fixada por digest no harness. Ollama0.11.4 e `smollm2:135m` são fixtures de compatibilidade/baixo consumo, **não recomendação de versão ou modelo de produção**. O modelo pertence à [biblioteca oficial Ollama](https://ollama.com/library/smollm2). O primeiro teste baixa imagem/modelo: requer rede e alguns gigabytes temporários de disco. A imagem DinD baixada no daemon externo permanece como cache; volumes e modelo interno são removidos junto com o laboratório.

O script permite `AI_LAB_OLLAMA_IMAGE` e `AI_LAB_MODEL` explícitos, sujeitos à validação do gerador. Alterar esses parâmetros exige nova evidência. O relatório padrão do instalador fica em `/tmp/na0083-installation-real/report.json`; `AI_INSTALLATION_OUTPUT` permite destino alternativo. Os demais imprimem relatório e podem ter stdout/stderr redirecionados para arquivo. Logs e capturas usam somente dados sintéticos.

## Falhas reproduzidas e correções

- **Deadlock da cota:** o INSERT IGNORE tomava lock compartilhado na chave mensal; reservas concorrentes precisavam promovê-lo no SELECT FOR UPDATE. O primeiro comando agora faz upsert sem incremento, adquirindo lock exclusivo; leitura do limite e incremento permanecem na mesma transação. Verificação: cinco rodadas de20 reservas concorrentes com limite5, além de isolamento por tenant/mês e falha fechada quando banco está indisponível.
- **Falso conflito de porta após parada:** conexões recém-encerradas podiam deixar TCP TIME_WAIT e bloquear a sondagem do instalador. SO_REUSEADDR torna a sondagem compatível com retomada do servidor; não usa SO_REUSEPORT. O laboratório verifica tanto retomada imediata quanto recusa de um listener estrangeiro ativo que também usa SO_REUSEADDR.

## Limites de aceitação

Passar nestes laboratórios não homologa uma implantação do usuário. Permanecem manuais: máquina final/rede protegida, GPU/drivers, dimensionamento e qualidade do modelo para assistente/resumos reais. Login completo/MFA, políticas trial e fila completa de auditoria não são cobertos pelos novos harnesses. O browser comprova a integração administrativa; adapters de chat/resumo têm HTTP real com respostas sintéticas. O watchdog é observado com relógio controlado, não em soak prolongado nem sob falhas de cluster de produção. Provisionamento automático via SSH continua fora da implementação.

Resultados e fingerprint do candidato: [evidências da NA-0083](changes/2026/10/NA-0083-ai-journey/test-results.md). Operação do pacote: [instalação assistida](OPERATIONS-ai-installation-assisted.md).
