# NA-0206/NA-0207 — Roteiro de homologação da extensão em produção

Para a pessoa que vai homologar, em Windows, no Chrome e no Edge. Use contas reais autorizadas e itens de teste; nada aqui liga o preenchimento automático (`VAULT_SITE_FILL_ENABLED` continua desligado em produção). Testes automatizados não substituem este roteiro. Registre o resultado no fim, com data/hora e navegador.

Estado publicado em 2026-11-27T17:41-03:00: portal `2.2.0-na0206.1`; extensão **0.1.1**, ID `bppcjfeemlkgniinijlcjfihenekaake`. O pacote 0.1.0 continua no servidor apenas como cópia de retorno.

## 1. Instalação (máquina sem a extensão)

1. Entrar no portal e abrir **Cofre → Instalar a extensão**. O cartão deve mostrar a versão **0.1.1** e o SHA-256 do download.
2. Baixar o ZIP, descompactar numa pasta fixa (ex.: `C:\VaultNAccess`), abrir `chrome://extensions` (Edge: `edge://extensions`), ligar **Modo do desenvolvedor**, **Carregar sem compactação** e escolher a pasta.
3. Conferir na página de extensões: nome VaultNAccess, versão 0.1.1, ID igual ao acima e a descrição nova ("busca itens, revela e copia segredos e preenche logins…").
4. Abrir o popup pela barra ou **Alt+Shift+V** e conectar pelo portal. Confirmar com Windows Hello (ou código do autenticador).

## 2. Atualização (máquina que já tinha a 0.1.0)

1. Baixar o ZIP 0.1.1 e descompactar **por cima da mesma pasta** da 0.1.0.
2. Em `chrome://extensions`, clicar em **Recarregar** no card da extensão. Recarregar sem descompactar antes **não** baixa nada.
3. Conferir versão 0.1.1, mesmo ID e que a conexão anterior continua válida (ou pede nova confirmação, sem erro).

## 3. Uso

1. Buscar um item de teste no popup; conferir que aparece só o que a conta pode ver.
2. Revelar/copiar só se a política do tenant e as permissões dos dois gestores permitirem. Sem permissão, o botão não deve aparecer ou deve recusar com mensagem clara.
3. Em **VaultNAccess → Extensão do navegador: dispositivos conectados**, clicar em **Revogar** no dispositivo. O popup deve voltar a exigir a confirmação pelo portal.
4. Fazer logout do portal: a extensão deve perder a autorização na próxima ação.

## 4. Falhas esperadas (devem falhar de forma clara)

- Popup aberto com o portal fora do ar ou sem rede: mensagem de indisponibilidade, sem travar.
- Conta sem permissão de uso da extensão: conexão recusada.

## Registro

| Data/hora | Navegador e versão | Instalação | Atualização | Uso | Falhas | Responsável | Observações |
|---|---|---|---|---|---|---|---|
| | Chrome | | | | | | |
| | Edge | | | | | | |

Reversão da publicação 0.1.1: a cópia da pasta anterior está em `/opt/nodeaccess/maintenance/NA-0207-extension-0.1.1/backup-0.1.0` na VPS. Recolocar `release.json` e `update.xml` dela na pasta da extensão; nenhum reinício é necessário.
