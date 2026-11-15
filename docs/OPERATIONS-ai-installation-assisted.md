# Preparação assistida de Ollama — NA-0083

O NodeAccess gera um script revisável e um manifesto, sem se conectar por SSH nem
instalar software. A máquina ainda não foi escolhida; Linux/Docker é o perfil
suportado pelo pacote, não uma decisão sobre o ambiente do usuário.

Na jornada de IA, informe `ollama/ollama:<versão>` (versão explícita no formato
numérico major.minor.patch, opcionalmente prerelease) ou
`ollama/ollama@sha256:<digest>`. Não há imagem padrão nem `latest`. Escolha uma
versão suportada no seu ambiente após consultar as releases oficiais. O modelo
inicial é `qwen2.5-coder:3b`, herdado do produto, sem promessa de desempenho.

A rota administrativa `POST /api/v1/integrations/local-ai/installation-plan`
confere feature, licença e política de trial do tenant autenticado. A resposta
contém `script`, `fileName`, `sha256`, `manifest` e instruções. O SHA-256 é calculado
sobre os bytes UTF-8 exatos do script; o manifesto inclui `scriptSha256` e `planId`.
Não envie senha, chave privada, URL arbitrária ou comandos: esses campos não fazem
parte do contrato.

## Revisão e execução manual

1. Baixe script e manifesto; revise imagem, modelo, recursos e ações.
2. Confira o hash local com `sha256sum arquivo.sh` e compare com o manifesto recebido.
3. Transfira os arquivos pelo método operacional aprovado para a máquina escolhida.
4. Execute `bash arquivo.sh --check`. Esse é também o comportamento sem argumentos.
5. Somente após revisar o preflight, execute
   `bash arquivo.sh --apply --validate-generation` para instalar e testar uma geração.

A flag `--apply` permite alterações. A flag adicional `--validate-generation`
solicita explicitamente um teste curto, que consome recursos do modelo; sem ela o
resultado é apenas `prepared`. Nenhuma dessas etapas homologa ou ativa monitoramento
no NodeAccess. O endpoint e o modelo precisam ser configurados/validados na aplicação.

Pré-requisitos: Linux x86_64/aarch64, Python 3.6+ com biblioteca padrão, acesso ao
Docker local e espaço disponível no armazenamento do daemon. O script não instala
Docker nem usa sudo automaticamente. NVIDIA é opcional e exige driver,
`nvidia-smi` e runtime NVIDIA já configurados. Não altera driver, reinicia Docker
ou configura GPU. As verificações de RAM total, disco livre e VRAM são mínimos
escolhidos no plano, não garantias de que o modelo caberá ou terá desempenho adequado.

## O que o pacote faz

- Usa lock local compartilhado por instalação e valida ownership do lock.
- Confere plataforma, Docker local, capacidade e conflito da porta 11434.
- Recusa container/volume preexistente sem labels gerenciadas. Container gerenciado
  precisa corresponder ao mesmo plano, imagem, bind, volume e política de restart.
- Baixa somente a imagem informada; cria `na-ollama` e volume `na-ollama-models` com
  labels próprias; inicia com `--restart=no` e `OLLAMA_NO_CLOUD=1`.
- Publica exclusivamente `127.0.0.1:11434:11434`. Não altera firewall ou proxy.
- Aguarda a API, confere versão (quando a imagem usa tag), baixa o modelo somente
  se ausente, exige conclusão do download e modelo listado com digest.
- Opcionalmente testa geração curta. Progresso é JSON com campos permitidos; logs
  arbitrários do Docker/provedor não são devolvidos.

Os comandos têm timeout. Pull de imagem tem até 30 minutos; pull de modelo tem
limite de uma hora verificado entre mensagens e timeout de leitura de 120 segundos.
A rede HTTP usa somente loopback, ignora proxies do ambiente e rejeita redirects.

## Rede e segurança

A API local do Ollama não exige autenticação. Não exponha a porta publicamente.
`127.0.0.1` é o servidor onde o pacote foi executado: o backend NodeAccess em outra
máquina ou container não alcançará automaticamente esse endereço. Defina uma rota
privada protegida, proxy autenticado/TLS ou túnel SSH separadamente antes de salvar
uma URL utilizável no NodeAccess. O pacote não cria túneis nem recebe credenciais.

A execução manual deve usar ambiente confiável (PATH, Python, Docker e socket).
Acesso ao daemon Docker é privilegiado; a validação não transforma uma conta com
acesso Docker em conta restrita. Modelos e imagens continuam sujeitos à revisão
operacional da organização.

## Falhas, repetição e recuperação

A repetição do mesmo plano reutiliza container e modelo já presentes sem recriação
ou novo pull. Diferença de plano/configuração bloqueia e exige revisão; o pacote
não substitui automaticamente instalação existente. A política `restart=no` evita
introduzir recuperação automática antes de homologação.

Se houver falha de download, geração ou interrupção, o script não remove container,
volume, imagem ou camadas parciais. Inspecione o estado antes de repetir. Cancelar
o processo não é rollback; um Docker pull já aceito pelo daemon pode continuar.
Não há claim de cancelamento remoto ou reversão integral. O arquivo de lock permanece
para evitar corrida de troca de inode; o lock é liberado quando o processo encerra.

A remoção de recursos e recuperação de instalação alheia ficam fora deste pacote.
Watchdog só pode ser habilitado posteriormente, após homologação explícita da
configuração salva, e observa sem executar restart, instalação ou reparos.

## Validação e limites

Testes automatizados executam o Bash/Python gerado com Docker, capacidade, porta e
HTTP simulados. Cobrem injeção, autenticação/admin/tenant, falhas de preflight,
ownership, hash exato, idempotência e falhas de download sem vazamento. Isso não
certifica instalação real, GPU ou capacidade/performance de um modelo. Nenhuma
máquina real foi provisionada nesta frente.

## Referências oficiais

- [Docker e GPU](https://docs.ollama.com/docker)
- [Linux e versões explícitas](https://docs.ollama.com/linux)
- [Autenticação da API](https://docs.ollama.com/api/authentication)
- [FAQ: bind, modelos e cloud](https://docs.ollama.com/faq)
- [Tags: digest hexadecimal do modelo](https://docs.ollama.com/api/tags)
- [API: pull, tags e geração](https://github.com/ollama/ollama/blob/main/docs/api.md)
