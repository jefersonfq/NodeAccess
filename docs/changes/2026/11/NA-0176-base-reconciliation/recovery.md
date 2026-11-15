# Recuperação do histórico local

Os planos, registros Markdown e planilhas foram mantidos no projeto. Capturas e relatórios brutos históricos estão preservados em `.tmp/NA-0175/base-reconciliation/historical-artifacts/`, com caminho original, tamanho e SHA256 no [manifesto](historical-artifacts.json). São artefatos de frentes anteriores, não evidência de entrega da versão atual. Links antigos para esses artefatos requerem recuperação local do caminho original.

Há uma segunda cópia no checkpoint Git local `91fcfd81a3e5c26f4cca0cea4791fc49b4abce48`, mantido também por `backup/NA-0176-canonical-20261115T180624`. Os arquivos originalmente não rastreados estão no terceiro pai (`^3`). Para recuperar um arquivo, ler o blob desse caminho no terceiro pai, comparar seu SHA256 com o manifesto e gravar no destino escolhido. Não aplicar o stash inteiro sobre o código atual: ele contém versões antigas de ferramentas, catálogo e capturas que foram substituídas pelas versões integradas da PR64.

Essas cópias são locais; uma clonagem remota não contém os artefatos arquivados. Preservar o checkpoint e a pasta de arquivo antes de limpar worktrees/stashes. Os arquivos não foram apagados definitivamente nem publicados como evidências atuais. As 19 exceções gitleaks locais pertenciam somente aos relatórios arquivados; a lista ativa voltou à baseline já validada, sem acrescentar permissões.
