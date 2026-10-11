export interface ConnectionDiagnostic { stage: string; cause: string; action: string }
const entry = (stage: string, cause: string, action: string): ConnectionDiagnostic => ({stage, cause, action})
const diagnostics: Record<string, ConnectionDiagnostic> = {
  DNS_FAILED: entry('Resolução do destino', 'O nome do host não pôde ser resolvido.', 'Confira o nome cadastrado e peça ao administrador para verificar o DNS na máquina que realiza o acesso.'),
  HOST_PORT_REFUSED: entry('Acesso à porta do destino', 'A conexão à porta foi recusada.', 'Confira a porta cadastrada. O administrador do destino deve verificar se o serviço está ativo e se há bloqueio de acesso.'),
  HOST_UNREACHABLE: entry('Acesso ao destino', 'O destino não respondeu dentro do prazo.', 'Confira o endereço e a rota de acesso. Rede, firewall ou indisponibilidade do servidor são possibilidades; este evento não distingue entre elas.'),
  AUTH_FAILED: entry('Autenticação no destino', 'O servidor recusou a autenticação.', 'Confira o usuário e a credencial associada ao host. Solicite revisão das permissões e dos métodos aceitos pelo servidor.'),
  SSH_HANDSHAKE_TIMEOUT: entry('Negociação SSH', 'A negociação SSH não foi concluída.', 'Confira se a porta oferece SSH e solicite verificação do serviço remoto. O evento não confirma se a causa é carga, rede ou configuração.'),
  BASTION_DNS_FAILED: entry('Resolução do bastion', 'O nome do bastion não pôde ser resolvido.', 'Confira o endereço do bastion e o DNS da origem do acesso.'),
  BASTION_PORT_REFUSED: entry('Acesso ao bastion', 'A porta do bastion recusou a conexão.', 'Confira a porta e o serviço SSH do bastion antes de alterar o host de destino.'),
  BASTION_UNREACHABLE: entry('Acesso ao bastion', 'O bastion não respondeu dentro do prazo.', 'Solicite verificação da rota, disponibilidade e regras de acesso ao bastion.'),
  BASTION_AUTH_FAILED: entry('Autenticação no bastion', 'A autenticação no bastion foi recusada.', 'Revise as credenciais do bastion, que podem ser diferentes das credenciais do destino.'),
  BASTION_CONNECT_FAILED: entry('Conexão ao bastion', 'Não foi possível estabelecer a conexão ao bastion.', 'Encaminhe a referência ao suporte para consultar os registros. O evento não identifica uma causa mais específica.'),
  AGENT_REQUIRED: entry('Disponibilidade do agente', 'Nenhum agente elegível está disponível para este acesso.', 'Confira os agentes online e o escopo de acesso configurado para este host.'),
  AGENT_REQUIRED_USER: entry('Disponibilidade do agente pessoal', 'Este acesso exige seu agente pessoal online.', 'Inicie seu agente pessoal e confira seu estado na página Agentes.'),
  PRIVATE_ACCESS_CONNECTOR_REQUIRED: entry('Conector de acesso privado', 'Não há conector disponível dentro do escopo exigido.', 'Solicite ao administrador a verificação do conector e do escopo configurado.'),
  AGENT_ACCESS_DENIED: entry('Autorização pelo agente', 'O agente recusou a autorização deste acesso.', 'Peça ao administrador para revisar a política do agente e as permissões do destino.'),
  AGENT_CONNECT_FAILED: entry('Acesso pelo agente', 'O agente não conseguiu concluir o acesso ao destino.', 'Verifique a conectividade a partir da máquina do agente. Consulte os registros para identificar a causa específica.'),
  CREDENTIAL_ERROR: entry('Obtenção da credencial', 'A credencial necessária não pôde ser obtida.', 'Solicite revisão da referência, das permissões do cofre e da disponibilidade do provedor. Não envie senhas ou chaves ao suporte.'),
  CREDENTIALS_TIMEOUT: entry('Fornecimento da credencial', 'O prazo para informar a credencial terminou.', 'Inicie uma nova tentativa e preencha a solicitação de credenciais quando ela aparecer.'),
  SSH_INPUT_BLOCKED: entry('Política de comandos', 'Uma entrada foi bloqueada pela política de acesso.', 'Revise a operação com o administrador. Reconectar não remove essa restrição.'),
}
export function connectionDiagnostic(code: string | null, closedReason?: string | null): ConnectionDiagnostic {
  if (code && Object.prototype.hasOwnProperty.call(diagnostics, code)) return diagnostics[code]
  if (!code && closedReason === 'socket') return entry('Comunicação com NodeAccess', 'O canal entre o navegador e o gateway foi interrompido sem informar a causa remota.', 'Confira sua conexão com o NodeAccess. Se persistir, envie a referência ao suporte. Não é possível concluir que houve falha de senha ou do host.')
  return entry('Etapa não informada', 'O acesso apresentou uma falha sem diagnóstico específico neste evento.', 'Envie a referência ao suporte para consultar os registros da instalação. Evite alterar credenciais ou firewall sem confirmar a causa.')
}
export function diagnosticReference(hostId: number, sessionId: number | null, code: string | null, time: string): string {
  const safeCode = code && /^[A-Z][A-Z0-9_]{0,79}$/.test(code) ? code : 'SEM_CODIGO'
  return `NodeAccess | Host ID: ${hostId} | Sessão: ${sessionId ?? 'não informada'} | Código: ${safeCode} | Observado em: ${time}`
}
