# Planejamento 2027 — Registro da implementação

## Pedido e objetivo

Revisar metas com capacidades e ideias registradas; atualizar a planilha em cada evolução relevante.

## Implementação

Base SHA `f4a44b4b7ae87a8f688b1246d9e52a31f9a104bc`. Atualizada a planilha canônica em docs/planejamento: 48 iniciativas (25 revisadas + 23 inclusões), quatro abas, IDs estáveis e links de evidência. Original preservado como aba e backup datado. Edição OOXML com biblioteca padrão Python; nenhuma dependência adicionada. Regra persistida em AGENTS.md e PRD-lite, preservando alterações prévias.

Cofre corrigido para parcial; HA assistido e TACACS+ piloto delimitados. LDAP tem provider em código apesar do trecho antigo do PRD; OIDC não comprova SAML. Plantão/saúde/jornada IA são LOCAL_WIP. Chat, tarefas/Jira, fechamento de turno e provisionamento remoto automático permanecem propostas. Prioridades originais preservadas; novas são sugestões. Sem prazos ou responsáveis inventados.

## Validação

Ran: ZIP, parsing XML, preservação byte a byte da aba original/sharedStrings, IDs únicos, estilos, relacionamentos e 48 links locais; PASS em validation.json. Corrigida durante a validação a contagem de fontes do OOXML. Diff check documental executado. Skipped: renderização visual Excel/LibreOffice (indisponíveis), testes de produto e VPS. A revisão documental/código não certifica cada capacidade em operação nem homologação/publicação.

## Recuperação

Backup original datado no mesmo diretório; restaurar apenas preservando alterações posteriores do usuário. Sem mudanças em banco/configuração de produção.

## Pendências

Conferência visual no Excel do usuário. Priorização/prazos finais e homologação/publicação das frentes locais permanecem decisões próprias. Atualização futura acompanha o trabalho no repositório; não existe sincronização automática em segundo plano.

## Diário de interações

### 2026-11-02T17:44:46-03:00 — Revisão e manutenção contínua

Usuário autorizou revisão e registro de cada funcionalidade/ideia. Comparadas 25 iniciativas e incluídos 23 desdobramentos/capacidades com evidência e próximo passo; preservadas prioridades e original. Acrescentadas orientações e histórico; regra persistida. Verificações estruturais PASS. Próximo passo: manter os mesmos IDs conforme novas decisões e entregas, sem inferir produção de testes locais.

### 2026-11-02T19:03:08-03:00 — Inclusão de RADIUS

Usuário solicitou adicionar RADIUS à planilha. Incluída META-049 como Ideia, prioridade a definir, domínio IAM/Network Access, com avaliação explícita do papel cliente/servidor e próximo passo de escopo/PRD. Registrado histórico na aba Revisões; total49iniciativas. Nenhuma implementação ou suporte operacional declarado. Validação executada: ZIP/XML,49IDs únicos, linhas anteriores preservadas, aba original inalterada e49links locais válidos. Evidência em validation-radius.json. Sem alteração de produto, testes funcionais ou publicação. Próximo passo: definir caso de uso antes de implementar.
