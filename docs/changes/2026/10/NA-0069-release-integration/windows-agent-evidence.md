# NA-0069 — Agente Windows reconstruído

Data: 2026-10-24T14:49:14-03:00. Base: `4e1b47f344f0e829b445254e4be2047da88eeeae`.

Após a atualização de dependências/lockfile pelo agente principal, fontes do agente, catálogo compartilhado e manifests foram sincronizados no checkout Windows isolado. `npm ci --workspace=@nodeaccess/agent --include-workspace-root=false` passou com Node 24.21.0; o build utilizou pkg 6.23.0 e o script oficial `apps/agent/installer/windows/build-msi.ps1`, sem alterações nos validadores.

EXE, aplicativo de bandeja e MSI tiveram Authenticode `Valid`, com editor `NodeAccess Private Publisher / Clavinci Tecnologia`, thumbprint `76B76E2F9B54ACFA058E550BAD90A6E22E330339` e timestamp DigiCert. A confiança CurrentUser previamente mantida por decisão explícita do usuário foi preservada; não houve importação/remoção de certificados nem alteração de LocalMachine. Cópias temporárias de material privado ficaram em diretório com ACL restrita e foram removidas no finally; ausência do diretório confirmada. Os originais privados não foram alterados.

| Artefato | SHA-256 |
| --- | --- |
| nodeaccess-agent-win.exe | aeb4a4260d339f3da32f88cc0465d6c210a7353f2c320cf2c4a151e7d7868395 |
| nodeaccess-desktop.exe | 6d75e8f75dbf94344b55221fe9841d9988982f3ff6627df88fdbabb00d989567 |
| nodeaccess-agent-windows-x64.msi | 1032e1be6125ecb84ff1b5fa55046c70a1e61e641ce32f13a7fd58b59e08cd02 |

O script validou versão/help do EXE. Inspeção somente leitura do MSI confirmou ProductVersion 2.1.0, ProductCode `{6EC0F3DA-CCEC-41F2-BBAD-52EC0064B1A4}` e UpgradeCode preservado `{A47A66E8-5B1A-4C44-9F34-1A7036AAE786}`.

`scripts/release/prepare-agent-windows.mjs` importou os seis arquivos de distribuição em `apps/agent/dist`, verificando assinatura do manifesto, checksums e fingerprint das fontes/lockfile atuais: `fd4c48a0bd704742aa33466a9387818e7bb3370f9782ef208bc8f4fceb9624df`.

Limites: certificado próprio, sem reputação pública garantida e sem instalação automática de confiança no consumidor. Nenhum MSI foi instalado, publicado ou implantado por esta etapa. Um novo lockfile ou mudança nas fontes cobertas exige nova reconstrução. Pacote completo, assinatura Linux/macOS, commit e implantação permanecem sob responsabilidade da frente principal.
