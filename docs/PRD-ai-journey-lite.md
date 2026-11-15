# PRD — Jornada completa de IA e preparação de servidor dedicado

Data: 2026-10-30. Frente: NA-0083. Estado: implementado e validado localmente; homologação/publicação pendentes. Etapa2 do [comparativo e roadmap](PRD-resource-health-and-comparison.md).

## Objetivo

Permitir que o administrador configure uma IA, valide o endpoint/modelo salvo, use assistente e resumo com evidência clara, homologue a configuração e escolha monitorá-la. Avaliar instalação de Ollama em outra máquina com mais capacidade sem misturar inferência, provisionamento e acesso SSH normal.

## Situação encontrada

Já existem formulários de integração, teste com geração curta, assistente, artefatos e jobs de resumo. O teste da integração usa a configuração persistida; rascunhos na tela podem induzir validação aparente de outros valores. A UI de resumo precisa considerar validade e preferência do provider. Scripts existentes de setup e executor de ações SSH não constituem um provisionador durável: downloads longos, desconexão e restart exigem reconciliação e controle próprios.

## Entrega desta frente

| Passo | Comportamento esperado |
|---|---|
| Preparar | Escolher endpoint já disponível ou gerar pacote assistido de instalação Docker para servidor Linux existente |
| Configurar | Informar endpoint/modelo/política, preservar rascunho e explicar o alcance da configuração |
| Salvar | Persistir antes de validar; identificar a revisão efetivamente salva |
| Validar | Testar o provider salvo com geração curta; expirar/invalidate quando configuração mudar; não sobrescrever edição concorrente |
| Usar | Abrir o assistente e auditoria, com ações de resumo coerentes com provider/readiness; fila não significa conclusão |
| Homologar | Administrador confirma explicitamente a revisão testada; sucesso técnico não é homologação humana automática |
| Monitorar | Opt-in separado após homologação, com observação limitada, horários, erros e opção de desligar; sem reparar/reinstalar/reiniciar |

Dados e uso pertencem ao tenant autenticado. Nenhuma credencial deve entrar em scripts, resultados ou logs livres. Falhas de diagnóstico não interrompem o terminal. A implementação da NA-0082 permanece independente; esta frente não presume que ela foi mergeada.

## Instalação pela interface: primeiro corte assistido

A interface gera prévia, script determinístico e manifesto/checksum. Não exige uma IA funcionando nem aceita scripts gerados pelo modelo. O administrador revisa o pacote e o executa na máquina escolhida, podendo usar os fluxos existentes de Hosts/terminal/SFTP do NodeAccess. O pacote não inicia instalação no backend nem envia credenciais a um novo executor.

Hipótese inicial: Linux com Docker já instalado; CPU ou NVIDIA com drivers/toolkit já preparados. O usuário confirmou em 30/10/2026 que ainda não definiu a máquina e solicitou preparar fluxo e plano, sem instalação real. Pré-validações devem conferir ferramentas, arquitetura suportada, espaço/memória, porta, GPU quando selecionada e instalação preexistente. Nenhum pacote deve instalar drivers, reiniciar Docker ou sobrescrever instalação de terceiros automaticamente. Versão/digest da imagem e modelo são explícitos; capacidade indicada é requisito mínimo do plano, não garantia de desempenho.

Usar nomes e labels de recursos gerenciados, exclusão de execução concorrente, etapas identificáveis, tratamento de falha e orientação de recuperação. Não remover volume ou modelos preexistentes como rollback automático. Reinício automático de container não deve surgir como watchdog implícito antes da homologação.

Ollama deve permanecer em loopback por padrão. Para separar IA e aplicação, a configuração no NodeAccess precisa apontar para endpoint privado protegido e alcançável pelo backend, ou futuramente usar transporte SSH gerenciado. `localhost` no servidor remoto não é `localhost` no container da API. Não abrir indiscriminadamente a porta do Ollama.

## Execução automática remota: avaliação e extensão proposta

Faz sentido para usuários com servidor dedicado, porém exige um módulo de provisionamento próprio. Reutilizar cadastro de Hosts e referência a credenciais protegidas; não duplicar senhas/PEM no JSON da integração. Primeiro escopo: host direto, tenant/ACL revalidados, fingerprint confiável; bastion e rotas especiais requerem certificação específica.

Fluxo proposto: destino → preflight somente leitura → plano imutável/hash → confirmação → job durável → SFTP/checksum → execução por etapas → validação local e a partir do backend → aplicação da configuração → homologação → monitoramento opt-in.

Job deve registrar tenant, ator, destino, plano, fase e códigos sanitizados; usar claim/lease/fencing, idempotência e lock remoto. Perda de conexão ou worker durante mutação vira “requer reconciliação”, sem repetir instalação cegamente. Cancelamento solicitado não prova término remoto. API e UI precisam distinguir esses estados e oferecer diagnóstico sem revelar stdout com segredos.

Essa automação SSH não é entregue nesta frente. Não contornar políticas de execução existentes, aumentar timeout arbitrariamente ou apresentar script baixado como instalação realizada. Ela terá plano próprio e testes reais em máquina descartável antes de uso operacional.

## Homologação e watchdog

Homologação vinculada à revisão material da configuração salva e teste recente. Alteração de endpoint/modelo/credencial/política invalida a aprovação pertinente; teste antigo não pode confirmar revisão nova. Monitoramento começa desarmado e exige opt-in posterior à homologação. A UI deve informar frequência e eventual geração sintética/custo antes de ativar.

Worker fora do caminho SSH, apenas no serviço responsável, com limites de concorrência, timeout, exclusão distribuída, backoff e evidências datadas. Revalidar feature/licença e tenant antes de chamadas. Registrar falhas e recuperação sem apresentar dado vencido como saúde atual. Desativar durante teste em andamento não pode ser revertido por resposta atrasada. Monitoramento observa; não instala modelos, reconfigura rede ou reinicia serviços.

## Critérios e validação

Critérios rastreáveis no [plano](changes/2026/10/NA-0083-ai-journey/plan.md). Testar rascunho versus salvo, corrida entre teste/salvamento/homologação, TTL, tenant/role/licença, watchdog desarmado/ativado/desativado, falha e backoff; instalação simulada com Bash e Docker fake, injeção, ownership e preservação; browser desktop/mobile, estados vazios/erro/retry e navegação por teclado. Testes de providers reais ou provisionamento real serão classificados separadamente. Não presumir homologação, publicação ou desempenho medido.

## Fontes técnicas consultadas

A documentação oficial apresenta instalação Docker em CPU e GPU; NVIDIA requer preparação do Container Toolkit. Não assumimos que o provisionador pode alterar drivers de uma máquina em uso. [Ollama Docker](https://docs.ollama.com/docker).

A instalação nativa Linux pode usar serviço systemd e versões específicas; esse modo implica gerenciar binários, usuário e unidade além do modelo, ficando fora do primeiro pacote. [Ollama Linux](https://docs.ollama.com/linux).

A API local do Ollama não exige autenticação; autenticação do serviço cloud não protege automaticamente um listener local publicado. A rede precisa de proteção explícita. [Ollama autenticação](https://docs.ollama.com/api/authentication).

## Pendências operacionais

Escolher máquina/OS/GPU, imagem/modelo compatíveis, capacidade e caminho de rede protegido. Nenhuma instalação na VPS atual foi autorizada por esta implementação. Publicação e homologação das frentes anteriores continuam separadas.

## Contrato operacional implementado

A homologação e o monitor pertencem ao Assistente local (incluindo o provider de rede escolhido nessa configuração). A integração OpenAI dedicada aos resumos mantém seu fluxo próprio de teste; as ações de resumo respeitam provider escolhido e validade. Histórico de uso é mostrado com data e não certifica uma nova revisão. Fatos, hipóteses e referências de comandos do resumo continuam nos campos existentes.

O monitor reserva a cota mensal configurada antes de consultar o provider; esgotamento ou falha de orçamento não gera chamada externa. Verificações sintéticas podem consumir recursos/cobranças e não equivalem a conversas. Solicitam até8 tokens ao Ollama e64 ao provider de rede, preservando defaults das conversas comuns. Intervalo mínimo5min com jitter/backoff, limite30s por verificação e agendamento best-effort; a UI não mantém saúde positiva após a evidência expirar. Desativar não desfaz uma chamada já iniciada, mas resultados antigos são descartados. Não há reinício automático.

Persistência usa metadados no JSON da integração e CAS, sem migração nova. [Evidências](changes/2026/10/NA-0083-ai-journey/test-results.md) e [operação do pacote assistido](OPERATIONS-ai-installation-assisted.md).

## Validação ampliada no WSL — 2026-10-30T10:30:02-03:00

Laboratórios de MySQL/Redis, API/browser e instalação realCPU executados; duas falhas de concorrência/retomada corrigidas. [Procedimento e limites](OPERATIONS-ai-journey-lab.md); [evidências](changes/2026/10/NA-0083-ai-journey/test-results.md). Esta evidência não substitui homologação humana do servidor definitivo.
