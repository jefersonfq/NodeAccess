function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function describeAgentTcpError(error: unknown, host: string, port: number): string {
  const message = errorMessage(error)

  if (message.includes('EACCES')) {
    return `O agente está online, mas a máquina onde ele roda não conseguiu abrir conexão TCP para ${host}:${port} (EACCES). Verifique firewall, antivírus, política de rede/VPN ou permissão de saída para a porta ${port}.`
  }

  if (message.includes('ECONNREFUSED')) {
    return `O agente alcançou ${host}:${port}, mas a conexão foi recusada. Verifique se o SSH está ativo no host e se a porta ${port} está aberta.`
  }

  if (message.includes('ETIMEDOUT')) {
    return `O agente não recebeu resposta de ${host}:${port} dentro do tempo limite. Verifique rota, VPN, firewall e conectividade da máquina do agente até o host.`
  }

  if (message.includes('EHOSTUNREACH') || message.includes('ENETUNREACH')) {
    return `A máquina do agente não tem rota de rede até ${host}:${port}. Verifique VPN, sub-rede, gateway e regras de firewall.`
  }

  return `O agente está online, mas não conseguiu abrir conexão TCP para ${host}:${port}: ${message}`
}
