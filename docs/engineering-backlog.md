# Revisões futuras — após a consolidação NA-0054

Registradas a pedido do usuário para execução posterior. Nenhum item abaixo
foi implementado ou aprovado como concluído nesta consolidação.

| ID | Prioridade | Trabalho | Critério de conclusão |
|---|---|---|---|
| FUT-001 | Alta | Proteger master com PR, revisão e checks obrigatórios | Regras revisadas com o proprietário e teste de bloqueio de integração sem checks |
| FUT-002 | Alta | Revisar CSP efetiva nos perfis Nginx/aplicação | Política aplicada e compatível com login, terminal, recursos web e integrações, sem enfraquecer CSP para obter aprovação |
| FUT-003 | Alta | Executar runtime Compose sem root quando aplicável | UID/GID, permissões, volumes e portas validados nos serviços reais, com rollback |
| FUT-004 | Alta | Auditar segredos em todo o histórico Git | Scan histórico, triagem e rotação de qualquer credencial válida identificada; relatório redigido sem segredos |
| FUT-005 | Antes da release | Homologar a versão completa | Login/MFA/SSO, isolamento de tenant, SSH, JIT, compartilhamento e SFTP aprovados por humano autorizado |
| FUT-006 | Antes da release | Repetir scans npm/SAST/segredos/imagens e revisar exceções | Evidências recentes sobre as imagens reais, SBOM e decisão explícita por achado; revisar validade de security/image-triage.json |
| FUT-007 | Média | Avaliar bundle vendor-ui de aproximadamente 1 MB minificado | Medir carga/cache antes e depois; reduzir custo sem regressões ou apenas elevar limite do warning |
| FUT-008 | Antes de major Vite | Adaptar configurações Vite/Vitest ao loader nativo futuro | Build, testes e desenvolvimento funcionais na versão alvo, sem ocultar avisos |
| FUT-009 | Média | Executar carga e soak representativos | Cenários e metas definidos, medições de memória/pool/latência/erros por duração representativa |
| FUT-010 | Exceção a acompanhar | Reavaliar risco do guacd preservado | Manter versão por decisão do usuário; revisar isolamento/exposição e só migrar com autorização e ensaio de compatibilidade |

Guacd não deve ser atualizado automaticamente. Proteção da master e outros
controles remotos exigem revisão de configuração própria. A integração de
código à master não publica versão nem altera produção.

Referências: security/README.md; security/image-triage.json;
docs/changes/2026/10/NA-0053-jit-private-requests/plan.md.
