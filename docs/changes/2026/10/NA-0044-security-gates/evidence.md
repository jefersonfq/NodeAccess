# Evidências NA-0044

- Gitleaks: 42 ocorrências revisadas de fixtures/placeholders/marcadores; zero não revisadas. Exceções exatas com hash integral do arquivo.
- Semgrep inicial: 208 achados e 5 erros/parciais. Triagem: 200 alertas Express/Fastify inaplicáveis ao contrato padrão send, 5 JWTs de testes, 1 arquivo histórico inativo, 1 tag GCM já implicitamente fixa e 1 bypass TLS real corrigido.
- Semgrep após correção/escopo documentado: 728 arquivos, zero achados e zero erros. A primeira rodada não foi considerada aprovação.
- TLS real e criptografia: 9 testes; validação do destino original pelo túnel, rejeição de CA não confiável e hostname incorreto. Auth tag GCM explicitamente 16 bytes sem mudar ciphertext/IV/keyring existentes.
- Typecheck backend aprovado. Mudança de TLS exige configurar a CA dos destinos privados antes da release; não houve alteração na VPS.
- npm runtime: zero vulnerabilidades conhecidas; gate completo retorna falha para 7 achados de build ainda pendentes. SBOM produzido. Workflow preparado localmente; não executado no GitHub.
- Limites, escopo/exclusões e bloqueios de release em security/README.md. Guacd permanece exceção explícita, sem alterações.
