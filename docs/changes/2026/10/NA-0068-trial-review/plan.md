---
change_id: NA-0068
title: Degustação configurável coexistindo com produção
status: in-development
type: feature
created_at: 2026-10-24T10:30:00-03:00
base_branch: master
base_sha: 66444a9dd4c167453004bb6089278548bdd2c0d9
branch: feature/NA-0068-20261024-trial-environments
owner: Codex
risk: high
---

# NA-0068 — Degustação configurável

## Objetivo e autorização
Usuário autorizou implementação fim a fim em branch separada, preparação da release 2.1.0 usando scripts existentes e ajustes no site. Solicitar acesso remoto apenas quando pronto para implantação. Esclarecimento: produção e trial coexistem; usuários/tenants existentes e criação administrativa normal permanecem sem política de trial. Backup de banco, imagens e configuração precede qualquer implantação.

## Escopo
Flag de instalação habilita exclusivamente onboarding público; metadados por trial persistem independentemente dela. Cadastro verificado, preferências de contato separadas, ativação com MFA existente, perfil versionado com quotas/templates, provisionamento isolado por adaptador, expiração e limpeza, administração, interface pública, documentação, testes e pacote 2.1.0. Não converter dados existentes ou destruir recursos normais. Sem mudanças no site remoto antes de build e revisão.

## Critérios de aceitação
- [x] Modo padrão preserva os fluxos atuais; flag pode ser ligada/desligada sem converter contas administrativas.
- [x] Cadastro público verifica e-mail, limita abuso, não revela contas e não condiciona acesso a marketing.
- [x] Perfil/template configurável, snapshot por trial, quotas e autorização no servidor.
- [ ] Provisionamento idempotente e restrito ao laboratório; falhas e limpeza recuperáveis.
- [x] Expiração bloqueia novas operações e encerra sessões ativas mesmo sem worker de limpeza.
- [x] Interface pública/admin responsiva com estados de erro, fila, progresso e expiração.
- [ ] Releases usam mesmo artefato; validação de normal/trial e rollback documentado.
- [ ] Banco e imagens atuais preservados antes do deploy; restore verificado em ambiente descartável.
- [ ] Release 2.1.0 gerada pelos scripts e implantação somente após dados de acesso solicitados ao usuário.

## Estratégia e riscos
GO_WITH_RISKS: extensão localizada por módulo de trial, licenciamento existente e adaptador de infraestrutura. VMs/provedor aguardam definição; cadastro fica fechado até validação. Controle compartilhado intencional conforme esclarecimento; isolamento por tenant e rede dos laboratórios. Flags não substituem autorização. Worker nunca apaga recurso sem propriedade comprovada. Não prometer ausência absoluta de bugs.

## Validação
Baseline de testes/configuração/autenticação; typecheck/build; unitários de contrato, estados, abuso, preferências; integração MySQL/concurrency e migrações; browser onboarding/admin; SSH/PTy descartável e regressão terminal; instalação/conversão/rollback; validação independente exigida pela skill.

## Baseline
Worktree /tmp/nodeaccess-NA-0068 preserva alterações de outras frentes. Base local e origin/master coincidiam no SHA acima. Fetch tentado sem resposta e interrompido; atualização remota não comprovada, revalidar antes da entrega. Node disponível 24.19.0 abaixo do engine mínimo declarado 24.21.0: registrar limitação e usar runtime compatível antes de release.

## Recuperação
Migração aditiva; backup consistente MySQL, imagens por digest/tar, configuração e volumes antes de deploy. Reverter aplicação preservando metadados trial e enforcement; não desativar expiração ao desligar novos cadastros. Restore do banco implica janela e perda das gravações posteriores, a tratar no runbook. Não aplicar downgrade cego.

## Aprovação
Escopo aprovado pelo usuário nesta conversa, incluindo convivência normal/trial e backup. Infraestrutura e validação de ambiente continuam pendentes, sem impedir desenvolvimento independente.

## Estado em 2026-10-24 — validação local, implantação pendente

Os itens marcados possuem evidência local; não equivalem à homologação remota.
Provedor possui contrato e adaptador testados, mas falta implementar/homologar o
serviço de VMs no destino escolhido. Inspeção autorizada encontrou servidor Xen
sem `/dev/kvm`; escolha de outro host/KVM ou piloto por emulação aguarda decisão.
Credenciais remotas recebidas e usadas somente para leitura. Usuário autorizou
gerar novos artefatos; certificado corporativo de assinatura/runner ainda não
localizado. Os Windows anteriores falham na verificação de fingerprint da fonte.

Node24.21 e instalação exata do lock resolvem a limitação inicial de baseline.
Suite completa: 2019 pass,66 opt-in skipped; ensaios reais separados documentados.
Estado Git: LOCAL_WIP. Sem commit/push/merge/tag/release/deploy. Base remota ainda
exige fetch bem-sucedido. Backup atual e ensaio de restore precedem implantação.

## Ampliação autorizada — tenants, laboratório e hosts próprios

O usuário confirmou a atualização da instalação atual para 2.1.0, preservando os
tenants normais/SaaS criados administrativamente, sem perfil de degustação. A flag
controla apenas o onboarding público. Também escolheu hosts de demonstração prontos
e ampliou explicitamente o escopo: o participante pode solicitar máquinas até uma
quantidade configurada e cadastrar hosts próprios, conforme as permissões do perfil.

Foram adicionados `machineCount` (quantidade inicial), `maxMachines`,
`allowCustomHosts` e `maxCustomHosts`, subordinados ao limite total `maxHosts` e às
quotas de sessões existentes. Hosts próprios usam IPv4 público literal, SSH direto
e credenciais próprias por senha ou PEM. A infraestrutura interna e os IPs públicos
do plano de controle permanecem protegidos. Não há criação de VPN para alcançar
redes privadas do cliente.

Para este VPS sem KVM, foi implementado um provisionador Docker separado, com rede
por trial, usuário de demonstração sem privilégios e limites de CPU, memória e
processos. Os containers compartilham o kernel do host; esse isolamento não equivale
ao de uma VM. O provisionador e as políticas de rede exigem homologação no destino
antes da abertura do cadastro. A configuração mantém limites globais conservadores.

O usuário autorizou um certificado privado, com instalação consciente pelos
usuários. A cadeia própria de assinatura de código foi gerada fora do Git. A confiança
no armazenamento Windows CurrentUser foi mantida por decisão explícita posterior,
para testes locais. Os artefatos assinados 2.1.0 passaram na validação; o aplicativo
Windows não foi instalado.

O SMTP foi fornecido em arquivo privado. TLS e autenticação Titan foram verificados,
sem envio de mensagens. A identificação legal da controladora e o canal de privacidade
foram solicitados para publicar o aviso sem inventar dados. O backup de referência
remoto e uma cópia externa privada foram concluídos. O restore em MySQL 8.0 e o clone
em 8.4 com migrações foram verificados; não houve troca do ambiente de produção até
este registro.
