# Guia de agentes NodeAccess

## Qual agente escolher

- **Agente pessoal**: acompanha a rede/VPN do operador e atende somente seu usuario.
- **Agente compartilhado**: roda continuamente em uma maquina do tenant e atende a equipe; um deles pode ser o padrao.
- **Conector de rede privada**: publica somente sites, CIDRs e portas autorizados, sem abrir entrada na rede.

## Fluxo recomendado

1. Em `/agents`, escolha **Instalar agente**.
2. Defina finalidade, nome e, para conectores, o escopo minimo necessario.
3. Crie o token, escolha a plataforma e copie o comando recomendado.
4. Para operacao continua, escolha instalacao como servico. O instalador guarda o token em arquivo restrito e o processo usa `--token-file`.
5. Volte ao wizard, valide o agente online e teste um host privado.

O token e mostrado uma unica vez. Revogue o agente se ele ou a maquina forem comprometidos.

## TLS e certificados privados

TLS e validado por padrao. Para uma CA interna, execute com `--ca /caminho/ca.pem`.
`--insecure` existe somente para diagnostico temporario e deixa o agente em estado de atencao na interface.

O token tambem pode vir de `--token-file` ou `NODEACCESS_AGENT_TOKEN`. Para servicos, prefira arquivo com permissao restrita.

## Diagnostico rapido

- **Instalacao pendente**: confirme que o comando continua em execucao e que DNS/HTTPS do NodeAccess estao acessiveis.
- **Heartbeat atrasado**: revise VPN, proxy, firewall e perda de pacotes.
- **Offline / ws closed (1006)**: houve quebra abrupta; o agente reconecta com backoff e jitter.
- **Timeout TCP**: o agente esta online, mas nao alcançou o IP/porta do host em 15 segundos.
- **TLS sem validacao**: remova `--insecure` e configure a CA corretamente.
- **Versao desatualizada**: instale a versao minima informada no detalhe do agente.

O teste de host valida a rota do agente e diferencia falha do agente de falha TCP/SSH quando o backend fornece essa etapa.

## Manutencao, failover e credenciais

- Use **Drenar para manutencao** antes de atualizar a maquina ou o binario. Novas sessoes usam o proximo agente e as atuais continuam.
- Agentes compartilhados do mesmo pool usam menor prioridade primeiro; manutencao e indisponibilidade promovem o seguinte.
- Consulte **Ver impacto** antes de revogar para conferir hosts vinculados e sessoes ativas.
- Ao rotacionar, copie o token exibido uma unica vez, substitua o arquivo protegido e reinicie o servico. O token antigo nao autentica novas conexoes.
- O historico usa eventos auditados sem expor segredos.
