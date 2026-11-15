# VaultNAccess — adendo de produto, revelação e distribuição

Este adendo substitui as recomendações incompatíveis da avaliação inicial. Decisões do usuário: nome VaultNAccess; objetivo imediato criar Cofre e extensão; senhas salvas devem poder ser visualizadas por usuários autorizados nas duas interfaces; desbloqueio confortável inspirado no 1Password; disponibilização da extensão no frontend; segurança evolutiva e E2EE como evolução. Não houve execução de código, publicação ou aprovação de valores de política nesta interação.

> Refinamento vigente: [arquitetura híbrida e preservação operacional](hybrid-delivery-review.md). Entrega cifrada por operação é proposta específica da extensão; SSH/RDP não dependem dela. HPKE e chaves de dispositivo exigem PoC, sem E2EE geral.

## Escopo imediato e ordem de entrega

1. Consolidar Secrets/PEM existentes sob VaultNAccess, preservando IDs/ACL/licença/consumidores e rotas anteriores.
2. Preparar domínio de login web/URLs e contrato de revelação individual de senha, com autorização explícita por ação, sessão de Cofre e auditoria. Antes de revelar valores, resolver os gates de sessão e resolvedores identificados na avaliação.
3. Criar extensão com autenticação própria, pesquisa/abertura, cadastro/edição conforme permissões e detalhe de item com senha mascarada e ação Revelar. As entregas podem ser incrementais; a extensão de descoberta sozinha não encerra o objetivo de exibir senhas.
4. Oferecer pela área autenticada do usuário o download do pacote piloto e instruções de instalação/atualização. Publicação em lojas ou políticas corporativas é entrega posterior, com autorização própria.
5. Validar Windows Hello via WebAuthn para facilitar desbloqueio. Autofill permanece objetivo separado da revelação; bridge nativa, mobile e E2EE não bloqueiam a consolidação inicial.

O recorte funcional está direcionado pelo usuário; arquitetura detalhada, testes, políticas e baseline continuam pendentes antes da implementação material. Não interpretar evolução de segurança como adiar ACL, tenant isolation, HTTPS, proteção de tokens, expiração server-side ou auditoria da revelação.

## Revelar senhas com exposição limitada

A senha permanece mascarada por padrão; listagens e pesquisa nunca recebem seu valor. Revelar exige gesto explícito no detalhe de um item, sessão de Cofre desbloqueada e autorização server-side. Cada entrega é individual e auditada, com resposta no-store; não baixar lote de segredos ao desbloquear.

Separar permissões de listar, usar no backend, preencher, revelar, copiar, editar e compartilhar. Acesso ao host, pertencimento a grupo ou papel admin não deve automaticamente converter-se em permissão de revelar todos os valores existentes. Definir migração explícita de grants; tipos sem regra aprovada permanecem negados. Senhas de host também são candidatas à revelação, mas somente por autorização específica, mantendo a opção de uso intermediado sem exposição. Tokens/Secrets genéricos exigem política por tipo; PEM, seeds TOTP, chaves mestras e tokens de integração não se tornam exportáveis por esse pedido.

Após revelar, mascarar e descartar referências ao valor no vencimento, troca de item/tenant, fechamento do popup/modal, lock/logout e perda de visibilidade. Não apenas esconder via CSS mantendo valor no DOM. Cancelar respostas pendentes para que uma resposta tardia não reabra a senha. Não persistir valor em storage, logs, telemetria, snapshots ou rascunhos. Não prometer limpeza perfeita da memória, bloqueio de screenshot, proteção contra malware ou retirada de segredo já visto.

Copiar é ação distinta, se aprovada; clipboard pode ser compartilhado pelo SO, histórico ou sincronização. Limpeza temporizada não garante apagar cópias e não deve sobrescrever conteúdo novo do usuário. Preferir revelar/preencher conforme necessidade; não usar clipboard como transporte interno.

Contrato conceitual: concessão `reveal` vinculada a usuário, sessão, tenant, tipo/ID, versão e prazo curto; consumo atômico com nova checagem de revogação/ACL. Retorno apenas do campo autorizado, nunca do registro cifrado completo. Grant de reveal não autoriza fill/export. Registrar decisão e tentativa de entrega, não afirmar que um humano efetivamente leu a senha. Falha de auditoria da entrega sensível deve negar ou usar mecanismo durável aprovado.

## Desbloqueio confortável e verificável

Preferência: passkey/WebAuthn no domínio HTTPS NodeAccess, com user verification obrigatório, challenge imprevisível, uso único, validação de RP ID/origin/assinatura e vínculo com usuário/sessão/tenant. No Windows, Hello pode verificar rosto/digital/PIN do sistema; o servidor recebe prova criptográfica, não PIN/biometria. Não criar PIN HTML equivalente ao Hello, nem uma senha mestra paralela sem necessidade.

WebAuthn comprova a verificação exigida, mas não garante que a aplicação saiba qual gesto (PIN versus digital) foi usado, nem que toda passkey seja vinculada a TPM. Se a política exigir dispositivo gerenciado/chave não sincronizável, é ADR específico com suporte/attestation/privacidade e recuperação demonstrados.

Na extensão, começar por cerimônia na origem do portal e retorno correlacionado de uso único à sessão da extensão; sem tokens na URL e sem confiar numa mensagem da página dizendo apenas “desbloqueado”. Portal e extensão usam sessões/grants próprios. Bloquear/revogar pode propagar entre clientes, mas desbloquear um não deve liberar automaticamente todos os dispositivos/perfis. Bridge nativa só se a PoC demonstrar benefício.

Proposta inicial para discussão, NÃO defaults aprovados:

| Relógio/estado | Candidato | Regra |
|---|---|---|
| Senha visível | 30 segundos | Reocultar antes em eventos de saída; não prolongar por polling |
| Prova recente para ações comuns | 5 minutos | Reutilizar prova recente, mas reautorizar cada item/ação no backend |
| Inatividade de Cofre | 10 minutos | Bloquear acesso sensível; só atividade pertinente conta |
| Duração absoluta de sessão Cofre | 8 horas | Reautenticação completa segundo política; refresh não reinicia relógio |
| Ação crítica/contexto novo | Sem reuso por padrão | Prova fresca vinculada à ação, conforme classificação |

Esses prazos têm objetivos diferentes e serão ajustados por tenant após PoC. Expirar a prova recente pode exigir Hello mesmo antes do bloqueio por inatividade; UI explica o motivo. O dispositivo pode manter a passkey cadastrada por longo prazo sem manter o Cofre desbloqueado. Evitar pedir senha corporativa em toda utilização não significa sessão infinita.

Fallback: login corporativo/senha + MFA conforme nível requerido, chave FIDO2 ou recuperação formal. Senha isolada não é substituto automaticamente equivalente de WebAuthn resistente a phishing. Recuperação/perda de dispositivo exige controles próprios e auditoria; não criar bypass para administrador silencioso. Lock do SO sem agente não é universalmente detectável; a validade do servidor é obrigatória mesmo sem esse sinal.

## E2EE e camadas futuras

O agente atual usa WSS/TLS e bearer: protege o transporte, mas não elimina acesso do backend às chaves/segredos. A proteção AES-GCM em repouso também não é E2EE. MVP permanece com criptografia em repouso e TLS, explicitamente rotulado, sem alegar zero knowledge.

Opções futuras:

- E2EE de itens pessoais/web: cifragem e descriptografia apenas nos clientes autorizados, chaves de item envelopadas por chaves de usuário/dispositivo; backend armazena ciphertext. Exige bootstrap, autenticação das chaves públicas, compartilhamento, revogação, multi-dispositivo, recuperação e migração próprios. O servidor pode observar metadados; busca e deduplicação precisam desenho compatível.
- Credenciais operacionais geridas: backend mantém capacidade de uso para SSH/RDP. Não chamar esses itens de E2EE contra o servidor. Políticas e rótulos distinguem modalidades sem downgrade silencioso.
- Operacional sem descriptografia no servidor: cliente/agente descriptografa e termina a conexão de autenticação ao destino, com serviço intermediário incapaz de acessar a chave. O túnel TCP atual não basta; muda disponibilidade sem agente, bastion, suporte RDP, auditoria e sessões compartilhadas.

Para facilitar evolução, usar contratos tipados, versão do formato criptográfico e separação entre metadados/política/material secreto. Não implementar protocolo criptográfico próprio nem pré-criar uma infraestrutura de E2EE incompleta no MVP. Revogação impede entregas futuras, mas não apaga valores/chaves previamente copiados. Em frontend servido pelo próprio backend, proteção contra servidor ativamente comprometido exige também considerar entrega de JavaScript malicioso; E2EE no banco não resolve essa ameaça sozinho.

## Instalação pela área do usuário

Proposta de entrada: `VaultNAccess → Extensão`, com navegador, versão, canal, compatibilidade, permissões justificadas, instruções e ação principal. No piloto: “Baixar extensão (piloto)” → baixar ZIP sem tokens/configuração pessoal → extrair em pasta estável → abrir gerenciador de extensões → modo desenvolvedor → Carregar sem compactação → selecionar pasta → conectar ao NodeAccess e autenticar. Não orientar uso rotineiro de senha real antes da homologação de segurança do piloto.

Chrome permite carga local em modo desenvolvedor; o site não instala silenciosamente nem abre por link comum todas as páginas internas do navegador. Instalação regular no Windows deve respeitar loja/políticas empresariais suportadas. Edge exige verificar seu canal/regras próprios na PoC; não assumir que hospedar CRX no portal basta. Firefox regular requer assinatura Mozilla, mesmo em autodistribuição; não prometer o ZIP Chromium como pacote universal.

Pacotes por versão/canal, hash SHA-256, procedência do build e manifest revisado; checksum ajuda a verificar integridade, mas não protege se arquivo e hash forem adulterados no mesmo servidor. Proteger release/build, definir assinatura/canal confiável quando aplicável. ID da extensão e callback/allowlist devem ser estáveis para o canal; não embutir segredo de cliente. Download não autentica a extensão nem concede acesso ao tenant.

Não empacotar sessões, PEM, arquivos .env, sourcemaps sensíveis ou configuração personalizada. Artefato compartilhável continua exigindo autenticação e autorização em runtime; controlar download não é fronteira de segurança do Cofre. Configuração do servidor deve ser explícita e validada; rejeitar endpoints inseguros/phishing, evitar descoberta arbitrária por mensagem de página.

Estados: disponível, não homologado para navegador, download falhou, versão incompatível, instalação sob política corporativa, atualização disponível, cliente revogado. Detectar instalação somente por handshake limitado validado; um ACK local não atesta integridade do cliente. Atualização manual no piloto com pacote completo, versão e instrução de recarga; sem scripts remotos ou auto-update improvisado. Política de versão mínima/kill switch no backend impede uso de versões revogadas. Para produção, loja/política corporativa com atualização suportada é preferível; publicação exige autorização separada.

## Critérios de validação e comparação

Revelação: negativa para usuário/tenant/ação sem grant, erro de auditoria, token antigo, proof expirada, corrida revogar×consumir, troca de perfil e resposta tardia; valor fora de lista/cache/logs/DOM após encerramento; screenshot não é controle prometido. Hello: Windows/Chrome e Edge em versões definidas, PIN/biometria/FIDO2, cancelamento, perda do autenticador, RP/origin incorretos, UV ausente, replay e recuperação. Distribuição: instalação limpa a partir do ZIP, atualização, downgrade negado, package sem segredo, callback/ID e revogação do cliente.

Benchmark de conveniência: cliques/tempo para achar, revelar, preencher, cadastrar e desbloquear; prompts por jornada, acessibilidade e falhas. Benchmark de segurança: fronteiras de confiança, autorização, exposição e recuperação documentadas/revisadas. Objetivo de experiência igual ou superior não é alegação de equivalência criptográfica ou certificação.

O 1Password documenta E2EE e desbloqueio com Windows Hello no aplicativo, incluindo opções TPM e confirmação periódica da senha. Isso serve de referência de experiência, sem copiar automaticamente sua arquitetura para um backend que autentica em SSH.

Fontes oficiais consultadas nesta interação:
- [1Password: Windows Hello](https://support.1password.com/windows-hello/)
- [1Password: bloqueio e desbloqueio](https://support.1password.com/unlock-auto-lock/)
- [1Password: modelo de segurança](https://support.1password.com/1password-security/)
- [Microsoft: passkeys e verificação pelo Windows Hello/PIN](https://learn.microsoft.com/en-us/windows/apps/develop/security/reference)
- [Chrome: carregar extensão local](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world)
- [Chrome: distribuição alternativa](https://developer.chrome.com/docs/extensions/how-to/distribute/install-extensions)
- [Mozilla: assinatura e distribuição](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/)

Documentação Edge de distribuição não ficou acessível nesta consulta; canal específico permanece a validar. Nenhuma PoC/teste de aplicação foi executado. As bibliotecas, versões alvo e disponibilidade de autenticadores serão verificadas antes da implementação.
