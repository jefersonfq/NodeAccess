# Correções SFTP — 03/10/2026

Aplicação das correções reproduzidas na [revisão ponta a ponta](2026-10-03-sftp-end-to-end.md). O relatório original e suas evidências registram o comportamento anterior.

## Correções verificadas

| Problema | Comportamento após a correção |
| --- | --- |
| Criação de pasta enviava caminho na query | Serviço envia `path` no corpo, incluindo o contexto da sessão. |
| Leitura com primeiro bloco de exatamente 1 MiB ignorava a cauda | Arquivo maior é marcado como truncado; editor impede salvar conteúdo incompleto. |
| Diff expunha valores JSON e segredos com espaços | Valores sensíveis são mascarados; estruturas sensíveis multilinha suprimem a prévia. |
| Erro de navegação mantinha arquivos do caminho anterior | Lista é limpa, erro aparece junto ao caminho atual e oferece nova tentativa. |
| Resposta atrasada substituía uma navegação mais recente | Resultados são vinculados à navegação e à conexão; respostas antigas são descartadas. |
| Erro JSON de download chegava como Blob | Mensagem específica é recuperada com validação e fallback seguro. |
| Árvore ocupava painel estreito e ações dependiam de clique direito | Árvore recolhível, tabela rolável, menu explícito, linhas e formulários operáveis por teclado. |
| Backup/restauração ampliava permissões de arquivo privado | Novos backups e temporários nascem com modo `0600`, com criação exclusiva. Restauração preserva os metadados do destino e aplica a política do tenant antes da substituição. |

Também foram protegidos uploads e operações de criação/renomeação contra troca de conexão durante a requisição, e o editor descarta inicialização assíncrona após fechamento. O manual descreve os novos controles, recuperação de erros, arquivos truncados e permissões.

## Validação

- 218 testes unitários/regressões aprovados. Os seis testes reais são opt-in e aparecem como ignorados nessa execução; não foram contados como aprovados.
- Seis testes adicionais aprovados contra OpenSSH descartável, incluindo operações reais, backups/restauração `0600`, política de preservação e interação de navegador com o serviço real.
- Playwright: criação, navegação negada, respostas fora de ordem, erro de download, mobile/teclado e configurações com sucesso/falha.
- Chromium CDP: fluxos SFTP, matriz de acesso à auditoria e restauração; nenhum erro de página ou falha funcional. Houve aviso de navegação quente de 3,142 s no ambiente local sob carga concorrente; não constitui diagnóstico de desempenho de produção.
- Regressão completa `test:terminal-experience:web`, testes do manual (18 testes e duas verificações do compilador), capturas dos cinco capítulos e typechecks de frontend/backend.
- Evidências consolidadas em [evidence/2026-10-03-sftp-fixes](evidence/2026-10-03-sftp-fixes/).

## Limites

Não houve implantação nem acesso a produção. ACLs, configurações e persistência de auditoria usam fixtures nos cenários simulados; não se certificou uma instalação com banco real. Não houve mudança no transporte SSH/WebSocket ou resize remoto. As proteções de backup e de conteúdo de auditoria valem para novas operações; arquivos e registros históricos não foram alterados.
