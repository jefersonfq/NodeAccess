---
change_id: NA-0179
title: Revelação e cópia autorizadas no frontend VaultNAccess
type: feature
status: ready-for-tests
created_at: 2026-11-16T09:15:00-03:00
base_branch: security/NA-0178-20261115-vault-delivery
base_sha: 89a8d949b4419264d121a1c8d5da900f666a38c4
branch: feature/NA-0179-20261116-vault-reveal
risk: high
owner: unassigned
planner: Codex
---

# NA-0179 — Revelar e copiar no portal

## Aprovação

Decisão: GO_WITH_RISKS.
Usuário autorizou itens1/2/3 fim a fim: publicar/integrar backend e implementar frontend revelar/copiar. NA0178/PR68 ainda em gatesremotos; frente sequencial baseada no candidato validado para não misturar intenções. Aceite humano do backend registrado separadamente na PR68, semdeploy/ativação. PlanoGO_WITH_RISKS por revisor independente; ajustes abaixo são necessários ao resultado solicitado.

## Contexto e situação anterior
Catálogo mostra metadados; backend possui sessão/grants/JWE. Adicionar uso explícito no /vault, separado dos editores e da autorização de gerência. Nenhuma permissão porADMIN/propriedade, nenhum PEM/fill. Servidor continua autoridade.

## Escopo
Componente dedicado, serviço HTTP próprio sem retry/refresh/reloadglobal, máquina de sessão local e adapterJWE com jose (já usado no backend, declarado também no frontend). ChaveRSAefêmera privada nãoexportável por operação; comparar contexto autorizado completo e contexto local independente. Correçãoaditivabackend retorna contexto e relógioautoritatívo para prazo conservador. Memory-only para capacidades/valor/chaves; sem armazenamentooffline ou estadoPinia. Reveal até15s; copy exige autorização própria e gestoConfirmar, semrendersecret. Confirmação não promete apagarclipboard.

Limpar/incrementargeração antes de await em lock, blur/hidden, pagehide/unmount, troca deusuário/tenant/delegação/origemcentral; cancelar melhor-esforço comBeareroriginal; nenhuma resposta tardia reabre. Timeout/resposta perdida nãorepeteconsume. Freshness60s servidor e idle/absoluto locais conservadores sem heartbeat que renove. Falhas403/409/423/429/503 locais;401 limpa cofre e orienta renovar login semencerrarterminalautomaticamente. HTTPSobrigatório.

## Fora
Extensão, WebAuthn/WindowsHello, bridge/E2EE, gestãoadministrativaUI, PEM, alterações em terminal/authcentral, deploy/ativação automática.

## Critérios de aceitação
- [x] Reveal/copy sob gestos explícitos e permissões independentes, semADMINbypass.
- [x] InteroperabilidadeJWE real, contexto/tampering/expiração/limites negados.
- [x] Corridas em awaits, lock/tenant/origem/hidden/unmount descartam estado; sempersistência.
- [x] Transporte semretry/globalrecovery; falhas isoladas do terminal/snippets.
- [x] UI acessível/responsiva, erros/carregamento/bloqueio/confirmarcópia claros; privacidade15s.
- [ ] HTTPSChromium e API/cripto reais sintéticos, clipboard permitido/negado, regressõescatálogo/terminal.
- [ ] Manual/roadmap, lint/typecheck/build, Sonar integral e revisão independente noSHAfinal.

## Matriz de testes e evidências
Baselinecatálogo/views/actiontests e backendvault; unidadesestado/cripto/transporte, backendcontext, browserHTTPS com dadosdescartáveis, manual:capture/test:manual/manual:check-reviewed. Regressãoterminal sem alterarPTY/transporte; Sonarobrigatório. HAR/screenshots não conterão credenciais reais.

## Riscos e mitigações
Clipboard é saídaautorizada; não revogável e pode persistirnoSO. JavaScript não garante zeroizaçãofísica; XSScomprometecliente. SomentecontaslocaiscomTOTP e tenant/item/grants configurados por duplaaprovação. Políticaoffpermaneceoff. ReverterUI/adapter; preservarbackend/auditoria. Chaves privadas nãoexpor/emexportar. Fluxosglobaisnãoacoplados.

## Atualização da base
Base inicialmente8fca07200, na qual baseline80PASS foi executada. Em 2026-11-16T09:55:35-03:00 incorporado89a8d949b porfast-forward, sem conflitos, preservandoWIPfrontend comstashidentificado reaplicado. Delta da base contém somente revisão exata de fixtures e documentos NA0178; nenhumcódigofuncionalmudou. BackendPR68 ainda aguardagates; naquele checkpoint o frontend ainda não estava publicado. Atualmente a PR69 está em draft, com gates pendentes. A mesma basecorrigida será usada nosgatesfrontend.

## Problema e objetivo

Permitir revelar e copiar senhas web autorizadas no portal, com desbloqueio separado e sem interferência nas sessões SSH/RDP, terminal ou snippets.

## Estratégia técnica

Separar transporte HTTP, validação criptográfica, estado efêmero e apresentação. Manter autorização no backend e comparar o contexto local com o envelope autenticado antes de disponibilizar qualquer segredo.

## Baseline

Ran: 80 testes passaram antes da implementação, na base inicial 8fca07200. A atualização documental da base para 89a8d949b não alterou código funcional.

## Rollback ou recuperação

Desabilitar extração pela política existente e reverter o frontend desta frente. Preservar auditoria e dados do backend; não realizar downgrade de banco automaticamente.
