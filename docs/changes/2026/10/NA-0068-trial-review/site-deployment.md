# Preparação do site — ainda não publicada

Inspeção somente leitura do HTML publicado. A Clavinci já encaminha à página do
NodeAccess e não precisa de alteração. O patch altera somente o CTA principal do
NodeAccess para `/trial`; mantém login atual, contatos comerciais e comparativo.
Não fixa quantidade de dias no site: o onboarding mostra o perfil vigente.

SHA256 do HTML original: `898623c0fc358f2053674e31766df5e57529b442a1950312800b7373662c7ab4`.
O patch foi conferido contra essa cópia. Antes de publicar, comparar novamente o
arquivo remoto e revisar eventual mudança; nunca substituir o site inteiro por
uma cópia antiga. Ainda falta validar visualmente o CTA nos assets reais.

Aplicar somente após release 2.1.0, backup/restauração validados, provisionador e
SMTP homologados, política/termos publicados e onboarding ativo. Preservar a versão
anterior dos sites, seus assets, nginx e certificados no backup privado. Publicar
arquivo temporário no mesmo filesystem e promover por rename; verificar desktop,
mobile, foco/teclado, destino `/trial`, entrada normal e cadastro até acesso SSH.
Para voltar o CTA, restaurar só o HTML preservado se não houver edição posterior.
Fechar inscrições pela flag da aplicação também exibe o estado indisponível no
onboarding, sem transformar contas normais.

Nenhum HTML, configuração ou container remoto foi alterado nesta preparação.
