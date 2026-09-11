# Cobertura ISO/IEC 27001:2022 do NodeAccess

## Objetivo e limite desta análise

Este documento apresenta uma análise preliminar de como o NodeAccess apoia a
ISO/IEC 27001:2022 e quais lacunas ainda existem no produto.

O NodeAccess não certifica uma organização isoladamente. A ISO/IEC 27001 avalia
o Sistema de Gestão de Segurança da Informação (SGSI), incluindo pessoas,
processos, riscos, fornecedores, ambiente físico e tecnologia. O produto
fornece controles e evidências que podem apoiar o SGSI.

Esta análise foi produzida a partir das funcionalidades e da documentação
atuais do projeto. Ela não substitui auditoria independente, avaliação de
riscos ou Declaração de Aplicabilidade (SoA).

Referências:

- [Família ISO/IEC 27000](https://www.iso.org/standard/iso-iec-27000-family)
- [ISO/IEC 27002:2022](https://www.iso.org/standard/75652.html)
- [Orientação sobre a Declaração de Aplicabilidade](https://committee.iso.org/files/live/sites/jtc1sc27/files/resources/ISO-IECJTC1-SC27-WG1_N3298_Auditing%20Practices%20Note%20-%20SoA.pdf)

## Cobertura atual relevante

O NodeAccess já apoia controles tecnológicos importantes:

- MFA, OIDC, SCIM, login local emergencial e ciclo de vida de sessões;
- RBAC, grupos, ACL por inventário e isolamento por tenant;
- acesso JIT e compartilhamento temporário;
- auditoria administrativa, de autenticação e de sessões SSH;
- proteção de PEM, passwords, secrets e configurações sensíveis;
- host key trust e histórico de fingerprints;
- bastions, agentes e conectores para redes privadas;
- políticas de comandos e aprovação para ações automatizadas;
- backups, restore, HA, health checks e observabilidade;
- webhooks assinados e integração com JIRA;
- rate limit, bloqueio de contas e revogação de sessões;
- OIDC com PKCE e validação de issuer, audience, nonce e JWKS.

Essas capacidades apoiam gestão de identidade, autenticação segura,
direitos de acesso, acesso privilegiado, logging, monitoramento, criptografia e
continuidade. A aplicabilidade efetiva depende da configuração e da operação
realizadas pelo cliente.

## Principais lacunas de produto

| Lacuna | Relação aproximada com o Anexo A | Prioridade |
|---|---|---|
| Campanhas de revisão periódica de acesso | A.5.18 | Alta |
| Segregação de funções e dupla aprovação | A.5.3 e A.8.2 | Alta |
| Auditoria imutável e retenção governada | A.5.33 e A.8.15 | Alta |
| Exportação padronizada para SIEM | A.8.15 e A.8.16 | Alta |
| Rotação automatizada de credenciais privilegiadas | A.5.16, A.8.2 e A.8.24 | Alta |
| Gestão de vulnerabilidades do produto | A.8.8 | Alta |
| SBOM, assinatura e proveniência das releases | A.5.21 e A.8.25 a A.8.31 | Alta |
| Política de retenção e eliminação de dados | A.8.10 | Média/alta |
| KMS ou HSM externo para chaves mestras | A.8.24 | Média/alta |
| Evidência contínua de backup e recuperação | A.5.30 e A.8.13 | Média |
| Inspeção de malware em transferências | A.8.7 | Média |
| Validação e alerta de sincronismo de relógio | A.8.17 | Média |
| Classificação formal de ativos e informações | A.5.12 e A.5.13 | Média |
| Gestão completa de incidentes | A.5.24 a A.5.28 | Integração externa |

Os identificadores acima servem como orientação de mapeamento. A inclusão
final de cada controle deve decorrer da avaliação de riscos e da SoA da
organização.

### 1. Revisão e recertificação de acessos

O produto controla usuários, grupos, ACLs, permissões e hosts, mas ainda não
possui um processo formal de revisão periódica com:

- campanhas trimestrais, semestrais ou sob demanda;
- confirmação ou revogação pelo gestor;
- justificativa e prazo;
- lembretes e escalonamento;
- expiração de acessos não revisados;
- evidência exportável;
- comparação entre acesso anterior e atual.

### 2. Segregação de funções

As aprovações existentes não formam ainda uma política abrangente de
segregação. Evoluções recomendadas:

- impedir que o solicitante aprove o próprio acesso;
- exigir dupla aprovação para ambientes críticos;
- revisar mudanças sensíveis de ACL;
- separar cadastro, liberação e utilização de credenciais;
- exigir justificativa e revisão posterior de break-glass.

### 3. Auditoria imutável

Para evidência de maior robustez, ainda são recomendados:

- encadeamento criptográfico dos registros;
- assinatura ou checksum por lote;
- armazenamento WORM ou Object Lock;
- retenção por tipo de evento;
- legal hold;
- prova verificável de integridade;
- alerta para interrupção da coleta;
- separação entre administrador operacional e administrador da auditoria.

### 4. Integração com SIEM

Os webhooks atuais ajudam na integração, mas faltam formatos e transportes
usuais de segurança:

- Syslog com TLS;
- CEF ou ECS;
- conectores para Splunk, Elastic, Sentinel e QRadar;
- fila persistente, retry e dead-letter;
- painel de saúde e teste de envio;
- catálogo de eventos de segurança documentado e versionado.

### 5. Ciclo de vida de credenciais privilegiadas

O NodeAccess protege e referencia credenciais, mas ainda não oferece todo o
ciclo de um PAM completo:

- rotação automática após uso;
- credencial temporária por sessão;
- checkout e check-in;
- reconciliação;
- descoberta de contas privilegiadas;
- detecção de credenciais compartilhadas ou sem rotação;
- políticas diferentes por criticidade.

A integração com provedores como 1Password reduz essa lacuna, mas divide a
responsabilidade e as evidências entre os produtos.

### 6. Gestão de chaves criptográficas

A criptografia baseada em chave de instalação pode evoluir para:

- AWS KMS, Azure Key Vault, GCP KMS ou Vault Transit;
- rotação online da chave mestra;
- identificação de versão da chave;
- recriptografia controlada;
- trilha de uso e separação de responsabilidade;
- alerta de material cifrado com chave antiga;
- HSM opcional.

### 7. Retenção e eliminação

Ainda falta uma política central para sessões, comandos, auditorias, logs,
dados pessoais, anexos, avatares, backups e eventos de integração. A
administração deveria permitir definir retenção, visualizar impacto,
preservar registros sujeitos a obrigação e executar eliminação auditada.

### 8. Vulnerabilidades e supply chain

Os testes e gates atuais podem ser complementados com evidências contínuas de:

- SAST e dependency scanning;
- secret scanning;
- varredura de imagens de container;
- DAST;
- SBOM CycloneDX ou SPDX;
- assinatura de imagens;
- proveniência da build;
- política de severidade e SLA de correção;
- relatório de vulnerabilidades por release.

### 9. Inspeção de transferências SFTP

Para ambientes mais restritivos, o fluxo de arquivos pode integrar:

- antivírus ou ICAP;
- quarentena;
- bloqueio por extensão, MIME ou tamanho;
- hash do arquivo;
- registro do resultado da inspeção;
- DLP opcional;
- política diferente por host ou pasta.

### 10. Sincronismo de relógio

OIDC, expiração e auditoria dependem de horários confiáveis. O produto
poderia medir desvio, exibir estado NTP, alertar sobre clock drift e registrar
a origem temporal das evidências.

### 11. Classificação de ativos e informações

Pastas, grupos e tags podem evoluir para uma classificação formal contendo:

- confidencialidade e criticidade;
- ambiente produtivo ou não produtivo;
- proprietário e revisor do ativo;
- validade de acesso;
- gravação obrigatória;
- aprovação exigida;
- requisitos mínimos derivados da classificação.

## Responsabilidades que permanecem na organização

O NodeAccess pode apoiar e armazenar evidências, mas não substitui:

- definição de escopo e contexto do SGSI;
- política de segurança;
- avaliação e tratamento de riscos;
- Declaração de Aplicabilidade;
- objetivos e indicadores do SGSI;
- treinamento e conscientização;
- screening e processo disciplinar;
- contratos e acordos de confidencialidade;
- gestão de fornecedores;
- segurança física;
- inventário completo de ativos da organização;
- plano corporativo de resposta a incidentes;
- requisitos legais, regulatórios e contratuais;
- auditoria interna;
- análise crítica pela direção;
- ações corretivas e melhoria contínua.

Mesmo quando um controle é executado por um fornecedor, a organização
continua responsável por tratá-lo na avaliação de riscos e na SoA.

## Priorização recomendada

1. Revisão e recertificação periódica de acessos.
2. Auditoria imutável, retenção e exportação para SIEM.
3. Dupla aprovação e segregação de funções.
4. SBOM, assinatura de imagens e scanning contínuo.
5. KMS ou Vault para proteção da chave mestra.
6. Classificação e criticidade dos hosts.
7. Rotação de credenciais por integração.
8. Evidências automáticas de backup e recuperação.
9. Malware scanning e DLP no SFTP.
10. Painel de evidências para auditoria ISO.

## Posicionamento recomendado

Evitar afirmar que o NodeAccess, isoladamente, atende ou certifica a
ISO/IEC 27001. A formulação recomendada é:

> O NodeAccess fornece controles e evidências que apoiam o SGSI e a
> conformidade com a ISO/IEC 27001:2022.
