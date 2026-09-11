# Testes adicionais de resiliência

## Cobertura e resultado local

- Agente: servidor silencioso até o timeout, mensagens inválidas/desconhecidas,
  desconexão durante validação e três quedas consecutivas com tráfego TCP.
  Verifica encerramento dos túneis antigos, contagem local e tráfego após reconectar.
  Quatro testes passaram com Node/Linux e com o EXE Windows 1.1.0 existente.
- Configuração Windows: URL insegura, token vazio, timeout e executável ausente
  preservam a configuração anterior. Verifica limpeza da credencial temporária,
  encerramento do processo de validação, PID reutilizado, executável diferente,
  metadados corrompidos e início repetido sem duplicar agente. PowerShell nativo passou.
- Presença: eventos duplicados/fora de ordem, isolamento por host, várias abas da
  mesma pessoa, limpeza de sessões antigas e recuperação após falha no repositório.
  Treze testes Vitest passaram (cinco novos).
- Navegador: links JIT expirados/revogados em tela móvel, Enter repetido durante
  resposta pendente, erro 503 seguido de nova tentativa e resposta tardia após sair.
  Bateria de compartilhamento passou; HTTP e WebSocket são controlados pelo teste.
- Tooltip: desaparece com Enter/Escape e volta no próximo hover. Bateria completa
  `test:terminal-experience:web` passou, incluindo os cenários existentes de reconexão.

## Falha encontrada e corrigida

Uma resposta 503 no JIT acionava a recuperação global da API, recarregando a
página e perdendo o nome preenchido. O interceptor agora deixa as duas operações
públicas JIT tratarem seus erros localmente. O teste verifica preservação do nome,
nova tentativa e ausência de refresh autenticado. A recuperação dos demais
endpoints permanece igual. Quatro testes verificam a classificação das rotas.

## Repetir

Na raiz do projeto, com dependências instaladas:

```bash
npm run test:resilience:core
FRONTEND_BASE=http://127.0.0.1:5177 npm run test:resilience:web
```

O segundo comando exige frontend ativo. Use `PLAYWRIGHT_EXECUTABLE_PATH` caso o
Chromium não esteja em `/usr/bin/chromium-browser`.

No Windows, na raiz do projeto:

```powershell
./tools/agent/config-faults.test.ps1
$env:AGENT_TEST_EXECUTABLE = (Resolve-Path apps/agent/dist/nodeaccess-agent-win.exe).Path
node --test tools/agent/faults.test.cjs
```

O workflow `agent-native-smoke.yml` inclui os novos testes de falha, a execução
contra o EXE empacotado e a bateria web. A execução remota do CI não foi realizada
nesta rodada. Typecheck do frontend, lint dos arquivos TypeScript envolvidos e validação sintática do YAML passaram. Os testes não alteram produção nem o início automático do Windows.
Falhas de configuração usam processos simulados; quedas do agente usam sockets
locais reais. Não substituem certificação de VPN, proxy ou certificados da empresa.
