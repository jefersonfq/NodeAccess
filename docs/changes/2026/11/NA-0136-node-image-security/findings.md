# NA-0136 — Achados das imagens Node

Origem: artefatoGitHub13277359334/job126258020435; backend eTLS-agent comNode24.21.0.

| CVE | Severidade Grype | Componente | Correção verificada |
|---|---|---|---|
| CVE-2026-111497 | Critical | Node/Brotli | Node24.22.1; scanner final semachado |
| CVE-2026-105482 | High | Node/DNS NUL | Node24.22.1; contratoNUL rejeitado e scanner semachado |
| CVE-2026-105483 | High | Node/TLS fullwidth IP | Node24.22.1; contratoIPfullwidth rejeitado e scanner semachado |
| CVE-2026-106069 | High | Node/TLS IP não canônico | Node24.22.1; contratoIPnão-canônico rejeitado e scanner semachado |

[Release oficial Node24.22.1](https://nodejs.org/en/blog/release/v24.22.1/) classifica111497 comoHigh; Critical acima é classificação do scanner. Não háwaiver novo. Contratos direcionados nãoequivalem reprodução deexploitBrotli; releaseoficial e scanner corroboramversãocorrigida. Restam3Mediumbackend e5Medium/1LowTLS, abaixo do gateexistente; nenhuma severidade/threshold foi reduzida. IDs eDB emvalidation.json.
