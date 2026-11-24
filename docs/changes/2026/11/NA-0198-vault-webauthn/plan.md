---
change_id: NA-0198
title: Cofre E5a — Windows Hello / chave de acesso (WebAuthn) para destravar o cofre no portal
type: security
status: delivered
created_at: 2026-11-24T01:40:00-03:00
base_branch: master
base_sha: 8264e7325e3f560f251cbc8bfed2dca79320c3f8
branch: security/NA-0198-20261124-vault-webauthn
owner: Jeferson Quintana
planner: Claude Code
risk: high
issue: null
---

# NA-0198 — Windows Hello / chave de acesso para destravar o cofre (E5a)

## Contexto e situação anterior

Destravar o cofre no portal exige senha NodeAccess + código do autenticador (ou o provedor de login + código). O contrato NA-0177 §5 prefere WebAuthn com verificação do usuário obrigatória na origem HTTPS do portal; o plano de evolução (NA-0189) colocou a E5 como próxima fatia, com o gate do §11 (prova em Windows/Chrome/Edge; falta de suporte não autoriza rebaixamento).

## Problema e objetivo

Digitar senha e código a cada confirmação é o maior atrito do cofre. Objetivo: cadastrar o Windows Hello (ou outra chave de acesso com verificação do usuário) na conta e usá-lo para destravar o cofre no portal, com as mesmas garantias do contrato; senha + código seguem como alternativa.

## Escopo

- Backend:
  - tabela `vault_webauthn_credentials` (tenant, usuário, id da credencial, chave pública, contador, transportes, nome, criada/último uso), migração aditiva;
  - cadastro: opções e verificação com sessão do cofre confirmada há menos de 60 s (autorização fresca), `attestation: none`, `userVerification: required`, exclusão de credenciais já cadastradas; auditoria `WEBAUTHN_REGISTERED`;
  - listar e remover (remover com sessão confirmada; auditoria `WEBAUTHN_REMOVED`);
  - desbloqueio: o desafio do cofre (`sessions/challenges`) passa a trazer opções WebAuthn quando o usuário tem credencial; `POST /sessions/unlock-webauthn` consome o desafio antes da verificação; verificação pela biblioteca com desafio, origem exata e RP ID da política do tenant, UV obrigatório; contador como sinal (não critério único); falha audita `UNLOCK_DENIED` e conta no mesmo limite do desbloqueio;
  - comando de operador `manage.mjs origin <tenantId> <origem>` (dry-run/--apply, incrementa a versão da política, evento durável) para trocar a origem do cofre (ex.: `https://localhost:5173`).
- Portal: na confirmação de identidade do cofre (revelar/copiar e permissões), **Usar Windows Hello / chave de acesso** quando houver credencial, com **Usar senha e código** como alternativa; janela **Windows Hello e chaves de acesso** (botão no topo do cofre) para cadastrar este dispositivo, listar e remover. API nativa `navigator.credentials` (sem dependência no portal).
- Dependência: `@simplewebauthn/server` 14.1.0 (MIT, mantida), decisão do responsável em 2026-11-24.
- Docs: contrato (nota da E5a), operação (origem, RP ID, IP não suportado), manual.

Fora: extensão com Hello (E5b, aba do portal — SEC-16); política do tenant para exigir/desligar WebAuthn; recuperação além de remover a credencial (senha + código continuam).

## Critérios de aceitação

- [x] Cadastro só com sessão confirmada há menos de 60 s; credencial já cadastrada não é cadastrada de novo; auditado.
- [x] Desbloqueio por WebAuthn só com desafio do próprio cliente, não vencido e consumido uma vez; origem, RP ID, assinatura e UV verificados; credencial do próprio usuário/tenant; falha não abre sessão e é auditada e limitada.
- [x] Sem credencial, ou WebAuthn indisponível no navegador, o portal oferece senha + código (sem rebaixar o que o servidor exige).
- [x] Remover a credencial impede o uso imediato.
- [x] Simulação no Chromium com autenticador virtual: cadastrar, destravar com Hello, revelar, remover, voltar a senha + código; UV falso recusado.

## Estratégia técnica

Novo método de prova no mesmo `openSession` do desbloqueio atual (sessão, prazos, origem e auditoria inalterados). O desafio WebAuthn é gerado pelo servidor e guardado no registro do desafio do cofre (`challenge`), ligado ao cliente; o registro é removido antes de verificar. Cadastro guarda o desafio em registro próprio ligado à sessão confirmada. Credenciais por tenant/usuário, com id único global.

## Mudanças de escopo e decisões

- 2026-11-24 (simulação): a oferta do Windows Hello fica ligada ao usuário para o qual foi listada (um bloqueio manual ou uma recusa não a escondem; a pessoa pode tentar de novo).
- 2026-11-24 (ambiente): o Chrome não executa WebAuthn em página com erro de certificado; a homologação local exige certificado confiável para `localhost` (ex.: `mkcert`), documentado em `docs/OPERATIONS-vault-security.md`.
- 2026-11-24 (revisão independente, PASS_WITH_WARNINGS): credenciais ligadas à versão das credenciais da conta (troca de senha/MFA aposenta as chaves cadastradas, contrato §5 "recuperação invalida dispositivos"); testes com criptografia P-256 real pela biblioteca (positivo; origem, RP ID, desafio, sem UV, contador regredindo e outra chave recusados); contador nunca regride; limite de 10 conferido também no cadastro; id duplicado concorrente recusado sem abortar a transação; auditoria da troca de origem com resumos das origens; nome sem caracteres de controle/bidi.
- Aceito: destravar com WebAuthn é prova fresca também para cadastrar/remover chaves e para a administração (o contrato §5 prefere WebAuthn); remover uma chave impede usos futuros, sem encerrar uma sessão já aberta (expira pelos prazos normais).
- 2026-11-24 (correção necessária, CI): na E2 (NA-0195), o desbloqueio da extensão lia o relógio duas vezes (prova gravada e prazo devolvido), e sob carga o prazo saía 1 ms diferente do que `capabilities` informa; agora usa um único instante. Era a falha recorrente do `sonar-real`.
- 2026-11-24 (CI): a biblioteca oferece por padrão também ML-DSA (pós-quântico); o Chromium 156 às vezes o escolhe e a assinatura (~2,4 KB) excede o esquema limitado da rota. Cadastro e verificação ficam restritos a ES256/RS256 (Windows Hello, plataformas e chaves comuns). O harness de administração passou a registrar, em falhas, rota/código dos erros do servidor e o formato (nomes, tamanhos) de corpos recusados, sem valores.
- Harness de administração passou a usar `https://localhost` (WebAuthn recusa IP); demais cenários inalterados.

## Riscos e mitigações

- Origem/RP ID errados aceitariam asserção de outro site: a biblioteca verifica origem exata e RP ID da política do tenant; testes negativos.
- Credencial roubada sem UV: `requireUserVerification` e `userVerification: required`.
- Passkey sincronizada (contador 0): contador só como sinal (contrato §5); regressão de contador não zerado bloqueia e audita.
- Ambiente com IP: WebAuthn não funciona; o portal não oferece a opção e senha + código seguem.

## Matriz de testes e evidências

vitest (serviço: desbloqueio, desafio, origem/RP ID/UV, contador, cadastro/remoção; rotas; repositório), MySQL real (migração e credenciais), simulação Chromium com autenticador virtual (`WebAuthn.addVirtualAuthenticator`), `tsc`, `vue-tsc`, `lint:changed`, `security:scan`, `manual:check-reviewed`, revisão independente. Windows Hello real: homologação do responsável em `https://localhost:5173`.

## Baseline

2026-11-24 sobre `8264e7325`: vitest vault-security + componentes do cofre + services + views + shared 1338 PASS, 50 skipped.

## Rollback ou recuperação

Revert da PR; a migração é aditiva (tabela nova, sem uso por versões anteriores). Remover credenciais desfaz o cadastro; senha + código continuam.

## Aprovação

Decisão: `GO` — responsável em 2026-11-24: "pode seguir com E5"; escolheu portal primeiro, `@simplewebauthn/server` e origem de desenvolvimento `https://localhost:5173`.
