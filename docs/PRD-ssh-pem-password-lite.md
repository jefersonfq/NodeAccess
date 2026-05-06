# PRD SSH PEM Password Lite

## Objetivo
Permitir hosts que exigem autenticacao SSH com chave PEM e senha do usuario no mesmo fluxo.

## Problema
Hoje o host aceita apenas um modo principal:
- `password`
- `pem`

Isso nao cobre ambientes que exigem:
- chave privada para autenticar
- senha da conta SSH como fator adicional

## Fase 1
- adicionar novo modo de autenticacao do host:
  - `pem_password`
- permitir no cadastro/edicao do host:
  - selecionar PEM + senha
  - informar chave PEM
  - informar senha SSH
- suportar o modo em:
  - teste de conexao
  - terminal SSH
  - SFTP
  - tunnels
- manter suporte a senha vinda de `onePasswordRef` quando usado junto com PEM local

## Regras
- `pem_password` exige chave PEM
- `pem_password` exige senha SSH local ou `onePasswordRef`
- `onePasswordRef` neste modo resolve apenas a senha
- bastion continua com os modos ja existentes

## Fora de escopo inicial
- passphrase separada da chave PEM
- dois segredos distintos vindos de cofres diferentes
- importacao CSV especializada para este modo

## Proxima fase
- suportar `passphrase` separada da chave PEM
- distinguir claramente:
  - senha SSH do usuario no host
  - passphrase usada para desbloquear a chave privada
