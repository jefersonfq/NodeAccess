# Evidências e reprodução

Executar a partir da raiz da árvore NA0156 com Node24.22.1:

```sh
node --test tools/deploy/restore-mysql-env.test.mjs tools/tls/challenge-files.test.mjs tools/frontend/trial-live-boundaries.test.mjs tools/deploy/helm-context-boundaries.test.mjs
node docs/changes/2026/11/NA-0156-sonar-followup/credential-probe.mjs
bash -n tools/deploy/helm-ollama-kind-certification.sh
```

Resultado: 22 PASS, zero skips nesta máquina Linux/root. O teste de UID distinto é explicitamente ignorado sem root; não alegar a mesma prova nesse caso. O probe extrai a expressão de senha da AST do arquivo real e não imprime valores. Não executa o trial inteiro.

O template Helm foi executado em container descartável, por ID `sha256:cf0a7bf3153f2ba7563fa536bc86db12b1ef32a0c93425c56eb5f93842ee7f48` (alpine/helm:3.17.3), com `--network none --read-only`, volume charts somente leitura em /charts. Comando interno:

```sh
helm template nodeaccess-ai /charts/nodeaccess -n nodeaccess-ai-cert \
  --set migrations.enabled=false --set tests.enabled=false \
  --set api.enabled=false --set gateway.enabled=false --set frontend.enabled=false \
  --set ollama.enabled=true --set ollama.persistence.enabled=true \
  --set ollama.persistence.size=2Gi --set ollama.image=ollama/ollama:0.11.4 \
  --set ollama.model=smollm2:135m \
  --set ollama.resources.requests.cpu=100m --set ollama.resources.requests.memory=256Mi \
  --set ollama.resources.limits.cpu=2 --set ollama.resources.limits.memory=4Gi
```

Executado também com `--set existingSecret=nodeaccess-runtime`. Outputs byteidênticos, hash e tipos em helm-template-proof.json. O Secret era criado separadamente pelo harness; sua remoção não modifica os recursos renderizados. Esta prova não substitui execução de Kind/Ollama real.

Três arquivos de testes alterados passaram ESLint com max-warnings0. O .mts não tem configuração aplicável no projeto; tentativa retorna warning de arquivo ignorado. Transpile sem diagnóstico não substitui checagem semântica completa. Scanner, cobertura integrada e replay de FP permanecem sob coordenação da raiz.
