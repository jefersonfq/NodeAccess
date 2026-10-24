# Aplicativos NodeAccess

Frente inicial para os aplicativos Android e macOS. Esta pasta contém apenas organização e planejamento: ainda não há aplicativo executável, framework escolhido ou integração com o build.

## Organização

- [Android](android/README.md): experiência móvel.
- [macOS](macos/README.md): experiência desktop.
- [Escopo inicial](docs/escopo.md): proposta de primeira versão e decisões pendentes.

Os aplicativos devem evoluir junto aos contratos existentes em packages/shared e à API de apps/backend, quando aplicável. Reutilização de interface e código será decidida após uma prova técnica; não copiar todo o frontend para cada plataforma.

Não há package.json nesta pasta nesta etapa. Os workspaces e pipelines existentes permanecem como estão.

## Próximo passo

Definir se os aplicativos serão clientes do servidor NodeAccess ou também oferecerão SSH direto. Em seguida, escolher a tecnologia com base em uma prova de terminal, autenticação e ciclo de vida nas duas plataformas.
