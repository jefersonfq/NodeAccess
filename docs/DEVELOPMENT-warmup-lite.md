# Warm-up do ambiente de desenvolvimento

O `npm run dev` inicia API, gateway e frontend e, quando as portas `3000` e `5173` ficam disponíveis, executa um warm-up finito do fluxo de Hosts.

O objetivo é absorver antecipadamente o custo da transformação fria do Vite e preparar somente as consultas de leitura usadas na abertura da tela. O processo termina depois da verificação e não mantém um serviço adicional ativo.

## Recursos aquecidos

- módulo Vite de `HostsView.vue`;
- primeira página de hosts, limitada a 12 registros;
- bootstrap da barra lateral de hosts;
- inventário usado na hierarquia.

Todos os acessos usam `GET`. Nenhum cadastro ou dado persistente é criado ou alterado.

## Uso normal

```bash
npm run dev
```

Uma execução bem-sucedida mostra um resumo semelhante a:

```text
[dev-warmup] {"status":"passed","results":[...],"attempts":1}
```

O status do warm-up não representa o healthcheck completo da aplicação. Ele informa apenas se os quatro recursos de Hosts responderam durante aquela execução.

## Execução manual e modo estrito

Com os serviços ativos:

```bash
npm run dev:warmup
```

Por padrão, a falha é `best-effort`: o resultado é exibido, mas API, gateway e Vite continuam ativos. Para diagnóstico ou automação, use modo estrito:

```bash
DEV_WARMUP_STRICT=1 npm run dev:warmup
```

No modo estrito, qualquer recurso reprovado resulta em código de saída diferente de zero.

## Configuração local

| Variável | Padrão | Uso |
|---|---|---|
| `FRONTEND_BASE` | `http://127.0.0.1:5173` | Origem local do Vite |
| `API_BASE` | `http://127.0.0.1:3000/api/v1` | Base local da API |
| `BACKEND_ENV_PATH` | `apps/backend/.env` | Arquivo que fornece o `JWT_SECRET` local |
| `JWT_SECRET` | valor de `BACKEND_ENV_PATH` | Secret do processo; quando informado, tem precedência sobre o arquivo |
| `ADMIN_USER_ID` | `1` | Usuário administrativo existente usado nas leituras |
| `ADMIN_EMAIL` | `admin@nodeaccess.local` | E-mail incluído no token temporário |
| `TENANT_ID` | `1` | Tenant local usado nas leituras |
| `DEV_WARMUP_TIMEOUT_MS` | `5000` | Timeout dos endpoints; a transformação Vite usa 30 s |
| `DEV_WARMUP_STRICT` | desativado | Retorna erro quando o warm-up falha |

`FRONTEND_BASE` e `API_BASE` aceitam somente os hostnames exatos `localhost` e `127.0.0.1`. Essa restrição impede o envio acidental do token temporário para uma origem remota.

O token é assinado em memória, expira em cinco minutos e não deve aparecer no resumo. Nunca aponte o warm-up para produção e nunca versione o arquivo `.env`.

## Como interpretar lentidão inicial

- `vite:hosts-view` lento e APIs rápidas: transformação fria do frontend; é o comportamento que este warm-up reduz para a primeira navegação.
- APIs lentas e Vite rápido: investigar backend, banco, Redis ou volume de dados; o warm-up não corrige a causa.
- `request-error`: confirmar se as portas `3000` e `5173` pertencem aos processos iniciados e se não há conflito local.
- `timeout`: revisar a duração indicada e executar novamente em modo estrito para obter um resultado reproduzível.
- `HTTP 401`: conferir a precedência e o valor de `JWT_SECRET`; `HTTP 403`: revisar a regra aplicada pelo endpoint e o contexto de `TENANT_ID` usado pelo token temporário.

O warm-up prepara a transformação do Vite e os endpoints, mas não popula o cache JavaScript em memória de um navegador que ainda não foi aberto.

## Build em diretório sincronizado

Em diretórios monitorados pelo OneDrive, o Vite pode transformar todos os módulos e falhar ao copiar arquivos para `dist` com `EPERM`. Isso deve ser distinguido de falha de compilação.

No Linux ou WSL, valide a geração usando uma saída temporária fora do diretório sincronizado:

```bash
cd apps/frontend
npx vite build --outDir /tmp/nodeaccess-frontend-dist
```

Se essa execução passar, trate o `EPERM` original como limitação de filesystem/OneDrive. O build oficial e o CI devem continuar usando um workspace não sincronizado.

## Validação rápida

```bash
npm run test:dev-warmup
npm run typecheck
```

Ao alterar o warm-up, valide também um restart completo de `npm run dev`, o modo estrito, a ausência do token na saída e a permanência dos três servidores depois que o processo finito termina.
