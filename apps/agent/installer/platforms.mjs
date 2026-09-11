// Platform packaging contracts. Runtime and branding are shared; installers stay platform-specific.
export const platforms = Object.freeze({
  windows: { architecture: 'x64', target: 'node24-win-x64', binary: 'nodeaccess-agent-win.exe', installer: 'nodeaccess-agent-windows-x64.msi', manifest: 'nodeaccess-agent-windows-x64.json' },
  linux: { architecture: 'x64', target: 'node24-linux-x64', binary: 'nodeaccess-agent-linux', manifest: 'nodeaccess-agent-linux-x64.json' },
  macos: { architecture: 'x64', target: 'node24-macos-x64', binary: 'nodeaccess-agent-macos', manifest: 'nodeaccess-agent-macos-x64.json' },
})
