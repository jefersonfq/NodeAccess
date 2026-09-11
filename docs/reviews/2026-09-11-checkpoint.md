# Checkpoint de desenvolvimento — 11/09/2026

## Alterações consolidadas

Consolidação das alterações acumuladas de agentes e instaladores, segurança e ACL gerenciada, supervisão/auditoria, hosts/segredos/túneis, compartilhamento de sessão, resiliência e UX, além do piloto de equipamentos de rede/TACACS+.

TACACS+ inclui perfis de equipamentos, serviço separado, políticas por usuário/host, auditoria, diagnóstico por tenant, watchdog e laboratórios de falha, concorrência, carga e CLI simulada sobre SSH real. Consulte os relatórios específicos desta pasta para evidências e limitações.

A revisão do playback foi concluída com Playwright. A próxima etapa aprovada está registrada em [playback e vídeo](./2026-09-11-playback-video.md): aba experimental com flag independente, preservação do playback existente e processamento de vídeo em workers escaláveis. Essa etapa permanece proposta; não faz parte da implementação deste checkpoint.

## Verificação do checkpoint

- Build completo (`npm run build`): aprovado para shared, backend e frontend; mantidos os avisos existentes de Browserslist e tamanho de chunks.
- Segurança/runtime do agente (`npm run test:security -w apps/agent`): 15 testes aprovados.
- Suíte geral (`npm test`), confirmação final: **1.350 testes aprovados, 9 ignorados; 172 arquivos aprovados e 5 ignorados**, sem falhas, em 131,48 s. Executada após a correção do ambiente/preparação de testes e sem build concorrente.

A primeira execução de `npm test` encontrou sete suítes importando configuração sem variáveis obrigatórias. O Vitest agora fornece valores fictícios por padrão, preservando variáveis explícitas para testes opt-in. Na execução concorrente com outros builds/testes, duas verificações ultrapassaram o timeout de cinco segundos; a repetição isolada de observabilidade passou. No contrato HTTP de webhooks, a compilação dos schemas foi movida para a preparação do teste (`beforeEach`), mantendo as verificações de requisição e os timeouts do contrato. Uma variável duplicada `METRICS_TOKEN` foi removida do exemplo de ambiente.

As validações opt-in de SSH real, browser, MySQL/Redis e TACACS+ realizadas nas entregas anteriores permanecem documentadas nos relatórios correspondentes. O checkpoint não implica homologação com firmware de fabricante, publicação em produção ou disponibilidade de instaladores assinados.

## Escopo de versionamento

Inclui fontes, migrações, testes, recursos do instalador e documentação técnica. Exclui dados de runtime, ambientes com segredos, binários gerados, configurações pessoais em `.claude/` e documentos/importações locais não necessários ao produto. Build gera arquivos nos diretórios ignorados pelo Git.
