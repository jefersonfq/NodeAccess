# Operacao Lite - Diagnostic Playbooks

Guia curto para operar o modulo de diagnosticos do NodeAccess no dia a dia.

## Objetivo
Orientar:
- quando usar cada playbook inicial
- como interpretar os estados da execucao
- como ler o resumo por IA
- quando aprofundar manualmente no terminal

## Quando usar cada playbook

### Rede basica
Use quando houver:
- perda de conectividade
- latencia anormal
- duvida sobre DNS
- duvida sobre interfaces, rotas ou sockets

Sinais esperados:
- interfaces e IPs coerentes
- rota padrao presente
- resolucao DNS consistente
- portas e conexoes visiveis

### CPU e memoria
Use quando houver:
- lentidao geral do host
- processo consumindo recurso em excesso
- suspeita de pressao de memoria
- carga alta sem causa clara

Sinais esperados:
- load average compativel com o host
- memoria e swap em niveis aceitaveis
- processos mais pesados identificados

### Disco e filesystem
Use quando houver:
- falta de espaco
- falha de escrita
- comportamento estranho em montagem
- suspeita de inode esgotado

Sinais esperados:
- uso de disco sob controle
- montagens corretas
- volumes esperados visiveis

### MySQL basico
Use quando houver:
- indisponibilidade do banco
- lentidao percebida pela aplicacao
- duvida sobre conexoes, locks ou status do servico

Sinais esperados:
- servico ativo
- conexoes em nivel esperado
- variaveis e waits sem sinal obvio de degradacao

## Fluxo operacional recomendado
1. abrir o dashboard do host
2. selecionar o playbook mais aderente ao sintoma
3. solicitar a execucao
4. acompanhar `Solicitacoes recentes`
5. abrir o detalhe da execucao
6. ler o resumo por IA quando existir
7. validar a evidencia nos comandos
8. decidir se:
   - o diagnostico ja responde a pergunta
   - vale regerar o resumo por IA
   - vale abrir o terminal para aprofundar

## Resumo automatico x manual
O resumo por IA do diagnostico segue a configuracao do tenant.

### Quando o resumo automatico estiver habilitado
- execucoes concluidas podem disparar analise por IA automaticamente
- a tela mostra `PROCESSING`, `READY` ou `FAILED`

### Quando o resumo automatico estiver desabilitado
- a execucao termina sem analise automatica
- isso nao significa erro
- o operador pode usar `Regerar resumo` para solicitar a leitura manual

## Como interpretar os estados

### Estado da execucao

#### `pending`
- a execucao foi criada
- ainda nao iniciou de fato

#### `running`
- comandos estao em andamento
- aguarde antes de concluir qualquer leitura

#### `completed`
- a execucao terminou
- leia comandos e resumo por IA

#### `failed`
- a execucao terminou com falha em um ou mais comandos ou no fluxo geral
- valide quais comandos falharam

#### `canceled`
- reservado para fluxos futuros

### Estado do comando

#### `completed`
- comando executado com retorno persistido

#### `failed`
- comando falhou ou retornou erro operacional relevante

#### `skipped`
- comando nao foi executado porque a execucao quebrou antes dele

### Estado do resumo por IA

#### `PROCESSING`
- a IA ainda esta analisando a execucao
- aguarde o refresh automatico ou atualize manualmente

#### `READY`
- resumo disponivel
- use como triagem, nao como evidencia unica

#### `FAILED`
- a IA nao conseguiu gerar resumo
- leia a saida manualmente ou tente `Regerar resumo`

#### sem status de IA
- comum quando o resumo automatico esta desligado no tenant
- nesse caso, use `Regerar resumo` se quiser analise assistida

## Como ler o resumo por IA

### Risco
- `low`: resultado benigno ou sem sinal forte de problema
- `medium`: ha atencao operacional ou incerteza que merece validacao
- `high`: evidencia aponta para falha critica, degradacao forte ou comportamento perigoso

### Confianca
- indica o quanto a leitura automatica parece sustentada pela evidencia coletada
- baixa confianca pede validacao manual mais forte

### Achados principais
- leitura curta dos pontos mais relevantes encontrados
- use para orientar a navegacao pela saida

### Proximos passos
- sugestoes seguras de verificacao
- nao substituem decisao operacional humana

## Quando regerar o resumo por IA
Use `Regerar resumo` quando:
- o resumo falhou
- o resumo ficou generico demais
- a saida existe, mas a conclusao nao ficou clara

Nao use para:
- rerodar comandos
- atualizar coleta do host
- substituir uma nova execucao quando o contexto ja mudou

## Quando abrir o terminal manualmente
Abra o terminal quando:
- a evidencia aponta para aprofundamento
- o playbook atual nao cobre o sintoma
- houve falha e voce precisa validar credencial, conectividade ou estado atual
- o host mudou depois da coleta

## Limites atuais
- runner inicial suporta apenas hosts com rota `DIRECT`
- exportacao atual cobre JSON da execucao; formatos mais amigaveis ainda nao entraram
- o catalogo administrativo ja existe em `Administracao > Playbooks de diagnostico`, mas depende da migration aplicada no banco para CRUD persistido

## Preparacao de banco
Para executar playbooks com persistencia completa e habilitar o CRUD administrativo do catalogo, aplique a migration do backend:

### Ambiente local
```bash
npm run db:migrate -w apps/backend
```

### Ambiente ja provisionado
```bash
npm run db:deploy -w apps/backend
```

Depois:
1. reinicie o backend
2. abra `Administracao > Playbooks de diagnostico`
3. valide se o catalogo lista normalmente
4. solicite uma execucao em um host

### Sintoma quando a migration ainda nao foi aplicada
- ao executar um playbook, a API responde com mensagem informando que as tabelas de diagnostico ainda nao estao disponiveis
- a listagem do catalogo pode aparecer via fallback, mas criacao, edicao e execucao persistida ficam bloqueadas

## Boa pratica de leitura
- comece pelo resumo por IA
- confirme nos comandos
- use a saida como evidencia final
- se houver divergencia entre resumo e evidencia, confie na evidencia
