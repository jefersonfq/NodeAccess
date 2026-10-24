# Agente Windows 2.1.0 — evidência de build

Data: 2026-10-24, America/Sao_Paulo. Build nativo isolado, sem instalação do aplicativo e sem publicação.

## Resultado

O script oficial `apps/agent/installer/windows/build-msi.ps1 -Version 2.1.0` gerou EXE, aplicativo da bandeja e MSI com Authenticode `Valid`, editor esperado e timestamp DigiCert. O manifesto Windows recebeu assinatura RSA e foi importado no checkout Linux pelo script oficial `scripts/release/prepare-agent-windows.mjs`, validando assinatura, checksums e identidade dos fontes. Os seis arquivos distribuíveis estão em `apps/agent/dist` (ignorados pelo Git).

- MSI SHA-256: `6077afde0e3cda1a4982b7f48ff1a26610a512d84cb3268d4969210abb279571`.
- EXE SHA-256: `03e35fc02c1c7f826ff84ce9e794ef9efc42b7852a41f226837366b49c6e1ea5`.
- Identidade dos fontes: `5f660f7d2c8340d9d18fed04d85ceab3f7ab906a889ca57510b4f0ce8c74b46a`.
- ProductVersion do MSI: `2.1.0`, inspecionado pelo Windows Installer COM em modo somente leitura.
- UpgradeCode preservado: `{A47A66E8-5B1A-4C44-9F34-1A7036AAE786}`.

## Ferramentas e verificações

Node Windows 24.21.0; `npm ci --workspace=@nodeaccess/agent --include-workspace-root=false` com lock atual; WiX isolado preexistente; Microsoft Windows SDK BuildTools NuGet `10.0.26100.9169`, obtido do endpoint oficial e com assinatura Microsoft do signtool verificada. SHA-256 do NuGet: `6000c971fc9155052a8359779b30b6682c39e091664d83b3852c4702ab6d238e`.

A versão do pacote e a entrada correspondente no lock passaram para 2.1.0. O build executou o EXE para conferir versão e argumentos seguros. A identidade de fontes agora inclui `packages/shared/src/data/agent-diagnostics.json`, dependência efetiva do agente; o mesmo digest é usado para Linux/macOS. Testes dos artefatos e empacotamento: 18/18. Testes de segurança do agente: 19/19.

## Certificados próprios e decisão de confiança

A cadeia privada contém raiz CA e editor de assinatura de código, com uma única extensão BasicConstraints correta em cada certificado. O build inicial rejeitou o certificado com extensões conflitantes; a verificação nunca foi desativada. O checkout mínimo também precisou incluir o JSON compartilhado requerido em runtime antes de o EXE passar na verificação de versão.

- Raiz pública SHA-256: `934A64AC01794E620B0EE8CB7EF80DF22749D4C9D7D2A83957969E077CF2A4CF`.
- Editor público SHA-256: `F4C7EBE0C2526F06E35AB443AF181407FABD948CD1DBF268556A2B40CE7849C1`.
- Entrada CurrentUser/Root: `0D4C731B05A818F353131304A3733F1F0EEA9910` (thumbprint SHA-1).
- Entrada CurrentUser/TrustedPublisher: `76B76E2F9B54ACFA058E550BAD90A6E22E330339` (thumbprint SHA-1 do editor esperado).

O usuário confirmou os diálogos do Windows. Após o build, cancelou a remoção da confiança e depois decidiu explicitamente **manter para instalar e testar localmente**. Essas duas entradas públicas de CurrentUser foram preservadas conforme a decisão; LocalMachine não foi modificado. Nenhum instalador foi executado. Não há instalação automática de confiança pelo produto.

As cópias temporárias de PFX, senha e chave de assinatura foram mantidas fora do checkout com ACL restrita ao usuário de build e depois apagadas. Os originais permanecem no armazenamento privado do responsável. Somente CERs públicos e instruções/fingerprints foram colocados em Downloads. Nenhum segredo consta do repositório, pacote ou desta evidência.

Certificado próprio não possui reputação de CA pública/SmartScreen; confiança e instalação devem ser conscientes e respeitar políticas da organização. Mesmo artefato atende instalações normais e instalações com degustação.

Evidências locais: `/tmp/na0068-windows-build.log`, `/tmp/na0068-msi-properties.json`, `/tmp/na0068-agent-artifacts-tests.log`, `/tmp/na0068-agent-security.log`; `signature-evidence.json` no checkout Windows isolado. Houve rejeição automática de uma proposta ampla de cleanup; a limpeza foi limitada aos PIDs e cópias temporárias identificados, sem remover confiança preexistente.
