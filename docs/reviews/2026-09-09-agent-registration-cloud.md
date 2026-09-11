# Agente Windows: AGENT5 e AGENT6

## Evidencia e causa

AGENT5 mostra falha generica do probe `--check`, com preservacao da configuracao
anterior. AGENT6 mostra tentativa de iniciar sem `config.json` em LocalAppData.
No codigo, Save-AgentConfiguration so grava config apos ExitCode zero; o segundo
erro e consequencia do primeiro. Start-AgentProcess le o JSON antes de verificar
se ele existe; o timer tambem troca o estado inicial nao configurado por parado.

A imagem nao identifica a causa do registro. Token recusado, TLS, rede/rota
WebSocket e leitura de ExitCode do processo pelo PowerShell precisam ser
distinguidos pelo diagnostico real. Nao afirmar token invalido com esta evidencia.
O probe executado com janela oculta nao mostra stdout/stderr, deixando a causa
invisivel. A ausencia de config.json nao deve ser corrigida criando JSON manualmente
ou ignorando validacao TLS.

## Proximo diagnostico

No Windows afetado, a partir da raiz do repositorio:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\windows\diagnose-agent-registration.ps1 -Server https://nodeaccess.com.br
```

O script usa o EXE e o assistente instalados em Program Files, pede o token em
entrada oculta, grava candidato temporario na pasta protegida do proprio agente,
executa `--check` diretamente e remove o candidato em finally. Nao substitui
config.json nem agent.token e nao inicia processo persistente. O probe efetua um
registro breve no servidor, portanto pode aparecer como conectado/desconectado.
Nao compartilhar o token. A saida remove o valor informado e parametros token.

Se o probe retornar zero e o assistente continuar rejeitando, investigar a
obtencao de ExitCode por Start-Process no Windows afetado. Se falhar, usar o erro
real para distinguir TLS, HTTP/proxy ou credencial. Atualizar o servidor web nao
substitui automaticamente o MSI instalado. Comparar a versao do EXE instalado
com o pacote oferecido pelo portal.

## Limites desta revisao

Imagens e fluxo de codigo inspecionados. Diagnostico PowerShell preparado para
execucao no Windows do usuario; nao executado neste ambiente Linux. Ainda nao ha
evidencia suficiente para atribuir a falha de registro a uma causa unica.

## Resultado recebido do Windows

O diagnostico executado pelo usuario retornou `NodeAccess Agent 1.0.0`, ajuda
com `--server`, `--token`, `--verbose` e `--version`, e codigo 1. O executavel
instalado nao oferece `--token-file` e `--check`, exigidos pelo assistente.
Essa incompatibilidade explica a falha antes de validar a credencial. Nao ha
motivo, com essa saida, para trocar token ou desabilitar TLS.

O package.json e o manifesto Windows disponiveis no repositorio indicam 1.1.0.
Ainda falta determinar por que a instalacao manteve um EXE 1.0.0: conferir o EXE
da pasta dist, checksums e instalacao MSI com log, depois verificar novamente o
executavel em Program Files. Nao atribuir a causa a cache ou regra do MSI sem o
log dessa instalacao. Reexecutar o probe apos corrigir a versao instalada.

Na tentativa seguinte, EXE em dist confirmou 1.1.0; EXE instalado continuou
1.0.0. Registro do Windows informa produto 1.1.0 e ProductCode
{46FD821E-D3BF-478A-9625-E5E7CDF31727}. Log MSI entra em maintenance mode e
termina com 1603. Isso confirma falha da tentativa de manutencao, mas o trecho
filtrado nao mostra a acao causadora. O log esta localizado em portugues:
incluir `Valor de retorno 3` na busca, alem de `Return value 3`. Nao concluir
que o Windows preservou o EXE por versionamento sem examinar a falha anterior.

O trecho completo identificou a falha em RegisterProduct: SecureRepair procura
`NodeAccessAgent.msi` na pasta de origem, mas o arquivo invocado e
`nodeaccess-agent-windows-x64.msi`. Erros 2203/1316 precedem o retorno 3.
O nome esperado corresponde ao nome de download publicado pela API. Os
componentes AgentExecutable e AgentSetup aparecem com Request/Action Null,
portanto a manutencao simples tambem nao solicitou reposicao dos arquivos.
Proximo passo: copiar o MSI validado para uma pasta local exclusiva com nome
NodeAccessAgent.msi e executar reparacao explicita REINSTALL=ALL,
REINSTALLMODE=vamus, com elevacao e log novo. Validar codigo de saida, hash do
EXE instalado contra o EXE da mesma distribuicao e versao real apos concluir.
Isso resolve os bloqueios observados nesta tentativa; ainda nao demonstra como
o EXE 1.0.0 permaneceu originalmente numa instalacao registrada como 1.1.0.
Nao alterar politicas SecureRepair ou chaves do registro como contorno.

## Reparacao confirmada pelo usuario

A copia do MSI para pasta temporaria exclusiva com nome `NodeAccessAgent.msi`,
seguida de `/i REINSTALL=ALL REINSTALLMODE=vamus /passive /norestart` com
elevacao, terminou com codigo 0. O EXE em Program Files passou a informar
`NodeAccess Agent 1.1.0`. Log no Windows:
`C:\Users\jefir\AppData\Local\Temp\NodeAccessRepair-64476081-033f-4960-ab3f-201c4f8247ec\repair.log`.
A incompatibilidade local do executavel foi resolvida. Falta confirmar
`Validar e conectar`, estado online no portal e uso de uma conexao pelo agente.
Nao confundir sucesso de reparacao MSI com sucesso de registro/rede.
