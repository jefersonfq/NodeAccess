# Homologação funcional — NA-0174

Candidato: `15938ada5b1a62e54870bfe50411bbce9f0a4f41`.
PR: https://github.com/jefersonfq/NodeAccess/pull/64.
Estado: **pendente de validação humana**. Este roteiro não registra aprovação nem execução manual.
Gates técnicos no SHA final aprovados: Sonar local/remoto e demais checks CI PASS.
Consultar `implementation.md` e o PR para evidências e limites.

Usar ambiente de homologação com tenant, usuários e hosts descartáveis. Registrar somente
rótulos dos cenários, versão, resultado e data; nunca tokens, senhas ou dados pessoais.

## Cenários de aceite

1. **Sessão e permissões:** abrir terminal e executar logout de todas as sessões; o canal antigo
   deve encerrar e o acesso antigo ser negado. Novo login legítimo deve funcionar. Com um
   administrador separado, conferir também desativação/rebaixamento e remoção de connect.
2. **Identidade SSH e bastion:** conexão com chave confiável funciona; alvo ou salto divergente
   é rejeitado antes da autenticação. Bastion legado sem Host de origem deve orientar a
   regularização; a chave do salto não deve ser apresentada como chave confiável do alvo.
3. **SFTP e auditoria:** listar/transferir arquivo de teste; revogar acesso durante transferência
   e conferir cancelamento sem mensagem falsa de sucesso. Arquivo já parcialmente escrito pode
   permanecer. Conferir o motivo de encerramento no registro de sessão/auditoria disponível.
4. **Experiência de uso:** terminal, resize e manual continuam utilizáveis; Central informa
   controles sem afirmar ativação/configuração específica do tenant.

## Limites do aceite

Os laboratórios automatizados cobrem os cenários descritos nas evidências da frente. RDP/VNC
foram exercitados por contratos com transporte injetado, sem sessão gráfica wire real nesta
rodada. Redis Pub/Sub não tem entrega durável e evento tardio pode fechar uma reconexão válida.
Não há alegação de pentest completo ou validação de produção.

## Registro humano

- Data/hora e versão homologada: pendentes.
- Cenários efetivamente conferidos e resultado: pendentes.
- Decisão de aceite ou ajustes: pendente.

Após aceite explícito e todos os checks obrigatórios aprovados no SHA atual, integrar o PR e
sincronizar master. Nenhuma implantação em produção faz parte desta rodada.
