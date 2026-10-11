# Destaques configuráveis do terminal

## Objetivo

Permitir que usuários reconheçam mensagens operacionais importantes na saída SSH sem alterar os bytes recebidos, a cópia ou a auditoria.

## Regras

- nenhuma regra é criada ou ativada por padrão;
- regras podem ser pessoais ou vir de templates atribuídos por usuário ou grupo;
- texto literal, curinga e regex são suportados, com validação e limites;
- a prévia usa o mesmo motor do terminal;
- programas em buffer alternativo, como `vim` e `htop`, não recebem decorações;
- o terminal oferece legenda, origem, isolamento visual e busca pela regra;
- templates têm duplicação, histórico restaurável e atribuição por grupos;
- métricas administrativas mostram adoção, custo e recomendações;
- telemetria barata é descartada e não adiciona sondagens ao fluxo SSH;
- exportação administrativa contém configuração e diagnóstico, nunca a saída SSH ou segredos.

## Gestão e precedência

- `/profile/terminal-highlights` permite editar somente regras próprias, desligar os destaques e consultar templates recebidos e a configuração efetiva, com simulação de texto.
- `/admin/terminal-highlights`, no menu Administração, permite gerir templates e vínculos por usuário/grupo, histórico e diagnóstico. Somente administradores podem usar suas APIs.
- A consulta administrativa por usuário verifica sua existência e pertencimento à organização antes de acessar a configuração, inclusive quando há cache.
- Em sobreposições, atribuição direta prevalece sobre grupo, que prevalece sobre regra pessoal. A prioridade numérica ordena regras dentro da mesma origem.
- Empates entre templates usam o menor ID (criado primeiro); dentro do mesmo template ou das regras pessoais, preserva-se a ordem salva.
- Um template recebido diretamente e por grupo é aplicado uma única vez como atribuição direta.
- Atribuir um template não apaga regras pessoais; remover o vínculo permite que elas voltem a prevalecer nos conflitos. Regras sem sobreposição continuam aplicáveis.
- O desligamento pessoal suspende também os templates administrativos. A configuração por usuário informa esse estado; atribuição não é obrigatoriedade.
- O limite combinado mantém as primeiras 40 regras ativas pela precedência, informa quantas ficaram de fora e não apaga as regras salvas.
- Exclusões notificam também os membros dos grupos vinculados. Falhas de gravação mantêm o formulário; exclusão e restauração de regras/vínculos exigem confirmação.

## Validação

- Testes de serviço e HTTP em `apps/backend/src/modules/terminal-highlights/*.test.ts` cobrem precedência, conflitos reais no motor, isolamento, permissões e falhas.
- `npm run test:terminal-highlights:web` simula usuários comuns e administradores com APIs controladas, erros recuperáveis e telas desktop/mobile. Não grava dados reais nem abre SSH.

### Cenários de regressão

- Motor: atualização de regras entre frames, desligamento com frame pendente, descarte, entrada/saída do buffer alternativo, limite combinado de correspondências e orçamento de renderização.
- Invariantes: realçar não escreve bytes, não limpa o buffer, não move foco/scroll, não altera seleção, não redimensiona nem encerra o terminal.
- Cache: requisições simultâneas, falha recuperável, resposta antiga após atualização, expiração sob demanda e notificações entre abas sem eco no canal de destaques.
- Administração: destinatários antigos e novos são notificados, falha de transação não publica alterações, histórico com destinatário removido é recusado e cancelamento preserva o template salvo.
- Telas: troca rápida de usuário durante consulta, interrupção de rede, falha ao editar vínculos/restaurar, precedência ao remover vínculo direto, desativação/reativação e recuperação para regras pessoais.
- `npm run test:terminal-experience:web` usa transporte simulado e verifica também atualização de cores durante a sessão, comparando geometria, foco, seleção, scroll, clipboard, número de conexões e mensagens enviadas. Os testes são opt-in, sem sondagens no uso normal.
- Relatórios de Playwright ficam em `/tmp/nodeaccess-terminal-highlights-report.json` e `/tmp/nodeaccess-terminal-experience.json`. Falhas na jornada de destaques geram `/tmp/nodeaccess-highlights-failure.json` e capturas dos contextos de usuário/admin.

## Limites de proteção

- 40 regras efetivas;
- 120 correspondências por passagem;
- orçamento de renderização de 8 ms;
- cache efetivo de 30 segundos com invalidação direcionada;
- regex potencialmente custosa é recusada antes da persistência.

## Critérios de adoção

- criar a primeira regra e entender seu resultado pela prévia;
- recuperar uma falha de salvamento sem perder o formulário;
- aplicar um padrão por grupo sem manutenção manual de usuários;
- identificar rapidamente a origem de uma cor no terminal;
- localizar a próxima ocorrência usando uma regra ativa;
- identificar templates custosos antes de ampliar seu uso.

## Biblioteca de modelos prontos (28/09/2026)

Em Administração → Destaques do terminal → Novo template → **Usar modelo pronto**, o administrador pode escolher Clássico, Linux e infraestrutura, Redes / NOC, Logs de aplicações ou Discreto. São modelos próprios do NodeAccess; não importam configurações nem prometem equivalência com produtos externos.

A prévia usa saídas demonstrativas e as mesmas funções de correspondência e cores do terminal, sem executar comandos. **Usar este modelo** preenche nome, descrição e regras com identificadores novos. Se o rascunho já tem conteúdo, uma confirmação permite mantê-lo ou substituí-lo; status e destinatários são preservados. A biblioteca está disponível na criação, preservando o fluxo de edição de templates existentes.

Revise as regras e selecione usuários/grupos antes de **Salvar e aplicar**. Escolher um modelo ou cancelar não grava nem atribui nada. Uma falha de salvamento mantém o rascunho para nova tentativa. Após salvar, o template segue a API, validação de regex, escopo do tenant, histórico, eventos, precedência e desligamento pessoal existentes. Atualizações futuras da biblioteca não modificam cópias já salvas.

Os modelos priorizam padrões curtos e delimitados por palavras. Redes inclui IPv4 e nomes comuns de interfaces, não um analisador completo de equipamentos/IPv6; os destaques são pistas visuais, não diagnóstico. Cada regra pode ser ajustada ou desabilitada no editor. A biblioteca não requer migração, acesso externo ou ativação automática.

Testes adicionais em `terminal-highlight-presets.test.ts` verificam exemplos positivos/negativos, IDs independentes, limites e modelos desconhecidos. A suíte do serviço salva cada modelo usando a validação real e verifica histórico/eventos. O Playwright cobre prévia sem gravação, preservação de rascunho e destinatários, falha/repetição do salvamento e recebimento pelo usuário, além das regressões de permissões e precedência existentes.

Validação de 28/09/2026: 85 testes automatizados aprovados (catálogo, motor, contratos, serviço e rotas), typecheck do frontend aprovado, 15 cenários Playwright aprovados em cada tema (claro/escuro), desktop/mobile e seleção por teclado. Capturas revisadas em `/tmp/nodeaccess-highlight-presets-*`; regressão completa do terminal aprovada em `/tmp/nodeaccess-preset-terminal-regression.json`. Os testes de navegador usaram APIs controladas; nenhum tenant de produção foi alterado.
