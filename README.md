# Diglive original — senha removida

Este pacote mantém a arquitetura original: Express + WebSocket para sinalização e gerenciamento de salas, com WebRTC para o vídeo. A única mudança funcional pretendida é remover a autenticação por senha/token.

## Executar
1. Instale Node.js 18 ou superior.
2. Na raiz do projeto, execute `npm install`.
3. Execute `npm start`.
4. Abra `http://localhost:6767`.

Para publicar no Northflank, use `npm install` como etapa de instalação e `npm start` como comando de inicialização. O serviço escuta em `0.0.0.0` e usa a variável `PORT` fornecida pela plataforma.

Atenção: sem a senha, qualquer pessoa que alcançar o site poderá entrar e iniciar/assistir transmissões.
