import type { ExtensionFailure } from '../core/client'

interface Messages {
  intro: string; connect: string; connecting: string; disconnect: string; search: string; kind: string; all: string
  compare: string; secret: string; pem: string; personal: string; shared: string; recents: string; empty: string; open: string; more: string
  subtitle: string; connected: string; items: string; footer: string
  errors: Record<ExtensionFailure, string>
}
const pt: Messages = {
  intro: 'Conecte ao NodeAccess para buscar seus itens do cofre. Nenhum valor secreto é trazido para a extensão.',
  connect: 'Conectar ao NodeAccess', connecting: 'Aguardando confirmação no portal…', disconnect: 'Desconectar',
  compare: 'Confira se o portal mostra este mesmo código de dispositivo:',
  search: 'Buscar itens', kind: 'Tipo', all: 'Todos', secret: 'Secret', pem: 'Chave PEM', personal: 'Pessoal', shared: 'Compartilhado',
  recents: 'Recentes', empty: 'Nenhum item encontrado.', open: 'Abrir no portal', more: 'Carregar mais',
  subtitle: 'Cofre NodeAccess', connected: 'Conectado', items: 'Itens', footer: 'Valores secretos ficam no portal.',
  errors: {
    denied: 'Sem permissão para usar a extensão. Fale com os gestores do cofre.', cancelled: 'Conexão cancelada.',
    expired: 'A conexão expirou. Conecte novamente.', upgrade: 'Atualize a extensão para continuar.',
    unavailable: 'NodeAccess indisponível. Tente novamente.', invalid: 'Resposta inválida do portal. Conecte novamente.',
  },
}
const en: Messages = {
  intro: 'Connect to NodeAccess to search your vault items. No secret value is ever brought into the extension.',
  connect: 'Connect to NodeAccess', connecting: 'Waiting for confirmation in the portal…', disconnect: 'Disconnect',
  compare: 'Check that the portal shows this same device code:',
  search: 'Search items', kind: 'Type', all: 'All', secret: 'Secret', pem: 'PEM key', personal: 'Personal', shared: 'Shared',
  recents: 'Recent', empty: 'No items found.', open: 'Open in portal', more: 'Load more',
  subtitle: 'NodeAccess vault', connected: 'Connected', items: 'Items', footer: 'Secret values stay in the portal.',
  errors: {
    denied: 'You are not allowed to use the extension. Ask the vault managers.', cancelled: 'Connection cancelled.',
    expired: 'The connection expired. Connect again.', upgrade: 'Update the extension to continue.',
    unavailable: 'NodeAccess unavailable. Try again.', invalid: 'Invalid answer from the portal. Connect again.',
  },
}
export function message(language: string): Messages { return language.toLowerCase().startsWith('pt') ? pt : en }
