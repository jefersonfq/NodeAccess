# Revisão do playback e proposta de vídeo SSH

## Resultado da revisão

O detalhe de auditoria possui comandos, playback e preview bruto. O playback atual é texto reconstruído em um elemento HTML, com controles temporais; não usa xterm para reproduzir a tela. O carregamento usa preview de até 5.000 eventos. Portanto, transformar essa visualização diretamente em vídeo preservaria suas limitações, inclusive em aplicações interativas e sessões truncadas.

Referências: `apps/frontend/src/views/admin/SessionAuditDetailView.vue` (`PLAYBACK_EVENT_LIMIT`, `playbackRenderedText`, `load` e `data-playback-terminal`). O PRD existente distingue renderização de vídeo do playback e captura da tela do navegador.

## Playwright executado

Suíte `tools/frontend/session-playback-playwright.cjs`, com respostas de API simuladas. Corrigido o isolamento do WebSocket de eventos da aplicação para não depender de um gateway real. Nenhum fluxo SSH ou componente de produção foi alterado.

Aprovados: desktop 1440×1000 e mobile 390×844; modos limpo/bruto; controles de reprodução; timeline; exportação CSV; ausência de overflow horizontal; erro sem detalhes internos; estado vazio; aviso de truncamento; sessão lógica de cinco minutos; fixture com 600 comandos e 1.787 eventos, incluindo quedas, timeouts, permissões negadas e stderr.

Esses testes validam o comportamento atual da interface. Não comprovam fidelidade ANSI, exatidão de vídeo, completude do armazenamento ou execução de comandos em host real. A navegação da lista na fixture de 600 comandos levou aproximadamente 3,3 s neste ambiente: é um ponto para investigação de UX/performance, não um benchmark de produção.

Evidências: [JSON](./2026-09-11-playback-video-validation.json). O arquivo WebM listado nos artefatos é uma gravação do teste navegando na interface com dados simulados, não uma gravação de sessão SSH de cliente.

## Estrutura proposta

Preservar três visualizações vinculadas à mesma sessão: comandos, playback de terminal e vídeo.

1. Disponibilizar a trilha completa e ordenada da gravação, incluindo stdout, resize, timestamps e indicações de lacunas. Não gerar vídeo a partir do preview limitado nem da lista reconstruída de comandos.
2. Extrair um renderizador de terminal somente leitura, compartilhado pelo playback e pelo worker de vídeo. Validar ANSI, UTF-8, cursor, alternate screen, resize e seek. Não escrever stdin bruto indiscriminadamente na tela: isso pode expor entradas não ecoadas.
3. Criar jobs de vídeo fora do gateway, acionados ao encerrar a sessão por política do tenant ou sob demanda. Renderizar quadros em ambiente isolado e codificar MP4/WebM, com limites de concorrência/CPU/duração e retry controlado.
4. Exibir uma aba Vídeo, com estados não gerado, em processamento, disponível e falhou; reproduzir e baixar conforme permissões. Usar retenção, autorização por tenant/sessão e auditoria dos acessos/exportações.
5. Vincular o artefato à gravação e à versão/configuração do renderizador. O vídeo é uma representação derivada da mesma fonte; lacunas na captura devem continuar visíveis e não podem ser reconstruídas por suposição.

Playwright é adequado para validar o player e produzir provas de conceito visuais. A gravação automática de testes não define, por si só, um encoder de produção com controle de frames e tempo. FFmpeg pode integrar a etapa de codificação em worker separado.

Referências: [vídeos no Playwright](https://playwright.dev/docs/videos) e [FFmpeg](https://ffmpeg.org/ffmpeg.html).

Não foi implementada uma funcionalidade de vídeo nesta revisão. A primeira mudança de produto recomendada é garantir a fonte completa e o renderizador compartilhado, para que playback e vídeo representem a mesma sessão com fidelidade verificável.

## Evolução aprovada, ainda não implementada

- Preservar o playback atual e adicionar uma aba **Playback experimental**, controlada por flag por tenant, inicialmente desativada.
- Desligar a flag oculta a aba nova; carregamento e erros do experimental não podem impedir o acesso ao playback atual, aos comandos ou à auditoria.
- Manter uma flag independente para vídeo, com aba própria e estados de processamento.
- Processar vídeo em workers independentes, escaláveis em múltiplos containers e, quando necessário, em máquinas separadas da API/gateway. Cada worker reúne renderizador de terminal e FFmpeg.
- Usar fila com reserva exclusiva, lease/heartbeat, recuperação de trabalhos abandonados, tentativas limitadas e deduplicação por gravação/configuração.
- Iniciar com um trabalho por worker, limites de CPU/memória, quotas por tenant e armazenamento compartilhado dos artefatos.
- Validar fidelidade e fonte completa no playback experimental antes de habilitar a geração de vídeo.
