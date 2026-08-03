# Estratégia de testes por mudança

Use validação proporcional ao risco. Toda mudança recebe validação lógica e testes diretamente afetados. Mudanças de fluxo incluem integração e regressão; interfaces relevantes incluem navegador, estados e responsividade; banco, concorrência e caminhos críticos usam ambiente isolado e dados representativos.

Classifique cada evidência como `Ran`, `Skipped`, `Planned` ou `Manual`. Somente `Ran` é resultado executado. Registre comando, ambiente, horário, SHA e resultado; nunca associe evidência de um commit anterior ao HEAD do PR.

O quality gate executa lint, typecheck, testes, validação da governança e build. O validador independente deve tentar encontrar regressões de comportamento, segurança, concorrência, recursos e compatibilidade, em vez de confiar no relatório da implementação.

Carga artificial em produção exige autorização explícita. Falhas de baseline não são ocultadas: devem ser documentadas, reproduzidas e corrigidas ou aceitas formalmente com risco.
