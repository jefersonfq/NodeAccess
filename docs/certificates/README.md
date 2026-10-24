# Certificados públicos da assinatura privada

Estes arquivos contêm somente certificados públicos. Não contêm chave privada,
senha nem autorização para assinar novos aplicativos. O EXE/MSI2.1.0 foi assinado
por NodeAccess Private Publisher, emitido pela raiz privada de assinatura de código.

| Arquivo | SHA-256 do certificado DER |
| --- | --- |
| nodeaccess-code-signing-root.cer | 934A64AC01794E620B0EE8CB7EF80DF22749D4C9D7D2A83957969E077CF2A4CF |
| nodeaccess-publisher.cer | F4C7EBE0C2526F06E35AB443AF181407FABD948CD1DBF268556A2B40CE7849C1 |

Confira a origem do pacote e os fingerprints por um canal confiável antes de
conceder confiança. Cada pessoa ou administrador decide a instalação dos
certificados. Nada no instalador importa a raiz automaticamente. Para o usuário
Windows que aceitar esta identidade privada, a raiz pertence ao repositório de
Autoridades de Certificação Raiz Confiáveis e o certificado do editor ao de
Editores Confiáveis. Políticas corporativas podem exigir ação do administrador.

A confiança é na identidade de assinatura, não apenas em uma versão específica.
A raiz está restrita a assinatura de código; não deve ser usada para HTTPS.
O Windows ainda pode mostrar alertas de reputação/SmartScreen ou bloquear o app
conforme a política local. Isso não equivale a um certificado público comercial.
Não desative a verificação de assinatura ou as proteções do Windows para instalar.

Verificação sem instalar certificados:

```powershell
Get-FileHash .\nodeaccess-code-signing-root.cer -Algorithm SHA256
Get-FileHash .\nodeaccess-publisher.cer -Algorithm SHA256
Get-AuthenticodeSignature .\nodeaccess-agent-windows-x64.msi
```

Consulte também `docs/OPERATIONS-agent-windows-installer.md`. Material privado
permanece no armazenamento restrito do responsável pela release e não deve ser
copiado para usuários, sites, imagem Docker ou pacote de distribuição.
