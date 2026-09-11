# Agentes: preparacao de release e evolucao por plataforma

## Estrutura

- `apps/agent/src`: runtime compartilhado de registro e transporte.
- `apps/agent/installer/platforms.mjs`: contratos explicitos de plataforma, arquitetura, target, binario e manifesto. Atualmente Windows, Linux e macOS x64.
- `apps/agent/installer/branding`: identidade visual compartilhada; logo existente do projeto, SVG do icone e conversoes ICO/BMP para Windows.
- `apps/agent/installer/windows`: MSI e assistente nativos. Linux/macOS continuam com CLI e scripts de instalacao existentes; esta revisao nao cria interfaces graficas nessas plataformas.
- `platform-artifacts.mjs`: proveniencia e integridade dos binarios Unix. O contrato Windows continua em `windows/artifacts.mjs` para preservar os artifacts existentes.

Novos instaladores, arquiteturas ou interfaces devem entrar no contrato de sua
plataforma, reutilizando o runtime e a identidade visual. Nao anunciar plataforma
nova no portal sem artefato publicado, validacao nativa e suporte no backend.

## Build incremental

```bash
npm run build:all -w apps/agent
# Ou, sem npm:
node scripts/release/prepare-agents.mjs
# Somente conferir, sem compilar:
node scripts/release/prepare-agents.mjs --check
```

`build-release.sh` chama a mesma preparacao antes de copiar arquivos ou construir
imagens. Fonte, instalador/branding, versao, lockfile, tamanho e hash sao
conferidos. Se tudo confere, reaproveita. Se faltar artefato ou houver divergencia,
recompila e valida novamente. Os binarios Linux/macOS possuem manifestos e
checksums proprios. O MSI Windows possui manifesto, checksums, verificacao de
versao e capacidades do EXE executado nativamente.

- Windows: usa PowerShell/WiX. Reutiliza as ferramentas isoladas do projeto quando presentes; nao instala ferramentas implicitamente.
- WSL: usa o PowerShell do Windows e converte o caminho do checkout com wslpath.
- Linux/macOS sem Windows: exige artifacts Windows atuais via `AGENT_WINDOWS_ARTIFACTS_DIR` ou `AGENT_WINDOWS_RELEASE_REPO`. Se indisponiveis/desatualizados, para antes de gerar release. Nao e possivel compilar MSI nativamente em Linux sem um host Windows.
- Linux/macOS: gera os targets x64 definidos no contrato via pkg. Execucao nativa no macOS continua responsabilidade do CI macOS.

`validate-agents.mjs` verifica os tres conjuntos no builder Docker, nos arquivos
copiados para a release e nas imagens reaproveitadas para bundle offline.
Nao use apenas o tamanho do arquivo ou a versao do MSI como evidencia de pacote
atualizado. Nao execute dois builds concorrentes sobre o mesmo `dist`.

## Versao e distribuicao

A versao do agente e independente da aplicacao web. Para distribuir mudancas a
usuarios ja instalados, incremente `apps/agent/package.json` e a entrada
`apps/agent` no lockfile antes de gerar o novo pacote (esta revisao: 1.2.0).
Recompilar fontes com a mesma versao detecta os fontes novos, mas nao substitui
a necessidade de incrementar a versao para o fluxo normal de MajorUpgrade MSI.
O build nao altera versoes de fonte silenciosamente.

Os cinco artefatos Windows existentes continuam com os mesmos nomes de build.
O portal usa o nome canonico `nodeaccess-agent-windows-x64.msi`. A release copia
todos os arquivos de `apps/agent/dist`, incluindo os manifestos Unix. O backend
precisa ser reconstruido/distribuido para que a nuvem ofereca o pacote novo.
Nao executar instaladores durante o uso normal do agente nem autoatualizar
maquinas de usuarios apenas porque houve build no servidor.

## Validacao

```bash
node --test apps/agent/installer/windows/artifacts.test.mjs tools/agent/platform-artifacts.test.mjs
node scripts/release/validate-agents.mjs
```

Windows: executar os testes setup, UI, runtime empacotado e lifecycle em CI
Windows descartavel. O teste lifecycle nao deve remover uma instalacao real de
usuario. Instalacao local autorizada usa `tools/windows/update-installed-agent.ps1`.

## Experiencia de configuracao

No portal o token aparece uma vez, com botao de copia. O MSI e a opcao padrao:
baixar, abrir o aplicativo, informar servidor/token e validar. O modo alternativo
`.exe` mostra os comandos completos e opcoes de execucao; esconde o cartao MSI.
Retornar ao instalador esconde comandos e modos de servico. No Linux/macOS o
fluxo continua por terminal. Falha na area de transferencia oferece copia manual.
