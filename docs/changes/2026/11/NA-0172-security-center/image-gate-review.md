# Revalidação autorizada — 2026-11-15

Usuário autorizou explicitamente alvo, prazo e impacto em 15/11. Políticas aplicadas no checkout
isolado; autorização posterior à rejeição inicial da revisão automática. Diff: evidence/triage-proposal.patch.
Provas por digest e revisão independente: evidence/image-gate-review.json.

Proposta: renovar até2026-11-29T00:00:00Z somente cinco correspondências exatas:

- MySQL ELSA-2026-50075: openssl-libs regular3.5.8-2.0.1, correções do rebase3.5.5;
  comparação incorreta com epoch10 do canalFIPS.
- MySQL ELSA-2026-50346: gnutls3.8.10-9 inclui no changelog correções do release-4;
  comparação com epoch10FIPS.
- MySQL ELSA-2026-500448: changelog do regular-2.0.1 confirma CVE-2026-84782;
  mesma correção nos advisories Oracle regular77396/FIPS500448.
- guacd CVE-2026-59850: libssh2 independente do componente libssh identificado peloCPE.
- guacd CVE-2018-6553: bibliotecasCUPS presentes; busca global no candidato não encontrou
  daemoncupsd, backenddnssd ou perfilAppArmor afetados.

Retirar CVE-2026-59851 do conjunto renovado por ausência no scan atual (não será dispensada).
Manter versões, namespaces, CPEs, severidades e fontes exatas; SQLite permanece com prazo18/11.
Impacto: esses cinco High continuam visíveis nos relatórios, mas deixam de bloquear o gate
até a expiração. Risco: uma conclusão incorreta de aplicabilidade pode ocultar bloqueio real.
Libbrotli, Go, Python e zlib não recebem exceção. Antes da correção, o MySQL em cache tinha dois achados reais
adicionais de libbrotli. A correção e o scan aprovados estão registrados abaixo.

MySQL inspecionado por digest em cache, rpm-V aprovado; assinatura declarada nos metadados
não foi apresentada como verificação criptográfica independente do arquivoRPM original.
Rebuild sem cache encontrou timeout do repositório; a atualização integral fresca continua
não demonstrada. Guacd e TLS foram reconstruídos/inspecionados por digest e suas regressões
foram executadas na rodada anterior (TLS, SSH/VNC; RDP não validado).

## Candidato MySQL corrigido — 2026-11-15

Digest329503c8e99b44f24f841abaa24a6f4a33b2b964440ba29e22c7cdab753c8582:
libbrotli1.0.9-10.0.1.el9_8; fonte oficial, checksum e assinatura verificados.
rpm-V de libbrotli/openssl-libs/gnutls PASS. Scan fresco PASS, dois achados libbrotli
removidos, três correspondências Oracle autorizadas permanecem visíveis.
Download HTTP/1.1 validado sem desabilitar TLS; fullupdate original reutilizou cache.
Escopo do RPM x86_64. Evidência: evidence/gate-authorized-20261115.json.
