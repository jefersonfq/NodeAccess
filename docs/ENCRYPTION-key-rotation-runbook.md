# Rotação da chave de criptografia

`PEM_ENCRYPTION_KEY` protege credenciais SSH, chaves PEM, secrets, integrações,
webhooks e tokens persistidos. Nunca substitua essa variável sem manter a chave
anterior disponível durante a transição.

## Estágio 1 — preparar

1. preserve a chave atual em cofre seguro;
2. gere uma nova chave hexadecimal de 32 bytes;
3. configure em todos os nós, na mesma janela:
   - `PEM_ENCRYPTION_KEY=<nova-chave>`;
   - `PEM_ENCRYPTION_PREVIOUS_KEYS=<chave-anterior>`;
4. faça rollout gradual e valide PEM, SSH, secrets, OIDC e webhooks;
5. em HA, todos os nós devem usar o mesmo keyring e a mesma ordem.

Novos dados passam a usar a chave primária. Dados antigos continuam legíveis
pelas chaves anteriores. Até cinco chaves anteriores são aceitas para limitar o
custo de cada descriptografia.

## Estágio 2 — recifrar

Não remova uma chave anterior apenas porque o rollout terminou. Registros
existentes não são recifrados automaticamente nesta etapa. Mantenha as chaves
anteriores até executar e validar o processo completo de recifragem de dados.

Antes da recifragem, execute no backend:

```bash
npm run crypto:inventory
```

O comando é estritamente somente leitura e retorna apenas contagens agregadas
por domínio (`primary`, `previous` e `invalid`), sem IDs, ciphertext ou
plaintext. Código de saída `2` indica payload inválido e bloqueia a recifragem.

### Recifrar Secrets do cofre

Execute primeiro sem argumentos:

```bash
npm run crypto:rewrap-vault-secrets
```

Após backup e validação do relatório, use a contagem `previous` retornada:

```bash
npm run crypto:rewrap-vault-secrets -- \
  --apply \
  --expected-previous=CONTAGEM \
  --confirm=REWRAP_VAULT_SECRETS
```

O apply afeta somente o modelo `Secret`, em lotes de 100, e compara ciphertext
e IV anteriores antes de atualizar. Interferência concorrente interrompe o
processo; uma nova execução é segura porque payloads primários são ignorados.

## Rollback

Se o rollout falhar, restaure a chave anterior como `PEM_ENCRYPTION_KEY` e
mantenha a nova temporariamente em `PEM_ENCRYPTION_PREVIOUS_KEYS`. Não apague
nenhuma chave enquanto houver dados que possam ter sido escritos com ela.

## Segurança

- armazene ambas as variáveis somente em Secret/cofre, nunca em ConfigMap;
- não registre, compare ou exponha valores das chaves em métricas;
- faça backup seguro das chaves fora do dump do banco;
- payload que não autentica com nenhuma chave falha de forma fechada.
