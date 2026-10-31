# Chat da equipe (29/10/2026)

Conversa entre os usuários do MEU BLING, dentro do sistema e só com o navegador — sem telefone, sem VoIP, sem aplicativo de terceiros.

## O que faz
- **Conversa direta**: qualquer funcionário manda mensagem para qualquer outro (uma conversa por par de pessoas).
- **Sala de reunião privada**: qualquer um cria, escolhendo as pessoas. Quem está na sala pode incluir mais gente; quem criou (ou ADMIN/GERENTE) tira pessoas e renomeia; qualquer um sai.
- **Texto** (Enter envia, Shift+Enter quebra linha), **resposta** a uma mensagem, **links** clicáveis, **apagar** (autor ou ADMIN).
- **Áudio gravado** (toque no microfone, grave, toque em enviar — até 5 min) e **anexos** (imagem ou PDF, até 25 MB). Ficam guardados para sempre em `storage/chat/aaaa-mm/`.
- **Chamada de voz e de vídeo** (1 para 1 e em sala): WebRTC — áudio/vídeo vão direto de um navegador para o outro; o servidor só faz a apresentação. Aviso de chamada toca em qualquer tela do sistema; janela flutuante com microfone, câmera, expandir e desligar. Em sala, cada um conecta com cada um (bom até ~5 pessoas em vídeo).
- **Presença**: online / ausente (aba em segundo plano) / em chamada; "fulano está digitando…"; check duplo quando todos leram.
- **Avisos**: toast e som em qualquer tela; notificação do navegador com a aba em segundo plano; card "Mensagens da equipe" no Meu Dashboard de todo perfil; contador no ícone do topo.
- **Aviso no celular com o sistema fechado** (Web Push): Informações da conversa → "Ligar neste aparelho". No iPhone, antes adicione o MEU BLING à tela de início (Compartilhar → Adicionar à Tela de Início). As chaves VAPID são criadas uma vez e ficam criptografadas em `Configuracao` (`chat.vapid`).
- **ADMIN pode abrir e ler qualquer conversa** (aba "Todas" na caixa de entrada) — decisão do Thiago. Não escreve nas conversas de que não participa.
- **Chamar atenção** (nudge, no estilo do MSN): botão **Atenção** (raio) no topo da conversa. A tela de quem recebe treme por cerca de 1 segundo, toca um som curto e o histórico ganha "Fulano chamou sua atenção". O mesmo tempo real do chat entrega o evento (`atencao` no WebSocket ou no long polling). Anti-spam: 1 tremor a cada 30 segundos por remetente → destinatário.

## WhatsApp do "chamar atenção"

O aviso no celular reutiliza o WhatsApp que a loja já tem — não há URL nem token novos.

1. **Ligar o robô** em Configurações → WhatsApp (só ADMIN):
   - **Evolution API** (padrão quando preenchida): endereço, instância e chave ficam nessa tela, criptografados. É o mesmo número do CRM, dos orçamentos e da cobrança.
   - **Sessão própria (Baileys)**: com a Evolution desligada, gere o QR Code na mesma tela e escaneie com o WhatsApp da loja. A sessão fica em `storage/whatsapp`.
2. **Celular de quem vai ser chamado**: Configurações → Usuários → campo **WhatsApp (celular)**. DDD + número basta (o 55 entra sozinho). Se o usuário não tiver o campo preenchido, o sistema tenta o telefone do vendedor ou do técnico vinculado.
3. O texto sai assim: `Fulano está chamando sua atenção no sistema: <APP_URL><BASE_PATH>/chat/<id>`.
4. WhatsApp no máximo **1 vez a cada 5 minutos** para o mesmo par. Sem celular, com número inválido ou com o WhatsApp da loja desconectado, a tela treme mesmo assim e o botão avisa o motivo (nada é inventado nem enviado).

## Como está feito
- API: `apps/api/src/modules/chat/` — `routes.ts` (REST + WebSocket), `service.ts` (regras), `hub.ts` (conexões, presença, fila de eventos por usuário), `push.ts` (Web Push).
  Tabelas: `Conversa`, `ConversaParticipante` (lidaAteId, silenciadaAte, saiuEm), `Mensagem`, `Chamada`, `PushAssinatura`.
- Tela: `apps/web/src/pages/chat/` (caixa de entrada, conversa, balão, compositor com gravador, sala, informações), `components/chat/` (ligação, chamada recebida, janela da chamada, ícone do topo, card do dashboard), `lib/chat/` (tempo real, WebRTC, PWA/push, sons), `stores/chat.ts`.
- Tempo real: WebSocket em `GET /api/v1/chat/ws` (autentica pela primeira mensagem `{tipo:'auth', token}`; aceita só a origem do sistema). Quando o WebSocket não conecta (proxy no caminho), o navegador cai sozinho para **long polling** em `GET /api/v1/chat/eventos?desde=N` e tenta o WebSocket de novo a cada 2 minutos. Nada se perde: cada usuário tem uma fila numerada dos últimos eventos.
- Arquivos do chat (`/uploads/chat/*`) exigem login e aceitam `Range` (o player do Safari precisa).

## Publicação (VPS www.balao.info/sistema)
O site na Vercel repassa `www.balao.info/sistema` para a VPS, e esse repasse **não carrega WebSocket**. Por isso o `deploy/vps/instalar-vps.sh` grava em `/etc/meu-bling.env`:
- `CHAT_REALTIME_URL=https://<host da VPS>/sistema` — o navegador liga o WebSocket direto na VPS (Caddy → container). Se a variável estiver vazia, liga na própria origem.
- `TURN_HOST`, `TURN_PORT=3478`, `TURN_SECRET` — servidor TURN (**coturn**, container `meu-bling-turn`, rede do host) para as chamadas de quem está fora da loja (4G, roteador restritivo). A API gera credenciais temporárias (12 h) por usuário; sem TURN configurado, só STUN (funciona dentro da loja e na maioria das redes domésticas).
  Portas: 3478 udp/tcp e 49160–49200 udp. Se o firewall da Hostinger (hPanel) estiver ligado, libere-as.
- Opcional: `TURN_TLS_PORT` quando houver certificado no coturn (`turns:`).

Mesma coisa num servidor novo (ex.: o HP Gen9 quando migrar): rode o instalador; ele cria o que faltar no `.env` e sobe o coturn.

## API (resumo)
```
GET  /chat/config · GET /chat/ws (WebSocket) · GET /chat/eventos?desde=&espera= · GET /chat/usuarios · GET /chat/nao-lidas
GET  /chat/conversas[?todas=1] · POST /chat/conversas {tipo:'DIRETA',usuarioId} | {tipo:'SALA',nome,usuarioIds}
GET  /chat/conversas/:id · PUT {nome} · POST /participantes {usuarioIds} · DELETE /participantes/:usuarioId · POST /silenciar {ate}
GET  /chat/conversas/:id/mensagens?antesDe=&limite= · POST {texto,respondeAId?} · POST /audio (multipart) · POST /arquivo (multipart)
POST /chat/conversas/:id/lida {ateId?} · POST /digitando · POST /atencao · DELETE /chat/mensagens/:id
POST /chat/conversas/:id/chamadas {tipo} · GET /chat/chamadas/ativas · POST /chat/chamadas/:id/entrar|recusar|sair|rtc
POST /chat/push/assinar {subscription} · POST /chat/push/cancelar {endpoint} · GET /chat/push/assinaturas
```
As rotas do chat ficam fechadas para chaves de API externas (não estão no catálogo de recursos).

## Testes
`apps/api/testes/chat.ts` (roda no `npm test`): direta, sala, áudio, lida, WebSocket/polling, chamadas, push, permissões, ADMIN lê tudo, chamar atenção (evento, histórico, anti-spam de 30 s e de 5 min no WhatsApp).
