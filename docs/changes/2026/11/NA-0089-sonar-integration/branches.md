# Branches locais e recuperação

| Frente | Branch | Checkpoint de origem |
|---|---|---|
| NA-0085 | `chore/NA-0085-20261103-sonarqube` | `a8af091485abe611a66752d0cbb8a723bd8a291c` |
| NA-0086 | `fix/NA-0086-20261103-sonar-backend` | `f6b7c140118237b36235e2af787e2889017038e9` |
| NA-0087 | `fix/NA-0087-20261103-sonar-frontend` | `8ccc9484dd90857cff287e0ab397679fe08006f5` |
| NA-0088 | `fix/NA-0088-20261103-sonar-tooling` | `dd814c5852d6bf4653c411c13bb7838f26d0685a` |

Integração: `chore/NA-0089-20261103-sonar-integration`, base `a8af091485abe611a66752d0cbb8a723bd8a291c`. Os patches foram aplicados com cherry-pick sem commit para manter identidade NA0089 na governança; as branches originais e cada commit permanecem recuperáveis. SHA final da integração pertence à evidência/saída do comando Git, sem commits recursivos para registrar o próprio hash.

Para inspecionar um checkpoint sem alterar o workspace atual, crie um worktree temporário com `git worktree add --detach <diretório-livre> <SHA>`. Não fazer reset na branch do usuário. Reverter código não reverte dados, permissões já ajustadas nem volumes Sonar.

Estado: COMMITTED nas frentes de origem; integração em checkpoint local COMMITTED, com gate de cobertura FAIL. PUSHED/PR_OPEN/MERGED/MASTER_SYNCED não executados. Homologação humana permanece pendente.
