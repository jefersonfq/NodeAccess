# Implantação 2.1.0 — preparação, ainda não executada

## Estado e proteção

Destino autorizado: instalação `nodeaccess-v2`, release atual 2.0.3 em
`/opt/nodeaccess/v2`, configuração compartilhada preservada. Não publicar a oferta
antes de validar laboratório, SMTP, termos, quotas e jornada de acesso.

Backup de referência NA-0068 já tem cópia fora do servidor e ensaio de restauração;
por ter sido obtido com a aplicação ativa, não substitui o backup final consistente.
Preservar IDs das imagens, dump SQL, Redis, auditoria, avatares, configuração,
chaves SSH, certificados, sites e proxy. O arquivo de segredos nunca entra no Git.

## Ordem proposta para revisão independente

1. Concluir testes no SHA candidato e pacote oficial; conferir checksums no destino.
2. Preparar diretório novo da release, imagens e runtime do provisionador sem trocar
   o symlink atual. Configuração de degustação inicia com cadastro público fechado.
3. Validar HTTPS privado do provisionador, autenticação interna, CA, quotas e
   isolamento com controles descartáveis antes de conectá-lo ao plano real.
4. Abrir janela de manutenção, impedir novas gravações e drenar sessões. Registrar
   início e containers afetados. Fazer backup final consistente e copiar para fora.
5. Restaurar somente o schema da aplicação e migrations em volume MySQL 8.4 NOVO,
   com usuários criados no plugin compatível (não restaurar mysql.user de 8.0);
   manter o volume MySQL 8.0 intocado. Preservar o volume Redis antigo e usar volume
   separado para a série nova. Nenhum downgrade pode reutilizar volumes atualizados.
6. Após backup/drenagem, substituir somente os containers MySQL/Redis, sem remover
   os volumes antigos. A composição operacional derivada deve declarar os nomes
   novos dos volumes explicitamente e ser usada em todas as invocações. Criar os
   novos containers com os labels de projeto/serviço do Compose; o guard oficial
   precisa inspecionar containers ativos 8.4/8.x, não um clone fora do projeto.
   Comparar dados existentes, aplicar migrations do pacote, testar saúde e
   compatibilidade de credenciais. Preservar nomes do projeto e volumes de auditoria/
   avatares; usar caminho absoluto da chave do gateway SSH atual.
7. Subir a aplicação 2.1.0 usando o fluxo oficial e configuração revisada. Conferir
   healthchecks, login/MFA, tenant normal, host existente e SSH/SFTP. Testar signup,
   expansão, quota, cancelamento e isolamento com dados de homologação identificados.
8. Publicar páginas legais e links de forma atômica após conferir hash do HTML atual;
   habilitar cadastro somente quando todas as verificações anteriores passarem.
9. Registrar versão, SHA, IDs de imagens, checksums e evidências fora do segredo.

## Retorno

Se falhar antes da abertura a usuários, fechar cadastro, revogar/remover laboratórios
e parar a aplicação nova antes de recuperar a
composição antiga com imagens por ID, configuração preservada e volumes originais.
Não executar migrations antigas contra o banco atualizado. Após aceitar gravações
reais, avaliar reconciliação dos novos dados antes de qualquer retorno ao snapshot.
O cadastro público pode ser fechado pela flag sem alterar tenants normais nem
remover a classificação dos trials existentes.

## Pendências operacionais

Confirmar configurações efetivas e memória disponível no momento da troca;
proxy privado/CA/runtime já passaram nas provas técnicas descritas em operations/README.md, sem habilitar onboarding. Executar o ensaio
final com o pacote do SHA integrado. Este documento é um plano, não comprovação de
implantação, janela realizada ou homologação humana.

## Barreira adicional do VPS com firewalld

Os arquivos revisados em `operations/` preservam a configuração operacional deste
VPS: tabela própria `inet nodeaccess_trial_guard`, loader atômico e unidade sem
remoção automática no stop. Não são uma configuração universal: os pools
10.207.68.0/24 e 10.207.69.0/24 devem permanecer exclusivos e alinhados ao provider.
Permitir somente controle→lab TCP2222 NEW/ESTABLISHED e resposta lab→controle
TCPsport2222 ESTABLISHED; negar demais tráfegos dos pools, incluindo acesso ao host.
Não usar RELATED, flush global ou nftables.service. O provider depende de
Requires/After dessa unidade e verifica a tabela antes de iniciar.

Antes de aplicar: salvar regras, verificar rotas/IPAM, conferir ownership e
executar nft --check. Depois, smoke com controles descartáveis e fault limitado
às regras iptables do UUID de teste; comprovar drops independentes na tabela nft.
Não executar reload do firewall de produção para obter essa evidência. O backend
[nftables do firewalld](https://firewalld.org/2018/07/nftables-backend) gerencia sua
própria tabela; o desenho não protege contra flush deliberado do ruleset ou
comprometimento do host. Os labs continuam compartilhando o kernel do VPS.

Ao retirar: remover todos os labs via lifecycle e confirmar ausência antes de
remover explicitamente somente a tabela própria. Nunca remover a barreira no
cleanup de teste ou com labs ainda ativos. Backup de regras não substitui backup
consistente de banco, imagens e configuração.
