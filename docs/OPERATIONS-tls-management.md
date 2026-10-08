# HTTPS e certificados — gestão opcional (25/09/2026)

## Escopo

Tela `/admin/tls`, no menu Plataforma, restrita ao administrador da plataforma fora do modo delegado. Instalação única Docker Compose: certificado próprio (cadeia e chave PEM), Let’s Encrypt automático via HTTP-01/webroot e observação de TLS em proxy externo. DNS-01, wildcard automático e coordenação entre réplicas/HA não estão implementados neste corte.

O domínio é fixado pelo instalador em `TLS_DOMAIN`; a API não aceita destinos, caminhos ou comandos arbitrários. O backend autoriza/audita solicitações e usa um socket Unix. Um serviço independente `tls-agent` executa Certbot, valida certificados, agenda verificações a cada 12 horas e mantém histórico durável/eventos de conclusão. API indisponível não interrompe o agendamento.

O serviço compartilha somente as namespaces PID/rede do frontend e os volumes necessários. Não usa socket Docker, acesso ao host ou ao gateway SSH. `nginx -t` roda com a mesma configuração; SIGHUP recarrega o master existente. O certificado servido é comparado ao aplicado. O volume de controle montado na API não contém chaves.

O tmpfs usa `/run` diretamente, com o volume de controle em `/run/nodeaccess-tls`. Evite trocar por `/var/run`: esse caminho é um link na imagem e pode sobrepor o socket conforme a ordem de montagem.

## Preparação e ativação

### Desenvolvimento local

`npm run dev` inicia API, gateway e Vite, sem Nginx gerenciado ou agente TLS. Sem `TLS_CONTROL_SOCKET`, a API retorna `TLS_NOT_CONFIGURED`; a tela apresenta **Gestão HTTPS não configurada**, sem tratar esse estado como falha de comunicação. Isso não diagnostica o certificado de outro ambiente.

Para validar o recurso localmente, use `npm run test:tls:web` com um frontend de desenvolvimento disponível em `FRONTEND_BASE` (simulação de interface), ou siga o ensaio `npm run test:tls:integration` abaixo (agente, Nginx e ACME reais em containers descartáveis). Esses testes não habilitam permanentemente a gestão na API local. Não aponte o desenvolvimento para o socket ou certificados de produção. Uma instalação persistente com gestão real precisa da topologia Docker Compose descrita a seguir; definir apenas a variável do socket não instala o agente.

### Instalação Docker Compose

Requer frontend/backend da mesma entrega e a imagem `nodeaccess-tls-agent:<versão>`, incluída pelo build de release. O piloto não é ativado por padrão. Preparar a instalação existente em janela de manutenção: a entrada inicial exige recriar frontend/API para adicionar montagens; renovações posteriores usam reload.

1. Faça backup da configuração e dos certificados existentes.
2. No diretório da instalação, execute:

```bash
TLS_DOMAIN=nodeaccess.com.br \
TLS_AGENT_IMAGE=nodeaccess-tls-agent:<versão> \
bash scripts/deploy/prepare-tls-management.sh
```

O preparo gera `docker/nginx.tls-managed.conf`, incluindo uma exceção HTTP para o desafio ACME, e preserva o certificado atual em `certs/managed/versions/bootstrap`. Na ausência de certificado, cria um autoassinado de sete dias para bootstrap; a confiança deve ser tratada pelo operador. Não reinicia containers.

3. Configure no `.env` usado pela instalação:

```dotenv
TLS_MANAGEMENT_ENABLED=true
TLS_DOMAIN=nodeaccess.com.br
TLS_AGENT_IMAGE=nodeaccess-tls-agent:<versão>
TLS_EXTERNAL=false
```

4. Execute o instalador/atualizador habitual. Eles incluem `docker-compose.tls.yml` quando habilitado e recriam o agente após o frontend. Em operação direta use sempre a mesma composição/projeto:

```bash
docker compose -p nodeaccess-v2 -f docker-compose.prod.yml -f docker-compose.tls.yml --env-file .env up -d frontend api
docker compose -p nodeaccess-v2 -f docker-compose.prod.yml -f docker-compose.tls.yml --env-file .env up -d --force-recreate --no-deps tls-agent
```

O agente compartilha namespaces do frontend: se recriar o frontend manualmente, recrie também o agente. Não configure o overlay em HA/Kubernetes; nesses ambientes mantenha a gestão no Ingress/proxy próprio.

5. Abra Plataforma → HTTPS e certificados. Use **Verificar HTTPS**; para automático informe e-mail, aceite os termos e confirme a emissão. A porta pública 80 deve permanecer acessível ao desafio. Mudar a opção visual não muda o certificado até confirmar a operação correspondente.

Para proxy externo, prepare com `TLS_EXTERNAL=true` e use `TLS_MODE=off` na rede interna com `APP_URL=https://...`. O modo externo é uma propriedade da topologia: a tela apenas observa o HTTPS público. Não troca automaticamente listeners ou balanceadores.

## Certificado próprio

Enviar `fullchain.pem` até 100 KB e `privkey.pem` até 30 KB, sem senha. Domínio SAN, datas (mínimo de um dia restante), correspondência chave/certificado, algoritmo e cadeia de confiança são verificados antes da prévia. Confirmar a prévia aplica a troca e desativa a renovação automática anterior. Prévia expira em 15 minutos; envios descartados são removidos. Preservam-se a versão ativa e a anterior para recuperação.

A cadeia deve ser confiável no agente. Para PKI corporativa, o operador pode montar um bundle de CAs somente leitura e definir `TLS_TRUST_FILE` (OpenSSL) e `NODE_EXTRA_CA_CERTS` (verificação TLS). Essas opções são de instalação, nunca arquivos de confiança enviados pela API.

Chaves não são retornadas em consultas ou auditoria, nem armazenadas no banco. Certbot/Nginx exigem arquivos privados operacionais no volume TLS: diretórios privados e arquivos `0600`; proteger e cifrar o armazenamento/backups no host conforme a política da organização.

## Aplicação, falhas e eventos

- Uma operação por vez; solicitações concorrentes retornam conflito. Um bloqueio de sistema (`flock`) impede dois agentes sobre o mesmo volume de estado, inclusive durante recuperação.
- A versão do certificado lida na tela é conferida antes de alterar; prévias antigas são recusadas.
- A troca do par usa diretórios versionados e substituição atômica do link `managed/current`.
- Antes da troca, um registro persistente guarda o destino anterior. Após `nginx -t`, reload e verificação do fingerprint, a operação termina.
- Falha restaura a versão anterior; falha de recuperação bloqueia novas alterações e orienta acesso ao servidor. Reinício com operação pendente tenta recuperar a versão anterior.
- Queda de comunicação da tela não cancela o trabalho. Atualizar estado consulta o resultado sem repetir automaticamente a mutação.
- Operações geram `TLS_OPERATION_REQUESTED` na auditoria administrativa, com `requestId`. Conclusões e mudanças de alerta ficam numa fila durável do agente e são sincronizadas com `tls_audit_events`; a tela mostra a auditoria centralizada. Eventos de sistema preservam `actor=scheduler`, sem atribuir uma ação automática a um administrador.
- **Verificar HTTPS** não chama Certbot. **Simular renovação ACME** valida o desafio sem substituir o certificado. **Verificar renovação** deixa o Certbot decidir se há necessidade de renovar. Falhas transitórias usam espera progressiva de 5 minutos até 6 horas; falhas de configuração usam 12 horas. Limites da CA respeitam o prazo de nova tentativa quando informado pelo Certbot.

## Migrar a renovação anterior

O agente usa armazenamento ACME próprio, isolado do Certbot já existente no host. Não manter dois agendadores responsáveis pelo mesmo domínio. Após validar o novo fluxo, desabilite especificamente a renovação antiga deste domínio segundo o procedimento do host; não desligue um timer que também renova outros sites. Os arquivos originais em `certs/` e `/etc/letsencrypt/` não são apagados pelo preparo.

## Recuperação pelo servidor

Se a interface ficar inacessível, consulte o estado e os logs do agente. Corrija a causa da falha antes de reiniciar o serviço. Para retorno ao modelo anterior, use os certificados originais/backups, a configuração `docker/nginx.https.conf` e remova o overlay da composição, mantendo `TLS_MANAGEMENT_ENABLED=false`; isso requer recriação controlada do frontend/API. Não executar `down` na pilha inteira.

## Validação

- `npm run test:tls`: testes do serviço, preparação da instalação, transporte Unix e autorização de API.
- `npm run test:tls:web`: fluxos de administrador com Playwright, usando `FRONTEND_BASE` para frontend local; repita com `UI_THEME=light`.
- `npm run test:tls:integration`: ensaio opt-in isolado com Docker, Nginx/TLS reais, Certbot, ACME Pebble com desafio HTTP-01 real, WebSocket e SSH/PTY descartável. Requer a imagem `nodeaccess-tls-agent:test`; nenhuma produção é acessada. O teste cria e remove somente seus containers e arquivos temporários.
- `npm run test:terminal-experience:web`: regressão do terminal.

As simulações de navegador usam respostas controladas; o ensaio de integração distingue isso da troca real de certificados. A emissão pública de produção só deve ocorrer após implantação e configuração do domínio pelo operador.

Preparar a imagem do ensaio a partir do mesmo target usado na release:

```bash
docker build --target tls-agent -f docker/frontend.Dockerfile -t nodeaccess-tls-agent:test .
npm run test:tls:integration
```

O ensaio requer Docker, OpenSSL, `script` (util-linux), dependências npm instaladas e acesso à imagem `ghcr.io/letsencrypt/pebble:latest`. A CA de teste é confiada somente nos containers temporários, sem alterar a confiança do host ou da aplicação instalada. `TLS_TEST_IMAGE` permite usar uma imagem de release já construída.

Evidências da entrega inicial de 25/09/2026: 27 testes de serviço/API/preparo aprovados; Playwright em desktop/mobile, temas claro/escuro, com confirmação, falhas, datas em português e terminal preservado; regressão de experiência do terminal aprovada. Integração real com a imagem gerada aprovou três inicializações consecutivas, troca do certificado, emissão/renovação ACME contra Pebble, desafio bloqueado e recuperação, erro de configuração Nginx, reinício do agente e recusa de segundo agente. Uma única conexão SSH e um único WebSocket permaneceram ativos ao longo das trocas e falhas.


## Evolução: alertas, diagnóstico, persistência e auditoria

Atualize frontend, API e agente juntos. A migração `20260926000100_tls_audit_events` cria apenas a tabela de eventos TLS e é aplicada pelo fluxo habitual de migrations da instalação. Ela foi testada em MySQL descartável; não foi aplicada automaticamente ao ambiente de produção.

### Experiência do administrador

- O indicador **HTTPS !**, no rodapé do menu lateral, avisa administradores da plataforma sobre vencimento, falha de renovação, recuperação necessária e indisponibilidade do agente. Ele abre `/admin/tls`; não ocupa área do terminal e não aparece para usuários comuns ou em modo delegado.
- Alertas são internos à aplicação. Não há envio de e-mail ou SMS nesta entrega. Para indisponibilidade da própria API/aplicação, mantenha o monitoramento externo da infraestrutura.
- A API consulta o agente a cada minuto, independentemente de a tela estar aberta. O agente consulta o HTTPS a cada hora, inclusive nos modos certificado próprio e proxy externo; o vencimento é recalculado nas consultas de estado. A renovação permanece independente da API.
- O navegador pausa consultas quando está oculto e retoma ao voltar. A identificação de uma operação pendente é guardada na sessão do navegador por usuário; certificado e chave nunca são guardados nesse armazenamento.
- Após perda de resposta, a tela consulta a operação pelo identificador. Não repete automaticamente o upload ou a emissão. Se não encontrar a solicitação, informa isso e permite uma nova ação explícita.
- Etapas mostram resolução DNS, desafio HTTP-01 local, ACME, cadeia, Nginx, recarga e certificado servido. O diagnóstico local **não comprova** acessibilidade pela internet: a CA faz essa validação.
- A simulação com a CA padrão usa o ambiente de teste do Certbot. Um `TLS_ACME_DIRECTORY` customizado segue o comportamento dessa CA; no ensaio usamos exclusivamente Pebble isolado.

### Persistência e concorrência

Arquivos de estado, certificado e chave usam escrita temporária, `fsync`, troca atômica e sincronização do diretório. O registro de recuperação precede a troca do certificado. A confirmação pública e os eventos só ficam disponíveis após a persistência terminar. Isso reduz janelas de perda por interrupção; não substitui armazenamento confiável e backups.

Cada solicitação da API exige UUID `requestId`. Mesmo identificador com conteúdo e administrador iguais recupera o resultado; conteúdo ou administrador diferentes retornam conflito. Os registros são retidos por pelo menos sete dias, com até mil solicitações manuais retidas. Esse limite não bloqueia o agendamento de renovação. Resultados podem ser consultados em `GET /api/v1/platform/tls/operations/:requestId`, sempre com autorização de administrador da plataforma e correspondência do solicitante.

O agente mantém os eventos enquanto a API/banco estiverem indisponíveis. A API persiste por chave única de evento antes de confirmar o recebimento; confirmação perdida ou coletores simultâneos não duplicam linhas. Não há descarte silencioso dos eventos pendentes. Monitore o espaço dos volumes durante indisponibilidades prolongadas. A auditoria está em `GET /api/v1/platform/tls/audit`; alertas globais em `GET /api/v1/platform/tls/alerts`, ambos restritos ao contexto da plataforma.

### Recuperação de armazenamento

- Volume de estado ou certificados somente leitura, disco cheio e falha de gravação bloqueiam novas alterações e expõem diagnóstico. O certificado servido continua em uso quando o Nginx já está ativo.
- Corrija o armazenamento e reinicie **somente o agente**. O estado persistido e o certificado servido são verificados antes de liberar operações. Se não for possível adquirir o bloqueio inicial, a API apresenta agente indisponível; consulte também os logs do container.
- Estado JSON corrompido não é sobrescrito nem substituído automaticamente por um estado vazio. Preserve uma cópia para diagnóstico e restaure um backup consistente pelo servidor, com o agente parado. Não apague apenas os indicadores de recuperação.
- Backups devem incluir `certs/managed`, o volume `tls_state` e o volume `tls_acme`, preservando links e permissões. Aguarde a operação terminar e pare somente o agente durante uma cópia consistente; o Nginx e as sessões SSH não precisam ser parados para copiar esses volumes.

### Testes adicionais

Revalidação da evolução em 25/09/2026: **49 testes automatizados aprovados**, verificações de tipos da API e frontend e build do frontend concluídos. Playwright aprovado nos temas claro/escuro, desktop/mobile, incluindo o indicador no menu recolhido. A regressão de experiência do terminal passou. A integração com a imagem `nodeaccess-tls-agent:improvements` validou também volumes de estado e certificados somente leitura e recuperação, mantendo uma única conexão SSH e um único WebSocket. Em MySQL descartável, a migração, confirmação perdida e coletores concorrentes passaram sem duplicação de eventos. As emissões usaram a CA de teste Pebble; produção não foi alterada.

- `npm run test:tls`: persistência, autorização, idempotência, diagnóstico, prazos de novas tentativas, expiração e sincronização da auditoria; inclui interrupção real de processo nos pontos críticos, usando certificados e diretórios descartáveis.
- `npm run test:tls:audit`: aplica a nova migração em MySQL temporário e valida confirmação perdida, coletores simultâneos e ausência de duplicação. Não usa `DATABASE_URL` do ambiente.
- `npm run test:tls:web`: Playwright com resposta perdida, erro antes da aceitação, alerta fora da tela, falha da auditoria, diagnóstico separado, mobile e preservação do terminal.
- `npm run test:tls:integration`: Nginx/Certbot/Pebble/SSH reais, volumes somente leitura, bloqueio de dois agentes e recuperação. Nunca executar contra host SSH de produção; o ensaio cria seu próprio servidor SSH/PTY.

Referências: [Certbot — uso e simulação](https://eff-certbot.readthedocs.io/en/stable/using.html), [Let’s Encrypt — limites e prazo de repetição](https://letsencrypt.org/docs/rate-limits/).
