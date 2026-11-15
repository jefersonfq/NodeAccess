# Continuidade de flags no update e rollback

`guard_feature_flags` executa antes de backups, certificados, pull, migrations ou
recriação. Requer **Python 3.6+** no host e Docker Compose com `config --format json`.
Python usa somente a biblioteca padrão para interpretar JSON estruturado, evitando
parsers frágeis de YAML e sem instalar bibliotecas de produção ou iniciar containers.

O candidato é a configuração efetivamente interpolada pelo mesmo wrapper Compose
usado na operação. A origem são os ambientes reais de todos os containers API e
SSH gateway do projeto, inclusive parados, localizados por labels (excluindo jobs
one-off). A comparação cobre:

- `FEATURE_SESSION_AUDIT`
- `FEATURE_SESSION_AUDIT_AI_SUMMARY`
- `FEATURE_SESSION_AUDIT_AI_AUTO_SUMMARY`
- `FEATURE_LOCAL_AI`
- `FEATURE_NATIVE_SSH_GATEWAY`
- `FEATURE_MCP`

Um valor habilitado na origem não pode ficar desabilitado ou ausente no candidato.
Ausência usa o default falso do backend; grafias booleanas seguem `config/env.ts`.
Divergência entre API e gateway no **candidato** bloqueia a operação. Uma divergência
existente pode ser corrigida com candidato alinhado, preservando flags habilitadas.
Sem containers existentes, não há regressão a comparar, mas o candidato ainda deve
ser válido e consistente. Config/inspeção inválida ou indisponível nunca equivale a
primeira instalação.

Para desligar deliberadamente recursos, declarar somente seus nomes:

```bash
ALLOW_FEATURE_DISABLE=FEATURE_MCP,FEATURE_LOCAL_AI bash scripts/deploy/update-nodeaccess.sh
```

A mesma variável aplica-se ao rollback. Não aceita wildcard, `true` nem nomes
desconhecidos; a exceção não ignora divergência API/gateway nem falhas de leitura.
Remover um serviço do candidato também exige autorização para suas flags ativas.
Revise a lista em cada operação, sem persisti-la como bypass genérico no `.env`.

Configuração/inspect completos ficam apenas em temporários privados (`umask 077`),
removidos no sucesso, erro e sinais tratados. Mensagens mostram nomes conhecidos de
flags/serviços, nunca os valores ou stderr bruto do Docker. Não executar os scripts
com tracing (`bash -x`) em ambientes com segredos. O guard é um snapshot de preflight:
serializar operações de deploy para evitar alterações concorrentes após a leitura.
As flags devem constar no ambiente Compose; defaults internos de imagens não são
usados para autorizar desativações implícitas.

Simulações isoladas (não acessam Docker real):

```bash
node --test scripts/lib/feature-flags-guard.test.mjs scripts/lib/stateful-upgrade-guard.test.mjs
```
