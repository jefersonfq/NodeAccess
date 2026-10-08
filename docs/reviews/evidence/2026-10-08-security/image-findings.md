# Ocorrências sinalizadas nas imagens

As cópias locais têm os mesmos identificadores das imagens implantadas na VPS. Contagens representam associações entre pacote e advisory; podem repetir CVEs em bibliotecas, caminhos e imagens. Severidade é a da base Grype e exige triagem conforme função e configuração.

| Imagem | Ocorrências | Critical | High | Medium | Low | Unknown |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| backend | 193 | 6 | 105 | 61 | 21 | 0 |
| frontend | 199 | 26 | 95 | 59 | 13 | 6 |
| guacd | 167 | 11 | 55 | 91 | 10 | 0 |
| mysql | 94 | 0 | 27 | 60 | 7 | 0 |
| redis | 52 | 6 | 19 | 15 | 12 | 0 |

Scanner Grype 0.120.1, executado por digest fixo; banco de vulnerabilidades construído em 2026-10-08T06:33:47Z. Código de saída 0 indica execução concluída, não ausência de vulnerabilidades; não foi passado `--fail-on` nesta coleta.

- [backend](grype-backend.json): `sha256:45e1a8596ece42a6b7dfd40749afd9ffafeb70c1e2bbedd379e0f33872c67e53`.
- [frontend](grype-frontend.json): `sha256:5e8685fb800cf642c091e99ad2c96e0f45cd8863f33ac1627e50559283ff82cc`.
- [guacd](grype-guacd.json): `sha256:f63bdb5b40b8b0fea5eb14455ece114688beb109cdcaffb9a8db9fd20adfa96e`.
- [mysql](grype-mysql.json): `sha256:6cd09145362dfe6831b14545de3d5fd6cc75c37cfd6ef8561429c1fc73518b39`.
- [redis](grype-redis.json): `sha256:2a51817f79255c8b69f86a974459c2e0359aff81417d80158f2b9e541e6f4b33`.
