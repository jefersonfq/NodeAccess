import type { ExtensionFailure } from '../core/client'

interface Messages {
  intro: string; connect: string; connecting: string; disconnect: string; search: string; kind: string; all: string
  compare: string; secret: string; pem: string; personal: string; shared: string; recents: string; empty: string; open: string; more: string
  subtitle: string; connected: string; items: string; footer: string; device: string; deviceTitle: string; updateAvailable: string; update: string; searchHint: string; codeIntro: string; codeLabel: string; codeSubmit: string; usePortal: string
  reveal: string; copy: string; hide: string; proofReveal: string; proofCopy: string; proofSubmit: string; cancel: string; copyConfirm: string; copied: string
  errors: Record<ExtensionFailure | 'trustEnded', string>
}
const pt: Messages = {
  intro: 'Conecte ao NodeAccess para buscar seus itens do cofre. Nenhum valor secreto é trazido para a extensão.',
  connect: 'Conectar ao NodeAccess', connecting: 'Aguardando confirmação no portal…', disconnect: 'Desconectar',
  compare: 'Confira se o portal mostra este mesmo código de dispositivo:',
  search: 'Buscar itens', kind: 'Tipo', all: 'Todos', secret: 'Secret', pem: 'Chave PEM', personal: 'Pessoal', shared: 'Compartilhado',
  recents: 'Recentes', empty: 'Nenhum item encontrado.', open: 'Abrir no portal', more: 'Carregar mais',
  subtitle: 'Cofre NodeAccess', connected: 'Conectado', items: 'Itens', footer: 'Valores protegidos pelo cofre do NodeAccess.', device: 'Dispositivo', deviceTitle: 'Identificação deste navegador. A mesma aparece em Dispositivos conectados, no VaultNAccess do portal.', updateAvailable: 'Nova versão da extensão disponível.', update: 'Atualizar', searchHint: 'Buscar itens (/)', codeIntro: 'Este navegador já foi autorizado. Para reconectar, digite o código do seu autenticador.', codeLabel: 'Código do autenticador (6 dígitos)', codeSubmit: 'Reconectar', usePortal: 'Autorizar pelo portal', reveal: 'Revelar senha', copy: 'Copiar senha', hide: 'Ocultar', proofReveal: 'Código do autenticador para revelar', proofCopy: 'Código do autenticador para copiar', proofSubmit: 'Confirmar', cancel: 'Cancelar', copyConfirm: 'Confirmar cópia', copied: 'Senha copiada. Gerencie a área de transferência do seu dispositivo.',
  errors: {
    denied: 'Sem permissão para usar a extensão. Fale com os gestores do cofre.', cancelled: 'Conexão cancelada.',
    expired: 'A conexão expirou. Conecte novamente.', upgrade: 'Atualize a extensão para continuar.',
    unavailable: 'NodeAccess indisponível. Tente novamente.', offline: 'Não foi possível conectar ao NodeAccess. Verifique se o portal está no ar e tente novamente.', reauthRequired: 'Digite o código do autenticador para reconectar.', proofRequired: 'Confirme com o código do autenticador.', itemDenied: 'Este item não está liberado para esta ação, ou falta a permissão. Fale com os gestores do cofre.', quota: 'Limite de tentativas atingido. Aguarde um pouco e tente de novo.', otpInvalid: 'Código incorreto. Confira o código do autenticador e tente de novo.', trustEnded: 'Este navegador precisa ser autorizado de novo pelo portal.', invalid: 'Resposta inválida do portal. Conecte novamente.',
  },
}
const en: Messages = {
  intro: 'Connect to NodeAccess to search your vault items. No secret value is ever brought into the extension.',
  connect: 'Connect to NodeAccess', connecting: 'Waiting for confirmation in the portal…', disconnect: 'Disconnect',
  compare: 'Check that the portal shows this same device code:',
  search: 'Search items', kind: 'Type', all: 'All', secret: 'Secret', pem: 'PEM key', personal: 'Personal', shared: 'Shared',
  recents: 'Recent', empty: 'No items found.', open: 'Open in portal', more: 'Load more',
  subtitle: 'NodeAccess vault', connected: 'Connected', items: 'Items', footer: 'Values protected by the NodeAccess vault.', device: 'Device', deviceTitle: 'Identifier of this browser. The same one is shown in Connected devices, in the portal VaultNAccess.', updateAvailable: 'A new extension version is available.', update: 'Update', searchHint: 'Search items (/)', codeIntro: 'This browser was already authorized. To reconnect, enter your authenticator code.', codeLabel: 'Authenticator code (6 digits)', codeSubmit: 'Reconnect', usePortal: 'Authorize in the portal', reveal: 'Reveal password', copy: 'Copy password', hide: 'Hide', proofReveal: 'Authenticator code to reveal', proofCopy: 'Authenticator code to copy', proofSubmit: 'Confirm', cancel: 'Cancel', copyConfirm: 'Confirm copy', copied: 'Password copied. Manage your device clipboard.',
  errors: {
    denied: 'You are not allowed to use the extension. Ask the vault managers.', cancelled: 'Connection cancelled.',
    expired: 'The connection expired. Connect again.', upgrade: 'Update the extension to continue.',
    unavailable: 'NodeAccess unavailable. Try again.', offline: 'Could not reach NodeAccess. Check that the portal is up and try again.', reauthRequired: 'Enter your authenticator code to reconnect.', proofRequired: 'Confirm with your authenticator code.', itemDenied: 'This item is not released for this action, or the permission is missing. Ask the vault managers.', quota: 'Too many attempts. Wait a little and try again.', otpInvalid: 'Wrong code. Check your authenticator code and try again.', trustEnded: 'This browser needs to be authorized again in the portal.', invalid: 'Invalid answer from the portal. Connect again.',
  },
}
export function message(language: string): Messages { return language.toLowerCase().startsWith('pt') ? pt : en }
