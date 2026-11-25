---
change_id: NA-0203
title: Diagnóstico do cofre e sequência E4, sites e E7
type: feature
status: in-development
created_at: 2026-11-24T17:24:32-03:00
base_branch: master
base_sha: 9d2fc71768a0e7aee34a6495e4ec11eceb338076
branch: feature/NA-0203-20261124-vault-diagnostics
owner: unassigned
planner: Codex
risk: high
issue: null
---

# NA-0203 — Melhorias restantes e sequência de implementação

## Contexto e situação anterior

Usuário pediu implementar melhorias menores e seguir E4, itens de site e E7 fim a fim. E3 (NA-0201) está implementada sem commit; Sonar e homologação pendentes. NA-0202 iniciou o motivo mobile em worktree independente, depois integrado ao checkout canônico. A autorização posterior de executar o programa completo ampliou esta frente para integrar hosts, diagnóstico, E4, sites e E7 sob este plano, preservando módulos e evidências por fatia.

Código inspecionado: SecretService permite membros criarem em seus grupos; criador/admin podem gerenciar Secret de grupo; criação no tenant exige admin. O contrato NA-0182 exige permissão própria para escrita compartilhada. O endpoint atual de consumidores de Secret lista hosts para quem gerencia o Secret, sem filtrar ACL de hosts: não é adequado para reutilização direta na extensão.

## Problema e objetivo

Reduzir dúvidas de uso e construir o caminho até preenchimento manual seguro, sem confundir leitura, gestão, compartilhamento e entrega de senha. Cada fase deve ser utilizável de ponta a ponta no piloto e possuir teste de falha/revogação/tenant.

Referência funcional solicitada em 2026-11-24: [1Password no navegador](https://support.1password.com/getting-started-browser/) e [salvar/preencher senhas](https://support.1password.com/save-fill-passwords/), consultados nesta data. Priorizar busca, geração, cadastro/edição e seleção de login para o site atual. Isso não inclui automaticamente paridade com passkeys de sites, cartões, endereços, TOTP armazenado, captura automática ou autenticação federada; esses domínios exigem escopo próprio. A referência não substitui o contrato de segurança do NodeAccess.

## Escopo

### Remediação Sonar autorizada — 2026-11-25

Usuário autorizou corrigir os problemas para melhorar o resultado Sonar. Continuidade dependente na mesma branch/ChangeID, sem commit/publicação. Plano: exportar condições/achados reais; corrigir instalação TypeDoc e laboratório TLS com reprodução; distinguir lacunas reais de cobertura de problemas do coletor; acrescentar testes comportamentais para código novo e corrigir achados comprovados em lotes pequenos. Revisão independente por arquivo/achado, sem excluir fontes/regras, reduzir thresholds ou alterar baseline para obter aprovação. Main coordena exportação/configuração; implementação e validação independentes por arquivos disjuntos. Risco GO_WITH_RISKS: alterações em cofre/ACL/criptografia só quando necessárias ao achado demonstrado, preservando os contratos aprovados. Aceite: testes aplicáveis, cobertura nova ≥80%, análise integral verificável e revisão dos achados; qualquer falha continua FAIL, indisponibilidade BLOCKED. Registrar limites e uma escrita agrupada do roadmap se mudar o estado de entrega.

### Continuidade aprovada — seis melhorias de adoção (2026-11-24)

Usuário autorizou implementar as seis sugestões fim a fim na mesma frente dependente e branch, sem commit/publicação. Risco alto; GO_WITH_RISKS mantendo piloto e gates externos. Baseline anterior928 testes/72SQL e navegador documentados em hardening-results.md; executar baseline focal antes de cada edição.

1. Login em etapas: preencher usuário sem entregar senha em página sem campo de senha; na etapa seguinte, novo gesto e operação vinculada ao documento corrente, mesma origem exata, sem senha transportada entre páginas.
2. Salvar/atualizar: assistência ativada explicitamente pelo usuário para o site; captura limitada ao formulário escolhido, proposta temporária e confirmação na extensão antes de escrita. Sem observação global, upload automático ou persistência em disco do segredo capturado.
3. Gerador configurável: tamanho/classes com Web Crypto, validação de opções e uso nos editores; formulário ativo preservado durante confirmação, com descarte em logout/expiração/cancelamento.
4. Sugestões nos campos: assistência sob gesto na origem autorizada, metadados filtrados por ACL, teclado/Escape; seleção da página nunca concede entrega por si, confirmação final na UI privilegiada. Sem permissões globais a sites.
5. Favoritos/recentes: somente IDs e instantes locais vinculados a identidade/tenant, reconsulta de acesso antes de mostrar/abrir; não armazenar valores ou nomes em histórico sem autorização corrente.
6. Continuidade após Hello: recuperar referência do item, aba e ação com prazo; retorno ao site e confirmação final de preencher, sem repetir busca nem entregar automaticamente. Contexto inválido exige nova seleção.

Aceite transversal: fluxos positivos/negativos em Chromium real, controles React/Vue, documento/origem/identidade divergentes, revogação e expiração; testes de persistência sem segredos, tipos/lint/build/security/Sonar; revisão independente, manual e uma escrita agrupada no roadmap nesta nova interação. Não prometer sucesso de autenticação do site com base apenas em submit. Concessões de leitura/escrita/fill continuam autoritativas no backend.

| Frente | Resultado concreto | Dependência/limite |
|---|---|---|
| NA-0202 (separada) | Motivo por item junto ao nome no celular | Sem regra nova |
| Retomada pós-portal (integração com E3 existente) | Recuperar item/ação após popup perdido, metadados reconsultados e clique explícito | Referência sem segredo em storage.session trusted, digest de autorização/origem/dispositivo, prazo 120 s; cancelamento limpa |
| NA-0203 | Hosts associados visíveis e diagnóstico para gestores | Decisão de ACL abaixo |
| E4 / NA-0203 | Criar, editar metadados e rotacionar Secret compartilhado pela extensão; tela de concessão | ADR-02; E3 como dependência; sem escrita compartilhada de PEM presumida |
| Sites / NA-0203 | Cadastro de login web (nome, usuário, senha, origens HTTPS) e URL sem segredo, portal e extensão | Domínio próprio, migração e contratos; identidade/permissões reusadas |
| E7 / NA-0203 | Preencher após clique e salvar login manual na aba atual, piloto desligado | Sites, permissões de fill, SEC-11/17 e EXT-13/14; pentest antes de uso real |

Fora: autofill sem gesto, captura automática de submissão/teclas, acesso a todas as abas, iframes no piloto, exportação PEM, bridge nativa, E2EE, Firefox/Safari, publicação em loja e implantação sem autorização.

## Critérios de aceitação

Continuidade aprovada pelo usuário: implementar as cinco melhorias propostas e corrigir erro/redirecionamento da Central de Segurança. Escopo adicional: geração persistente para invalidar fill após reinicialização/off-on, E2E site→host→SSH descartável, matriz de formulários/interrupções, volume/usabilidade e diagnóstico/correção mínima da Central. Baselines e evidências desta rodada serão separados das anteriores; sem publicação e sem senhas reais. Geração de boot pode invalidar conservadoramente operações pendentes em restart/scale, exigindo novo clique, mas não novo cadastro de login. Aceite exige provar recusa de operação antiga e sucesso de operação nova entre instâncias.

Estado de execução local em 2026-11-24: diagnóstico, E4, sites, piloto E7, mobile e conexão pelo portal implementados; evidências consolidadas no implementation.md. Os critérios abaixo permanecem gates de entrega, sem presumir Sonar, homologação humana, pentest ou publicação. A origem atual também pode corresponder a links HTTPS ativos já cadastrados nos hosts, resolvidos pelo mesmo normalizador do portal e filtrados pela ACL; nenhum cadastro duplicado é necessário para essa sugestão.

Complemento aprovado pelo usuário nesta interação: priorizar adoção por sites/preenchimento e integrar conexão SSH à extensão. O site pode ter vínculo explícito a um host; não inferir identidade SSH por substring, DNS ou simples igualdade de nome. Mostrar “Conectar pelo NodeAccess” apenas para vínculo visível pelas ACL existentes. O clique abre o portal no fluxo normal de conexão, preserva autenticação e revalida acesso; navegar numa página não inicia SSH. Se houver múltiplos destinos, o usuário escolhe. Sugestões usam origem HTTPS exata da aba ativa, sem solicitar novamente a URL e sem permissão permanente para ler todos os sites. Preenchimento permanece gesto explícito, sem submissão automática e com piloto desligado até os gates externos.

- [x] Hosts (código e testes locais): item acessível + host visível para o usuário, no mesmo tenant. Retornar somente identificação/nome/link autorizado, sem endereço/usuário/quantidade de hosts ocultos. Paginação não denuncia itens invisíveis. Abrir host revalida a ACL no portal. Sonar/homologação continuam separados.
- [ ] Diagnóstico: apenas gestor autorizado com confirmação recente, sobre usuário do mesmo tenant; nunca revelar segredo, sessão/token nem listar itens que o gestor não pode identificar. Informar política, grant, liberação e ACL como condições de configuração; não garantir que uma sessão/dispositivo está apto naquele instante. Motivo desconhecido é explícito.
- [ ] E4: permissão de uso da extensão e permissão de escrita compartilhada checadas no servidor, junto com a ACL do item/grupo/tenant. Criação pessoal permanece padrão; troca de escopo é explícita e reautorizada. Escrita/auditoria usam a transação da autorização, como E3.
- [ ] Sites: username e origens tratados como metadados sensíveis a ACL; senha cifrada no servidor, nunca listada. Validação por URL parser, sem userinfo, query/fragment ou esquemas inseguros na origem; normalizar host/porta. Edição do login não sobrescreve senha implicitamente. URLs sem segredo não recebem ações de entrega.
- [ ] E7: ação fill distinta de revelar/copiar, sem herdar grant indevido. Prova recente e concessão de uso único vinculadas a item/versão, chave de dispositivo, origem HTTPS exata e documento. Worker revalida tabId/frameId/documentId antes e após entrega; navegação/aba/frame divergente cancela.
- [ ] E7: content script somente recebe valor autorizado por uma operação; mensagens internas validadas por schema e remetente. Sem token/chave, campos ocultos, autosubmit, iframe/cross-origin ou preenchimento automático. UI de confirmação fica no contexto privilegiado da extensão.
- [ ] E7: interruptor de servidor independente, desligado por padrão; desligar/revogar invalida autorizações pendentes. Falha de dependência/auditoria nega entrega; timeout não repete consumo automaticamente.
- [ ] Todas: traduções PT/EN, acessibilidade/teclado, mobile/desktop, estados de vazio/erro/expiração; manual e roadmap atualizados. Sonar, revisão independente e homologação sem aprovação presumida.

## Estratégia técnica

Continuidade autorizada em 2026-11-24: usuário pediu executar todas as etapas possíveis fim a fim. Branch canônica agora `feature/NA-0203-20261124-vault-diagnostics`, criada preservando o working tree dependente E3/NA-0203, sem commit. Este plano passa a governar a integração do programa nesta branch; contratos/serviços de cada fatia serão módulos separados, com validação por fatia. Gate externo ausente não bloqueia desenvolvimento independente, mas bloqueia declaração de pronta/publicação. Integrar mobile já testado; deixar escrita única do roadmap para o encerramento da interação.

Implementação E4: grant `shared-write` na extensão, aprovado pelo mecanismo existente de dois gestores; ACL de criação/edição do portal permanece autoridade do recurso. Portal atual não ganha restrição silenciosa. Aprovação não se repete por edição. Diagnóstico usa confirmação de gestor e consulta na mesma transação, sem valores. Sites terão domínio próprio e migração aditiva; E7 terá kill switch independente e somente gesto explícito em origem HTTPS exata, com validação de documento antes/depois da entrega. Senhas reais continuam bloqueadas sem pentest.

### Decisões aprovadas em 2026-11-24

1. **ADR-02:** usuário aceitou concessão `shared-write` separada, somada às regras atuais, condicionando o desenho à redução de fricção. Aprovação por dois gestores ocorre na concessão, nunca a cada edição. Não amplia acesso ao item nem permite a qualquer membro alterar itens de outro criador. Não interpretar isso como autorização para impor silenciosamente uma nova restrição aos usuários atuais do portal: a migração deve explicitar esse impacto e manter as ACL de recurso comuns aos clientes.
2. **Hosts associados:** usuário confirmou usar o acesso existente. Interseção da leitura do item e visualização do host no mesmo tenant; nenhuma permissão de visualização nova para a extensão, nenhum total de hosts ocultos. Não reutilizar `consumers()` sem filtro. E7 continua piloto desligado, validado com dados descartáveis até pentest.

### Redução de fricção — critérios adicionais

Inspeção estática em 2026-11-24: `ItemEditor.vue` já preenche nome/descrição na edição, mas limpa senha/PEM em qualquer falha de save; `App.vue` reutiliza prova enquanto válida e, quando o popup fecha para confirmar no portal, restaura somente a prova, exigindo nova seleção do item. São achados de código, não medição de usabilidade.

- Separar configuração pelos gestores do uso diário: nenhuma proposta/aprovação por operação; servidor continua revalidando grant, ACL e revogação a cada escrita.
- Reusar a janela de confirmação já autorizada no servidor, sem prolongar prazos ou criar bypass. Oferecer Windows Hello disponível sem pedir senha/TOTP adicional na mesma prova.
- Retomar contexto após confirmação: guardar somente referência mínima à ação/item, com prazo e vínculo a usuário/tenant/dispositivo; revalidar ao voltar. Não persistir senha, PEM, TOTP nem conteúdo livre de formulário. Após popup perdido, pedir clique explícito para entregar; não executar entrega em background.
- Evitar perda por validação previsível: validar formulário antes do envio e focar campo inválido. Preservar campos não secretos enquanto a mesma tela/contexto estiver ativa. Não relaxar limpeza no bloqueio, troca de tenant ou expiração. Falha ambígua de rede exige reconciliar resultado; nunca reenviar escrita automaticamente.
- Escopo pessoal como padrão; grupos apenas quando necessários, listados pela autorização existente. Metadados já existentes preenchidos na edição. Não solicitar novamente tenant, servidor ou item quando o contexto já os determina.
- Medir no ensaio Chromium ações, campos redigitados e confirmações em conexão inicial, uso recorrente, prova expirada e erro de formulário. Meta: zero redigitação de metadados já conhecidos no fluxo normal e zero aprovação administrativa por edição. Não declarar esses resultados antes dos testes.

### Sequência concreta

1. Encerrar decisão de ACL e detalhar plano da NA-0203; baseline e implementação dos endpoints de hosts/diagnóstico, UI e ensaios cruzados. Preservar E3 não commitada em seu checkout; não criar checkpoint ou commit sem autorização.
2. E4: contrato de grant e migração compatível (desligado por padrão), proposer/approver, capacidades por item e escopo, seletor de grupo autorizado e formulários. Revisão independente da autorização antes do piloto. Não oferecer compartilhamento de PEM sem modelo de ACL próprio.
3. Sites: domínio separado de Secret SSH, schema/repositório/serviço e API compartilhados; migração aditiva, sem converter Secrets existentes automaticamente. Login contém nome, username e referência ao valor cifrado, origens HTTPS exatas; URL simples é tipo separado. Portal e popup com CRUD mínimo (criar/editar; remoção/revogação conforme regra explicitada no plano da fatia), sem capturar página automaticamente.
4. E7: adaptador Chromium com permissões mínimas (`activeTab`/injeção sob gesto), comunicação worker/documento isolada e testes adversariais. Pareamento exato de origem, seleção do item/campo e confirmação fora da página. Salvar login é formulário manual da extensão com origem da aba confirmada, sem leitura passiva de senha do DOM.
5. Gates finais por fatia: unitários/contrato, MySQL descartável, navegador, segurança, Sonar, revisão independente, manual, homologação e pacote. Publicar ou mesclar só após autorização e gates. Pentest externo é evidência de terceiro, não pode ser substituído por revisão do implementador.

## Riscos e mitigações

| Risco | Mitigação | Parada |
|---|---|---|
| Elevação de escrita compartilhada | Grant explícito + ACL autoritativa, dois gestores, testes de revogação | ADR-02 não decidida |
| Descobrir hosts ocultos | Interseção ACL e resposta sem totais ocultos | ACL de host não reutilizável com segurança |
| Diagnóstico enumerar outro tenant | Consulta tenant-scoped, gestor confirmado, mensagens mínimas | Identidade/alvo fora do tenant |
| Phishing e navegação durante fill | Origem HTTPS exata + binding de documento + gesto | Origem/documento divergentes |
| Site capturar senha | Consentimento explica limite, piloto/pentest | Sem pentest para uso real |
| Mutação persistir após falha | Transação única para autorização/escrita/auditoria | Conexão secundária ou auditoria best-effort |
| Misturar frentes não commitadas | Worktrees/planos por Change ID, registro da dependência E3 | Base dependente não recuperável |

## Matriz de testes e evidências

| Frente | Testes mínimos |
|---|---|
| Hosts/diagnóstico | Matriz usuário/gestor/admin, hosts próprios/grupo/negados, outro tenant, item não visível, revogação e erro de dependência; navegador mobile/desktop |
| E4 | Membro vs criador vs admin, grant ausente/revogado, grupo estranho, troca de escopo, revogação concorrente, auditoria e rollback em MySQL real |
| Sites | URL Unicode/punycode/porta/userinfo, esquemas negados, query/fragment, limite de origens, ACL entre tenants, valor fora das listagens, migração e rollback compatível |
| E7 | Host parecido, subdomínio, iframe, HTTP, documento opaco, navegação antes/depois da entrega, replay, remetente falso, worker perdido, revogação/kill switch, campo oculto, ausência de autosubmit; Chromium real e pentest externo |
| Gates | Lint/types/build, testes com cobertura nova >=80%, Sonar local, SAST/gitleaks, revisão independente, manual/capturas e homologação |

## Baselines históricas e evolução

Baseline inicial: código existente inspecionado antes da implementação. SHA referência `9d2fc71768a0e7aee34a6495e4ec11eceb338076`; E3 é working tree dependente ainda sem commit e sem Sonar. Testes das futuras fatias não executados. Branch acima é proposta, ainda não criada.

Continuidade autorizada: baseline cliente/popup/adaptador 54 PASS em 2026-11-24. Retomada implementada como incremento dependente no checkout E3 existente, sem criar commit da base incompleta. Branch declarada no cabeçalho permanece proposta para hosts/diagnóstico. Novo filtro `sourceId` usa o mesmo catálogo já autorizado, sem nova ACL ou endpoint de entrega. `cancelPortalProof` elimina intenção local; aprovação continua exigindo autorização do servidor. Testes de vínculo, expiração, ausência de item, cancelamento e Chromium são obrigatórios para este incremento.

Hosts implementados no mesmo checkout dependente em seguida: read model mínimo tenant-scoped, permissão de visualização reutilizada, paginação após ACL e abertura no portal. Não usa consumers() nem retorna seus dados sensíveis. Testes finais conjuntos 164 PASS; Chromium52 PASS; segurança/manual PASS; Sonar bloqueado. Ver implementation.md para artefatos, falhas encontradas e correções. Baseline própria de hosts não foi executada antes da edição; regressão de domínio executada após a mudança, sem inventar baseline.

## Rollback ou recuperação

Hosts/diagnóstico podem ser desabilitados removendo a superfície de leitura. Migrações de E4/sites são aditivas e foram ensaiadas em banco descartável: desabilitar nova função preserva itens existentes e acesso pelo portal compatível. Fill desligado no servidor bloqueia consumos enquanto desligado; não revoga valores já entregues ao site. Off/on rápido não invalida definitivamente operações pendentes: revogar grant para invalidação imediata ou aguardar mais de 30s após desligamento efetivo em todas as instâncias. Esse limite mantém o critério de invalidação definitiva aberto para liberação real. Não apagar dados nem restaurar banco destrutivamente para reverter UI.

## Aprovação

- Decisão: GO_WITH_RISKS para o programa e regras acima; priorizar redução de fricção sem reduzir segurança.
- Usuário confirmou em 2026-11-24 a proposta E4 e a reutilização do acesso existente aos hosts. Não há pergunta de ACL pendente; migração de permissões do portal requer análise de compatibilidade antes da implementação.
- A skill lifecycle exige aprovação de mudanças materiais. Este documento torna as mudanças de ACL/fluxo de credenciais concretas para decisão; não concede commit, publicação, habilitação com senhas reais ou dispensa de gates.
