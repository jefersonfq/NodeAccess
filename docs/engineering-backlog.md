# Revisões futuras — após a consolidação NA-0054

Registradas a pedido do usuário para execução posterior. Status atualizado pela NA-0055; cada item mantém limites e evidências explícitos.

| ID | Prioridade | Trabalho | Critério de conclusão |
|---|---|---|---|
| FUT-001 | Parcial — NA-0055 | Master protegida com PR/checks, conversas resolvidas e sem force/delete; tags protegidas | Rulesets aplicadas e lidas de volta. Aprovação humana obrigatória depende de participação do colaborador e permanece pendente; revisão IA independente mantida |
| FUT-002 | Alta | Revisar CSP efetiva nos perfis Nginx/aplicação | Política aplicada e compatível com login, terminal, recursos web e integrações, sem enfraquecer CSP para obter aprovação |
| FUT-003 | Alta | Executar runtime Compose sem root quando aplicável | UID/GID, permissões, volumes e portas validados nos serviços reais, com rollback |
| FUT-004 | Executado — NA-0055 | Auditoria de 143 commits alcançáveis nas refs locais | 51 alertas triados como fixtures/exemplos ou identificadores públicos; zero credenciais reais confirmadas. Scanner reutilizável sem allowlist automática; repetir periodicamente e após novas refs |
| FUT-005 | Antes da release | Homologar a versão completa | Login/MFA/SSO, isolamento de tenant, SSH, JIT, compartilhamento e SFTP aprovados por humano autorizado |
| FUT-006 | Antes da release | Repetir scans npm/SAST/segredos/imagens e revisar exceções | Evidências recentes sobre as imagens reais, SBOM e decisão explícita por achado; revisar validade de security/image-triage.json |
| FUT-007 | Média | Avaliar bundle vendor-ui de aproximadamente 1 MB minificado | Medir carga/cache antes e depois; reduzir custo sem regressões ou apenas elevar limite do warning |
| FUT-008 | Antes de major Vite | Adaptar configurações Vite/Vitest ao loader nativo futuro | Build, testes e desenvolvimento funcionais na versão alvo, sem ocultar avisos |
| FUT-009 | Média | Executar carga e soak representativos | Cenários e metas definidos, medições de memória/pool/latência/erros por duração representativa |
| FUT-010 | Exceção a acompanhar | Reavaliar risco do guacd preservado | Manter versão por decisão do usuário; revisar isolamento/exposição e só migrar com autorização e ensaio de compatibilidade |
| FUT-011 | Antes da release Windows | Concluir pipeline de assinatura e distribuição | Provisionar certificado/chaves pelo mecanismo de segredos; incluir `manifest.sig` no transporte dos artefatos; provar validação e rejeição de assinatura inválida no pacote real |

Guacd não deve ser atualizado automaticamente. Proteção da master e outros
controles remotos exigem revisão de configuração própria. A integração de
código à master não publica versão nem altera produção.

Referências: security/README.md; security/image-triage.json;
docs/changes/2026/10/NA-0053-jit-private-requests/plan.md.
