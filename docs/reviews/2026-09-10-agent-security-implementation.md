# Segurança dos agentes: implementação e validação

> Atualização: o padrão sem arquivo local e a auditoria transacional foram implementados depois desta etapa. Consulte [Agentes gerenciados por ACL](2026-09-10-agent-managed-acl.md); a exigência de política local descrita abaixo é histórica.

Implementação decorrente da revisão `2026-09-10-agent-security-followup.md`. Versão do agente: **2.0.0**, com mudança de compatibilidade deliberada. Não houve publicação, atualização de clientes ou uso da VPN de cliente.

## Proteções implementadas

- Registro duplicado encerra a instância anterior e suas pontes. Frames de instâncias removidas não são processados. IDs duplicados não podem substituir pontes existentes.
- Revogar, excluir ou rotacionar credencial invalida o registry local e publica pelo Redis. Gateways reconsultam a credencial no banco a cada 5 segundos. Sem banco, a consulta tem prazo de 3 segundos e as pontes são encerradas: janela nominal máxima de 8 segundos, sujeita ao escalonamento do processo. O hash do token funciona como versão da credencial, sem nova coluna.
- Tenant desativado bloqueia todos os agentes; usuário desativado bloqueia agentes pessoais. Agentes institucionais não dependem da atividade do criador. Pausa é sincronizada sem encerrar conexões existentes.
- Política **local**, carregada de arquivo do cliente, limita CIDRs, portas e opcionalmente hostname exato. Todas as respostas DNS precisam ser permitidas; o socket usa o IP já validado. Sem política, destinos e listeners locais são bloqueados. O servidor não pode editar ou ampliar essa política pelo protocolo.
- HTTPS/WSS com certificado validado; credencial no cabeçalho Authorization. WS e `--insecure` exigem `--development`. O metadado `tlsMode` é informativo, não atestação remota.
- Limites de 128 pontes por agente, frames processados de até 256 KiB, 2.000 frames/s no registry e filas de 2 MiB. Escritas grandes do backend são divididas em frames. Consumidor lento encerra a ponte excedente; isso é proteção de memória, não um protocolo novo de controle de fluxo. Listeners locais continuam restritos a loopback e precisam de `localPorts` explícito.
- Linux systemd usa conta dedicada, sem capabilities, com NoNewPrivileges, ProtectSystem, ProtectHome e arquivos protegidos. Download temporário exclusivo; assinatura conferida antes de executar/instalar. macOS recebe validação de assinatura e política, mas a migração do LaunchDaemon para conta dedicada ainda requer validação nativa.
- Empacotamento migrado para Node 24 e `@yao-pkg/pkg`; host de build precisa de Node >=22. `ws` atualizado para 8.21.0 após auditoria identificar vulnerabilidades na versão resolvida anterior.
- Produção exige assinatura RSA >=3072 bits dos artefatos/manifestos. Windows exige também Authenticode com editor esperado. Atualizador valida manifesto assinado com chave instalada, checksum, tamanho, versão e assinatura/editor do MSI; repete a verificação do editor antes de abrir o instalador.

## Migração e configuração local

Prepare a política **antes** de atualizar. Exemplo restrito ao SSH de um host e uma porta de publicação local:

```json
{
  "version": 1,
  "rules": [{ "cidr": "172.31.1.20/32", "ports": [22] }],
  "localPorts": [2222]
}
```

O endereço acima é somente exemplo, não alvo de teste executado. Inclua separadamente os demais hosts/redes realmente necessários. Não use `0.0.0.0/0` ou `::/0` como migração automática. Loopback, link-local e redes de gerenciamento também exigem regras explícitas.

```bash
chmod 600 policy.json
nodeaccess-agent --check-policy policy.json
nodeaccess-agent --server https://nodeaccess.example --token-file agent.token --policy policy.json
```

Reinicie o agente após alterar a política. No desktop Windows: `%LOCALAPPDATA%\NodeAccess\Agent\policy.json`; o assistente cria uma política vazia se não houver arquivo. Enquanto vazia, o registro pode aparecer conectado, mas destinos permanecem bloqueados. Permissões locais devem restringir a edição à identidade que administra o agente. Mensagens de negação indicam a política local. O script Windows legado exige `-TrustedPublisher` obtido por canal independente.

No Linux, o script exige `--trusted-key <public.pem>` e `--policy <policy.json>`. Obtenha a chave pública por um canal independente do distribuidor; **não** baixe a chave junto do pacote e a considere automaticamente confiável. Revise/distribua o instalador por canal confiável: executar um script remoto comprometido pode contornar as verificações contidas no próprio script. No serviço, política e token ficam em `/etc/nodeaccess-agent`, legíveis pela conta dedicada.

O gateway rejeita token na query por padrão. `AGENT_ALLOW_LEGACY_QUERY_TOKEN=true` é uma ponte temporária explícita para migração, que deve ser retirada após atualizar os agentes. Atualize em janela de manutenção: substituir registro ou girar token agora encerra acessos em andamento.

## Assinatura e publicação

Configurar no pipeline, nunca no repositório:

- `NODEACCESS_RELEASE_SIGNING_KEY`: arquivo PEM RSA privado, protegido no executor de assinatura.
- `NODEACCESS_RELEASE_PUBLIC_KEY`: PEM público confiável para validação independente.
- Windows: `NODEACCESS_CODE_SIGN_CERTIFICATE`, `NODEACCESS_CODE_SIGN_PASSWORD` quando necessário e `NODEACCESS_CODE_SIGN_THUMBPRINT` do editor esperado.

O MSI inclui `release-trust.json` gerado no build. Esse arquivo contém somente chave pública e identidade do editor; não pode ser substituído por metadados de download. Renovações de chave/editor exigem distribuição confiável da nova âncora. `NODEACCESS_DEVELOPMENT_UNSIGNED=true` permite somente artefatos de laboratório; o atualizador de produção continua rejeitando ausência de assinatura. Não foram gerados certificados comerciais nem publicada uma release assinada.

## Validações reproduzíveis

- `npm run typecheck -w apps/backend`.
- `node --env-file=apps/backend/.env node_modules/vitest/vitest.mjs run apps/backend/src/modules/agents`.
- `npm run test:security -w apps/agent`.
- `node --test apps/agent/installer/windows/artifacts.test.mjs apps/agent/installer/windows/installer-contract.test.js`.
- Windows PowerShell: `apps/agent/installer/windows/updates.test.ps1`. Usa RSA real de laboratório para manifesto; Authenticode é simulado para testar aceitação/rejeição de editor. Isso não substitui testar o MSI comercial assinado.
- `RUN_AGENT_SECURITY_LIVE=true AGENT_TEST_EXECUTABLE=<binario> node --env-file=apps/backend/.env --import tsx tools/agents/security-live.mjs`. Requer SSH **descartável** em `127.0.0.1:2249`, usuário `lab`, senha de laboratório `disposable-test-only`, MySQL e Redis locais. Cria/remove tenant, usuário e agente de teste; não altera identidades existentes. Exercita WSS validado por CA efêmera, SSH real pelo binário, negação pela política, ciclo de vida no banco e invalidação de registry remoto via Redis.
- PTY real: `HOST_ID=<host-descartavel> FRONTEND_BASE=<frontend-local> npm run test:terminal-pty:real`. Executado com `top` e `htop`, sem achados. Relatórios desta execução: `/tmp/nodeaccess-security-pty/`.

## Resultados desta execução

- Backend: 50 testes distintos aprovados (48 na suíte do módulo e mais dois cenários de capacidade/fracionamento, posteriormente aprovados junto aos oito testes de segurança).
- Agente/criptografia: 12 testes aprovados. Empacotamento/contratos: 17 aprovados.
- Binário Linux 2.0.0 compilado e usado na simulação WSS + SSH + MySQL + Redis, aprovada.
- Windows: testes do atualizador aprovados com criptografia RSA real e simulação de Authenticode.
- Typecheck backend aprovado. `npm audit --omit=dev -w apps/agent --json`: zero vulnerabilidades reportadas após atualização, dentro do inventário consultado.
- PTY `top`/`htop` aprovado; registros descartáveis removidos após testes.

## Limites da conclusão

Os testes demonstram os cenários exercitados, não ausência absoluta de vulnerabilidades. Permanecem necessários para liberar a versão: identidade oficial de assinatura, MSI final validado em Windows e instalação/serviço nativos em Linux/macOS. O cliente Windows 2.0.0 precisa receber sua âncora confiável por uma instalação inicial confiável; clientes antigos não ganham verificação de assinatura apenas por receber metadados novos. mTLS, hardware-backed keys e sandbox específico de macOS não foram adicionados nesta etapa.

Referências de runtime: [ciclo de suporte Node.js](https://github.com/nodejs/Release), [migração do empacotador](https://yao-pkg.github.io/pkg/guide/migration).
