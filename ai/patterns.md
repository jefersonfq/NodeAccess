Padroes de trabalho:
- carregue contexto minimo primeiro
- nao use `docs/PRD.txt` por padrao
- leia apenas o modulo relevante em `ai/modules/*`
- prefira mudar pouco e validar cedo

Padroes do repo:
- backend separado em API (`APP_MODE=api`) e gateway SSH (`APP_MODE=gateway`)
- shared concentra schemas/tipos reutilizaveis
- frontend consome API e WebSocket; terminal vive no app Vue
- contexto de terminal mais detalhado fica em `ai/terminal/*`

Quando responder ou gerar codigo:
- preserve nomes e estruturas existentes
- evite repetir contexto do produto em cada prompt
- cite arquivo e modulo tocado em vez de colar blocos longos
- se faltar regra de negocio, consulte o PRD no trecho necessario
