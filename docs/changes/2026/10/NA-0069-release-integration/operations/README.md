# Compatibilidade do marcador de propriedade

No preflight de 24/10/2026, o VPS aceitou o comentário da tabela no arquivo nft,
mas não o devolveu em `nft list table` nem nos metadados JSON da tabela ativa.
O check de propriedade interrompeu o smoke antes da criação de fixtures.

Por compatibilidade, o mesmo marcador está também na regra existente que descarta
origens dos pools de laboratório. Isso não acrescenta permissões, regras universais
ou novos verdicts. O comentário da tabela permanece para sistemas que o preservam.
O loader continua exigindo o marcador; não se deve remover essa verificação.

A primeira substituição de uma tabela instalada sem o marcador visível exige
revisão do dump e de seu hash exato pelo operador, seguida de uma única transação
atômica restrita a essa tabela. Não usar flush global, apagar a tabela antes de
validar sua substituição ou contornar automaticamente a verificação de propriedade.

## Proxy privado e SELinux neste VPS

`nodeaccess-trial-proxy.service` inicia uma instância Nginx independente; não
incluir sua configuração no Nginx dos sites. Listener privado10.208.68.1:9000,
origens10.208.68.2/.3, TLS validado nos dois trechos. Provider permanece em
127.0.0.1:9443. A URL operacional da aplicação usa a porta9000.

Porta9000 já pertence a http_port_t;9444 pertence a outro serviço na política
do VPS e não foi relabelada. PID sob /run/nginx-nodeaccess-trial, logs em
/var/log/nginx e temporários próprios em /var/lib/nginx/tmp usam os contextos
padrão do Nginx. Criar somente subdiretórios próprios e executar restorecon neles.
SELinux permanece Enforcing; não alterar booleanos/política global para instalar.
RuntimeDirectory recria o diretório volátil; PartOf propaga stop/restart planejado
do provider. Reiniciar ambos explicitamente em manutenção e repetir prova HTTPS.

CA pública em /etc/nodeaccess-trial-public/ca.crt (0644; diretório0755), montada
somente leitura nos controles. Configuração/token/chave leaf ficam root0600.
Chave privada da CA permanece no backup local protegido e não vai ao servidor.
Os templates são específicos destes pools; não contêm token, senhas ou chaves.
