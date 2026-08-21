export type LicenseFeatureKey =
  | 'agents' | 'secrets' | 'snippets' | 'portForwarding' | 'integrations'
  | 'feedback' | 'localAi' | 'terminalAutocomplete' | 'terminalAi' | 'mcp' | 'aiSshActions'

export type LicenseStandaloneKey = 'multiConnect' | 'sessionAudit' | 'sessionAuditAi' | 'auditAiAutoSummary'
export type LicenseModuleKey = LicenseFeatureKey | LicenseStandaloneKey
export type LicenseProviderKey = 'jira' | 'google' | 'ldap' | 'onepassword' | 'oidc' | 'scim'
export type LicenseCategoryKey = 'access' | 'security' | 'productivity' | 'automation'

export interface LicenseCatalogItem<Key extends string = string> {
  key: Key
  label: string
  description: string
  cases: string[]
  dependsOn?: LicenseModuleKey[]
}

export interface LicenseModuleCatalogItem extends LicenseCatalogItem<LicenseModuleKey> {
  category: LicenseCategoryKey
}

export const licenseCategoryLabels: Record<LicenseCategoryKey, string> = {
  access: 'Acesso e conectividade',
  security: 'Segurança e governança',
  productivity: 'Produtividade',
  automation: 'IA e automação',
}

export const licenseModuleCatalog: LicenseModuleCatalogItem[] = [
  { key: 'agents', label: 'Agentes de acesso privado', category: 'access', description: 'Conecta o NodeAccess a redes privadas sem expor o SSH na internet.', cases: ['Acessar servidores em filiais, VPCs e redes internas.', 'Manter hosts privados acessíveis mesmo atrás de NAT.'] },
  { key: 'portForwarding', label: 'Túneis SSH', category: 'access', description: 'Libera encaminhamentos locais e remotos controlados pelo NodeAccess.', cases: ['Acessar bancos de dados internos por uma porta local.', 'Publicar temporariamente um serviço remoto com governança.'] },
  { key: 'multiConnect', label: 'Conexões simultâneas', category: 'access', description: 'Permite abrir e acompanhar mais de uma sessão ao mesmo tempo.', cases: ['Comparar dois servidores lado a lado.', 'Executar uma manutenção acompanhando logs em outro host.'] },
  { key: 'secrets', label: 'Cofre de credenciais', category: 'security', description: 'Armazena e referencia credenciais protegidas sem exibi-las aos operadores.', cases: ['Conectar com senha gerenciada sem revelar seu valor.', 'Reutilizar uma credencial com rotação centralizada.'] },
  { key: 'sessionAudit', label: 'Auditoria de sessões', category: 'security', description: 'Registra evidências e metadados das sessões para investigação e conformidade.', cases: ['Investigar quem acessou um host e quando.', 'Atender trilhas de auditoria e revisões de conformidade.'] },
  { key: 'feedback', label: 'Feedback dos usuários', category: 'security', description: 'Coleta relatos e sugestões dentro da plataforma para acompanhamento administrativo.', cases: ['Receber relatos de falha sem retirar o usuário do fluxo.', 'Priorizar melhorias usando feedback contextualizado.'] },
  { key: 'snippets', label: 'Comandos reutilizáveis', category: 'productivity', description: 'Organiza comandos aprovados para execução consistente e segura.', cases: ['Padronizar diagnósticos recorrentes.', 'Evitar erros de digitação em comandos operacionais.'] },
  { key: 'terminalAutocomplete', label: 'Autocompletar no terminal', category: 'productivity', description: 'Sugere comandos, caminhos e histórico durante a operação.', cases: ['Localizar comandos usados recentemente.', 'Navegar por caminhos remotos com menos digitação.'] },
  { key: 'integrations', label: 'Integrações externas', category: 'productivity', description: 'Habilita conectores licenciados para identidade, credenciais e ferramentas corporativas.', cases: ['Associar operações a chamados do Jira.', 'Usar identidade corporativa e cofres externos.'] },
  { key: 'localAi', label: 'Assistente de IA', category: 'automation', description: 'Habilita recursos de assistência e análise com provedores de IA configurados.', cases: ['Explicar uma falha operacional com contexto.', 'Apoiar o diagnóstico sem entregar o controle da sessão.'] },
  { key: 'terminalAi', label: 'IA no terminal', category: 'automation', description: 'Leva sugestões contextuais do assistente para a experiência do terminal.', cases: ['Explicar a saída de um comando.', 'Sugerir o próximo passo de um diagnóstico.'], dependsOn: ['localAi'] },
  { key: 'aiSshActions', label: 'Ações SSH assistidas por IA', category: 'automation', description: 'Permite propor ações SSH governadas, sempre sujeitas a revisão e políticas.', cases: ['Transformar um diagnóstico em plano revisável.', 'Executar uma ação aprovada com trilha de auditoria.'], dependsOn: ['localAi'] },
  { key: 'sessionAuditAi', label: 'Análise de sessões por IA', category: 'automation', description: 'Analisa evidências de sessão para destacar eventos e riscos relevantes.', cases: ['Encontrar rapidamente comandos relevantes em uma sessão extensa.', 'Apoiar investigações com uma leitura estruturada.'], dependsOn: ['sessionAudit'] },
  { key: 'auditAiAutoSummary', label: 'Resumo automático de sessões', category: 'automation', description: 'Gera automaticamente um resumo depois que uma sessão auditada termina.', cases: ['Entregar uma visão executiva da atividade.', 'Reduzir o tempo de triagem de sessões operacionais.'], dependsOn: ['sessionAudit', 'sessionAuditAi'] },
  { key: 'mcp', label: 'Integração MCP', category: 'automation', description: 'Expõe capacidades governadas do NodeAccess a clientes compatíveis com MCP.', cases: ['Consultar inventário por um assistente autorizado.', 'Integrar automações mantendo escopo e auditoria.'] },
]

export const licenseProviderCatalog: LicenseCatalogItem<LicenseProviderKey>[] = [
  { key: 'jira', label: 'Jira', description: 'Relaciona hosts e operações a chamados e fluxos de trabalho.', cases: ['Abrir um chamado relacionado ao host.', 'Preservar o contexto da mudança operacional.'] },
  { key: 'google', label: 'Google Workspace', description: 'Conecta recursos de identidade e colaboração do Google Workspace.', cases: ['Usar identidades corporativas gerenciadas no Google.', 'Centralizar integrações do ambiente Workspace.'] },
  { key: 'ldap', label: 'LDAP / Active Directory', description: 'Integra autenticação e consulta ao diretório corporativo.', cases: ['Autenticar usuários do Active Directory.', 'Reutilizar o diretório corporativo existente.'] },
  { key: 'onepassword', label: '1Password', description: 'Usa credenciais do cofre no momento da conexão sem copiá-las para a tela.', cases: ['Buscar a senha atual somente ao conectar.', 'Reduzir credenciais duplicadas no inventário.'] },
  { key: 'oidc', label: 'Login corporativo — OIDC', description: 'Habilita SSO com Microsoft Entra ID, Okta e providers compatíveis.', cases: ['Entrar com a conta corporativa.', 'Aplicar MFA e políticas do provedor de identidade.'] },
  { key: 'scim', label: 'Provisionamento SCIM', description: 'Sincroniza o ciclo de vida de usuários a partir do diretório corporativo.', cases: ['Criar usuários automaticamente.', 'Desativar acessos quando uma pessoa sai da empresa.'] },
]

export function moduleDependents(key: LicenseModuleKey): LicenseModuleKey[] {
  return licenseModuleCatalog.filter(item => item.dependsOn?.includes(key)).map(item => item.key)
}

export function moduleByKey(key: LicenseModuleKey) {
  return licenseModuleCatalog.find(item => item.key === key)
}
