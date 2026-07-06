import type { HostAccessProtocol } from '../schemas/host.schema.js'

export type HostProtocolTerminalMode = 'text' | 'graphical' | 'none'

export interface HostAccessProtocolCapabilities {
  terminalMode: HostProtocolTerminalMode
  webTerminalAvailable: boolean
  tcpConnectivityTestAvailable: boolean
  graphicalGatewayPlanned: boolean
  usesSshCredentials: boolean
  supportsSshBastion: boolean
  supportsSshTunnels: boolean
}

export const HOST_ACCESS_PROTOCOL_CAPABILITIES: Record<HostAccessProtocol, HostAccessProtocolCapabilities> = {
  ssh: {
    terminalMode: 'text',
    webTerminalAvailable: true,
    tcpConnectivityTestAvailable: true,
    graphicalGatewayPlanned: false,
    usesSshCredentials: true,
    supportsSshBastion: true,
    supportsSshTunnels: true,
  },
  telnet: {
    terminalMode: 'text',
    webTerminalAvailable: true,
    tcpConnectivityTestAvailable: true,
    graphicalGatewayPlanned: false,
    usesSshCredentials: false,
    supportsSshBastion: false,
    supportsSshTunnels: false,
  },
  rdp: {
    terminalMode: 'graphical',
    webTerminalAvailable: false,
    tcpConnectivityTestAvailable: true,
    graphicalGatewayPlanned: true,
    usesSshCredentials: false,
    supportsSshBastion: false,
    supportsSshTunnels: false,
  },
  vnc: {
    terminalMode: 'graphical',
    webTerminalAvailable: false,
    tcpConnectivityTestAvailable: true,
    graphicalGatewayPlanned: true,
    usesSshCredentials: false,
    supportsSshBastion: false,
    supportsSshTunnels: false,
  },
  serial: {
    terminalMode: 'none',
    webTerminalAvailable: false,
    tcpConnectivityTestAvailable: false,
    graphicalGatewayPlanned: false,
    usesSshCredentials: false,
    supportsSshBastion: false,
    supportsSshTunnels: false,
  },
}

export function normalizeHostAccessProtocol(protocol: HostAccessProtocol | null | undefined): HostAccessProtocol {
  return protocol && protocol in HOST_ACCESS_PROTOCOL_CAPABILITIES ? protocol : 'ssh'
}

export function getHostAccessProtocolCapabilities(protocol: HostAccessProtocol | null | undefined): HostAccessProtocolCapabilities {
  return HOST_ACCESS_PROTOCOL_CAPABILITIES[normalizeHostAccessProtocol(protocol)]
}

export function canOpenInWebTerminal(protocol: HostAccessProtocol | null | undefined): boolean {
  return getHostAccessProtocolCapabilities(protocol).webTerminalAvailable
}

export function canTestHostConnectivity(protocol: HostAccessProtocol | null | undefined): boolean {
  return getHostAccessProtocolCapabilities(protocol).tcpConnectivityTestAvailable
}

export function usesSshCredentials(protocol: HostAccessProtocol | null | undefined): boolean {
  return getHostAccessProtocolCapabilities(protocol).usesSshCredentials
}
