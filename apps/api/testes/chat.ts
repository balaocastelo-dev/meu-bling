/**
 * CHAT DA EQUIPE (29/10/2026) — conversa direta, sala de reunião privada, texto, áudio gravado, lida,
 * presença/tempo real (WebSocket e long polling), chamadas de voz/vídeo (sinalização) e avisos (push).
 * Decisões do Thiago: todo mundo fala com todo mundo; todo mundo cria sala; o ADMIN lê qualquer conversa;
 * quem não participa não entra; áudios guardados; aviso no celular com o sistema fechado.
 *   npx tsx testes/chat.ts http://localhost:3333
 */
import WebSocket from 'ws';
import { BASE, aguardar, encerrar, entrar, espera, secao, SUF, verifica } from './lib.js';
import { INTERVALO_ATENCAO_MS, INTERVALO_WHATSAPP_MS, limparLimitesAtencao, podeAtencao, podeWhatsapp, registrarAtencao, registrarWhatsapp } from '../src/modules/chat/atencao-limite.js';

async function conectarWs(token: string) {
  const eventos: any[] = [];
  const ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/chat/ws');
  await new Promise<void>((res, rej) => {
    ws.on('open', res);
    ws.on('error', rej);
  });
  ws.on('message', (d) => eventos.push(JSON.parse(String(d))));
  ws.send(JSON.stringify({ tipo: 'auth', token }));
  await aguardar(async () => eventos, (l) => l.some((e) => e.tipo === 'pronto'));
  return { ws, eventos, tem: (tipo: string, fn?: (e: any) => boolean) => eventos.some((e) => e.tipo === tipo && (!fn || fn(e))) };
}

async function main() {
  const adm = await entrar('admin@balao.info', 'admin123');
  adm.nome = 'ADMIN';
  const senha = 'senha-chat-12345';
  secao('Cadastros: vendedor, técnico e gerente com login');
  const vend = await adm.post('/vendedores', { nome: `Vend Chat ${SUF}` }, 201);
  const uV = await adm.post('/usuarios', { nome: `Vend Chat ${SUF}`, email: `vchat${SUF}@teste.com`, senha, perfil: 'VENDEDOR', vendedorId: vend.id }, 201);
  const tec = await adm.post('/tecnicos', { nome: `Tec Chat ${SUF}`, comissaoPadraoPct: 0, ativo: true }, [200, 201]);
  const uT = await adm.post('/usuarios', { nome: `Tec Chat ${SUF}`, email: `tchat${SUF}@teste.com`, senha, perfil: 'TECNICO', tecnicoId: tec.id }, 201);
  const uG = await adm.post('/usuarios', { nome: `Ger Chat ${SUF}`, email: `gchat${SUF}@teste.com`, senha, perfil: 'GERENTE' }, 201);
  const V = await entrar(`vchat${SUF}@teste.com`, senha);
  V.nome = 'VENDEDOR';
  const T = await entrar(`tchat${SUF}@teste.com`, senha);
  T.nome = 'TECNICO';
  const G = await entrar(`gchat${SUF}@teste.com`, senha);
  G.nome = 'GERENTE';
  const eu = await adm.get('/auth/eu');

  secao('Configuração e pessoas');
  const cfg = await V.get('/chat/config');
  verifica(Array.isArray(cfg.iceServers) && cfg.iceServers.length >= 1, 'config traz servidores STUN/TURN', cfg.iceServers);
  verifica(typeof cfg.pushPublicKey === 'string' && cfg.pushPublicKey.length > 20, 'config traz a chave pública do push', cfg.pushPublicKey);
  const pessoas = await V.get('/chat/usuarios');
  verifica(pessoas.some((p: any) => p.id === eu.id) && pessoas.some((p: any) => p.id === uT.id), 'vendedor vê todos os usuários ativos', pessoas.length);
  verifica(pessoas.find((p: any) => p.id === uV.id)?.eu === true, 'o próprio usuário vem marcado como "eu"');

  secao('Tempo real: WebSocket com presença');
  const wsT = await conectarWs(T.token);
  const pronto = wsT.eventos.find((e) => e.tipo === 'pronto');
  verifica(pronto.usuarioId === uT.id && typeof pronto.naoLidas === 'number', 'WebSocket autentica pela 1ª mensagem e devolve "pronto"', pronto);
  const online = await V.get('/chat/usuarios');
  verifica(online.find((p: any) => p.id === uT.id)?.online === true, 'técnico aparece online para os outros depois de conectar');
  const ruim = new WebSocket(BASE.replace(/^http/, 'ws') + '/chat/ws');
  const fechou = await new Promise<number>((res) => {
    ruim.on('open', () => ruim.send(JSON.stringify({ tipo: 'auth', token: 'token-invalido' })));
    ruim.on('close', (code) => res(code));
  });
  verifica(fechou === 4401, 'token inválido fecha o WebSocket com 4401', fechou);

  secao('Conversa direta: uma só por par, mensagem chega em tempo real, não lidas e lida');
  const d1 = await V.post('/chat/conversas', { tipo: 'DIRETA', usuarioId: uT.id }, 201);
  const d2 = await T.post('/chat/conversas', { tipo: 'DIRETA', usuarioId: uV.id }, 200);
  verifica(d1.id === d2.id && d1.tipo === 'DIRETA', 'abrir a direta dos dois lados devolve a mesma conversa', [d1.id, d2.id]);
  verifica(d2.nome === `Vend Chat ${SUF}`, 'para o técnico a conversa tem o nome do vendedor', d2.nome);
  await V.post('/chat/conversas', { tipo: 'DIRETA', usuarioId: uV.id }, 422);
  const m1 = await V.post(`/chat/conversas/${d1.id}/mensagens`, { texto: 'Oi, a OS 12 está pronta?' }, 201);
  await aguardar(async () => wsT.eventos, () => wsT.tem('mensagem', (e) => e.mensagem.id === m1.id));
  verifica(wsT.tem('mensagem', (e) => e.mensagem.id === m1.id), 'técnico recebeu a mensagem pelo WebSocket na hora');
  const nl = await T.get('/chat/nao-lidas');
  verifica(nl.total === 1 && nl.porConversa[d1.id] === 1, 'técnico tem 1 não lida nessa conversa', nl);
  const caixa = await T.get('/chat/conversas');
  const item = caixa.find((c: any) => c.id === d1.id);
  verifica(item?.naoLidas === 1 && item.ultimaMensagem?.texto === m1.texto, 'caixa de entrada traz última mensagem e não lidas', item);
  const lida = await T.post(`/chat/conversas/${d1.id}/lida`, {});
  verifica(lida.lidaAteId === m1.id && (await T.get('/chat/nao-lidas')).total === 0, 'marcar como lida zera as não lidas');
  const quemLeu = (await V.get(`/chat/conversas/${d1.id}`)).participantes.find((p: any) => p.id === uT.id);
  verifica(quemLeu?.lidaAteId === m1.id, 'vendedor vê até onde o técnico leu (check duplo)', quemLeu);
  const resp = await T.post(`/chat/conversas/${d1.id}/mensagens`, { texto: 'Fica pronta às 15h', respondeAId: m1.id }, 201);
  verifica(resp.respondeAId === m1.id, 'resposta a uma mensagem guarda a referência');
  await V.post(`/chat/conversas/${d1.id}/mensagens`, { texto: '   ' }, 400);
  const lista = await V.get(`/chat/conversas/${d1.id}/mensagens?limite=10`);
  verifica(lista.length === 2 && lista[0].id === m1.id, 'mensagens vêm em ordem, da mais antiga para a mais nova', lista.map((m: any) => m.id));

  secao('Quem não participa não entra; o ADMIN lê qualquer conversa');
  await G.get(`/chat/conversas/${d1.id}`, 403);
  await G.get(`/chat/conversas/${d1.id}/mensagens`, 403);
  await G.post(`/chat/conversas/${d1.id}/mensagens`, { texto: 'invasão' }, 403);
  const admVe = await adm.get(`/chat/conversas/${d1.id}/mensagens`);
  verifica(admVe.length === 2, 'ADMIN abre e lê a conversa dos outros', admVe.length);
  const todas = await adm.get('/chat/conversas?todas=1');
  verifica(todas.some((c: any) => c.id === d1.id), 'ADMIN lista todas as conversas do sistema');
  const todasG = await G.get('/chat/conversas?todas=1');
  verifica(!todasG.some((c: any) => c.id === d1.id), 'gerente com todas=1 só vê as dele');
  await adm.post(`/chat/conversas/${d1.id}/mensagens`, { texto: 'admin não participa' }, 403);

  secao('Áudio gravado e arquivo: guardados no storage, só com login');
  const form = new FormData();
  form.append('arquivo', new Blob([new Uint8Array(4000)], { type: 'audio/webm' }), 'audio.webm');
  form.append('duracaoSeg', '9');
  const ra = await fetch(`${BASE}/chat/conversas/${d1.id}/audio`, { method: 'POST', headers: { authorization: `Bearer ${V.token}` }, body: form });
  const audio = await ra.json();
  verifica(ra.status === 201 && audio.tipo === 'AUDIO' && audio.duracaoSeg === 9 && /^\/uploads\/chat\//.test(audio.arquivo), 'áudio gravado vira mensagem com duração e arquivo', audio);
  const semLogin = await fetch(BASE.replace('/api/v1', '') + audio.arquivo);
  verifica(semLogin.status === 401, 'arquivo do chat exige login', semLogin.status);
  const comRange = await fetch(BASE.replace('/api/v1', '') + audio.arquivo, { headers: { authorization: `Bearer ${T.token}`, range: 'bytes=0-9' } });
  verifica(comRange.status === 206 && comRange.headers.get('content-range') === 'bytes 0-9/4000', 'player pode pedir pedaços do áudio (Range)', comRange.headers.get('content-range'));
  const fExe = new FormData();
  fExe.append('arquivo', new Blob([new Uint8Array(100)], { type: 'application/x-msdownload' }), 'virus.exe');
  const rExe = await fetch(`${BASE}/chat/conversas/${d1.id}/arquivo`, { method: 'POST', headers: { authorization: `Bearer ${V.token}` }, body: fExe });
  verifica(rExe.status === 422, 'arquivo que não é imagem/PDF é recusado', rExe.status);
  await V.post(`/chat/conversas/${d1.id}/audio`, {}, 400);

  secao('Sala de reunião privada: criar, incluir, tirar, sair, renomear');
  const sala = await V.post('/chat/conversas', { tipo: 'SALA', nome: `Reunião ${SUF}`, usuarioIds: [uT.id] }, 201);
  verifica(sala.tipo === 'SALA' && sala.participantes.length === 2 && sala.criadoPorId === uV.id, 'vendedor (qualquer um) cria sala com quem escolher', sala);
  await aguardar(async () => wsT.eventos, () => wsT.tem('conversa', (e) => e.conversa.id === sala.id));
  verifica(wsT.tem('conversa', (e) => e.conversa.id === sala.id), 'técnico foi avisado da sala nova pelo WebSocket');
  await G.get(`/chat/conversas/${sala.id}`, 403);
  await T.post(`/chat/conversas/${sala.id}/participantes`, { usuarioIds: [uG.id] });
  verifica((await G.get(`/chat/conversas/${sala.id}`)).souParticipante === true, 'participante pode incluir mais gente; incluído passa a ver a sala');
  await G.put(`/chat/conversas/${sala.id}`, { nome: 'x' }, 400);
  await T.put(`/chat/conversas/${sala.id}`, { nome: 'Tentativa' }, 403);
  const ren = await V.put(`/chat/conversas/${sala.id}`, { nome: `Reunião ${SUF} v2` });
  verifica(ren.nome === `Reunião ${SUF} v2`, 'só quem criou (ou a gestão) renomeia', ren.nome);
  await T.del(`/chat/conversas/${sala.id}/participantes/${uG.id}`, 403);
  await V.del(`/chat/conversas/${sala.id}/participantes/${uG.id}`);
  await G.get(`/chat/conversas/${sala.id}/mensagens`); // histórico fica (já participou)
  await G.post(`/chat/conversas/${sala.id}/mensagens`, { texto: 'fui tirado' }, 403);
  await T.del(`/chat/conversas/${sala.id}/participantes/${uT.id}`);
  const depois = await V.get(`/chat/conversas/${sala.id}`);
  verifica(depois.participantes.length === 1, 'tirar e sair da sala deixam só quem ficou', depois.participantes.map((p: any) => p.nome));
  const sistema = await V.get(`/chat/conversas/${sala.id}/mensagens`);
  verifica(sistema.filter((m: any) => m.tipo === 'SISTEMA').length >= 4, 'cada mudança da sala vira mensagem do sistema', sistema.map((m: any) => m.texto));
  await V.del(`/chat/conversas/${d1.id}/participantes/${uV.id}`, 422);
  await V.post('/chat/conversas', { tipo: 'SALA', nome: 'Sem gente', usuarioIds: [] }, 400);

  secao('Apagar mensagem: só o autor ou o ADMIN');
  await T.del(`/chat/mensagens/${m1.id}`, 403);
  await V.del(`/chat/mensagens/${m1.id}`);
  const apagada = (await T.get(`/chat/conversas/${d1.id}/mensagens`)).find((m: any) => m.id === m1.id);
  verifica(apagada?.apagadaEm && apagada.texto === null, 'mensagem apagada some para todos (fica o aviso)', apagada);
  await adm.del(`/chat/mensagens/${resp.id}`);

  secao('Chamadas de voz e vídeo: convite, atender, sinalização, encerrar, registro na conversa');
  const wsV = await conectarWs(V.token);
  const ch = await V.post(`/chat/conversas/${d1.id}/chamadas`, { tipo: 'VIDEO' }, 201);
  verifica(ch.situacao === 'ATIVA' && ch.participantes.length === 1 && ch.participantes[0] === uV.id, 'chamada criada com quem ligou dentro', ch);
  await aguardar(async () => wsT.eventos, () => wsT.tem('chamada', (e) => e.acao === 'convite' && e.chamada.id === ch.id));
  verifica(wsT.tem('chamada', (e) => e.acao === 'convite' && e.chamada.id === ch.id), 'técnico recebeu o convite da chamada');
  verifica((await T.get('/chat/chamadas/ativas')).some((c: any) => c.id === ch.id), 'chamada aparece nas ativas do técnico');
  await G.post(`/chat/chamadas/${ch.id}/entrar`, {}, 403);
  const atendida = await T.post(`/chat/chamadas/${ch.id}/entrar`, {});
  verifica(atendida.participantes.length === 2 && atendida.atendidaEm, 'técnico atendeu: dois na chamada e hora do atendimento', atendida);
  wsT.ws.send(JSON.stringify({ tipo: 'rtc', chamadaId: ch.id, para: uV.id, dados: { sdp: { type: 'offer', sdp: 'v=0' } } }));
  await aguardar(async () => wsV.eventos, () => wsV.tem('rtc', (e) => e.de === uT.id && e.dados?.sdp?.type === 'offer'));
  verifica(wsV.tem('rtc', (e) => e.de === uT.id), 'oferta WebRTC do técnico chegou ao vendedor pelo WebSocket');
  await V.post(`/chat/chamadas/${ch.id}/rtc`, { para: uT.id, dados: { ice: null } });
  await aguardar(async () => wsT.eventos, () => wsT.tem('rtc', (e) => e.de === uV.id));
  verifica(wsT.tem('rtc', (e) => e.de === uV.id), 'sinalização por HTTP (reserva do long polling) também chega');
  const fim = await V.post(`/chat/chamadas/${ch.id}/sair`, {});
  verifica(fim.situacao === 'ENCERRADA', 'quando sobra uma pessoa a chamada termina', fim.situacao);
  await T.post(`/chat/chamadas/${ch.id}/entrar`, {}, 422);
  const registro = (await V.get(`/chat/conversas/${d1.id}/mensagens`)).find((m: any) => m.chamadaId === ch.id);
  verifica(registro?.tipo === 'CHAMADA' && /Chamada de vídeo/.test(registro.texto), 'a chamada fica registrada na conversa', registro?.texto);
  const ch2 = await T.post(`/chat/conversas/${d1.id}/chamadas`, { tipo: 'VOZ' }, 201);
  const rec = await V.post(`/chat/chamadas/${ch2.id}/recusar`, {});
  verifica(rec.situacao === 'RECUSADA', 'recusar na conversa direta encerra a chamada', rec.situacao);
  const ch3 = await T.post(`/chat/conversas/${d1.id}/chamadas`, { tipo: 'VOZ' }, 201);
  const desistiu = await T.post(`/chat/chamadas/${ch3.id}/sair`, {});
  verifica(desistiu.situacao === 'PERDIDA', 'quem ligou e desligou antes de atenderem: perdida', desistiu.situacao);

  secao('Long polling (reserva quando o WebSocket não passa) e avisos no celular');
  const lp0 = await G.get('/chat/eventos?desde=0&espera=10');
  verifica(typeof lp0.seq === 'number' && Array.isArray(lp0.eventos) && Array.isArray(lp0.online), 'primeira volta do polling devolve seq, eventos e quem está online', lp0);
  const salaG = await V.post('/chat/conversas', { tipo: 'SALA', nome: `Polling ${SUF}`, usuarioIds: [uG.id] }, 201);
  const lpSala = await G.get(`/chat/eventos?desde=${lp0.seq}&espera=10`);
  verifica(lpSala.eventos.some((e: any) => e.evento.tipo === 'conversa' && e.evento.conversa.id === salaG.id), 'polling entrega a sala nova (evento guardado na fila)');
  const p = G.get(`/chat/eventos?desde=${lpSala.seq}&espera=8000`);
  await espera(200);
  const mG = await V.post(`/chat/conversas/${salaG.id}/mensagens`, { texto: 'chegou pelo polling?' }, 201);
  const lp1 = await p;
  verifica(lp1.eventos.some((e: any) => e.evento.tipo === 'mensagem' && e.evento.mensagem.id === mG.id), 'mensagem acorda o long polling na hora', lp1.eventos.map((e: any) => e.evento.tipo));
  verifica((await V.get('/chat/usuarios')).find((u: any) => u.id === uG.id)?.online === true, 'quem usa o polling conta como online');
  await G.post('/chat/push/assinar', { subscription: { endpoint: `https://fcm.googleapis.com/fcm/send/teste-${SUF}`, keys: { p256dh: 'BPx' + 'a'.repeat(84), auth: 'abcdefghijklmnopq' } } });
  verifica((await G.get('/chat/push/assinaturas')).length === 1, 'navegador inscrito para avisos com o sistema fechado');
  await G.post('/chat/push/assinar', { subscription: { endpoint: 'nao-e-url', keys: { p256dh: 'x', auth: 'y' } } }, 400);
  await G.post('/chat/push/cancelar', { endpoint: `https://fcm.googleapis.com/fcm/send/teste-${SUF}` });
  verifica((await G.get('/chat/push/assinaturas')).length === 0, 'cancelar tira a inscrição');

  secao('Silenciar e digitando');
  const sil = await T.post(`/chat/conversas/${d1.id}/silenciar`, { ate: new Date(Date.now() + 3600_000).toISOString() });
  verifica(!!sil.silenciadaAte, 'conversa silenciada por 1 h');
  await T.post(`/chat/conversas/${d1.id}/silenciar`, { ate: 'data-inválida' }, 422);
  await V.post(`/chat/conversas/${d1.id}/digitando`, {});
  await aguardar(async () => wsT.eventos, () => wsT.tem('digitando', (e) => e.conversaId === d1.id && e.usuarioId === uV.id));
  verifica(wsT.tem('digitando', (e) => e.conversaId === d1.id), 'técnico vê "vendedor está digitando"');

  secao('Chamar atenção: tela treme em tempo real, histórico e anti-spam');
  await adm.put(`/usuarios/${uT.id}`, { telefone: '(19) 98888-7777', perfil: 'TECNICO', ativo: true, tecnicoId: tec.id });
  const cadastro = (await adm.get('/usuarios')).find((u: any) => u.id === uT.id);
  verifica(cadastro?.telefone === '(19) 98888-7777', 'cadastro do usuário guarda o celular (WhatsApp)', cadastro?.telefone);
  const at = await V.post(`/chat/conversas/${d1.id}/atencao`, {}, 201);
  verifica(at.mensagem?.tipo === 'SISTEMA' && at.mensagem.texto === `Vend Chat ${SUF} chamou sua atenção`, 'histórico ganha "Fulano chamou sua atenção"', at.mensagem?.texto);
  verifica(at.destinatarios?.length === 1 && at.destinatarios[0].usuarioId === uT.id && at.destinatarios[0].whatsapp === 'desconectado', 'com celular e WhatsApp da loja desligado, o tremor sai e o WhatsApp é pulado', at.destinatarios);
  await aguardar(async () => wsT.eventos, () => wsT.tem('atencao', (e) => e.conversaId === d1.id && e.de?.id === uV.id && e.mensagemId === at.mensagem.id));
  verifica(wsT.tem('atencao', (e) => e.conversaId === d1.id && e.de?.nome === `Vend Chat ${SUF}`), 'técnico recebe o evento de tremer a tela pelo WebSocket');
  verifica(!wsV.eventos.some((e) => e.tipo === 'atencao'), 'quem chamou não recebe o tremor');
  const hist = await T.get(`/chat/conversas/${d1.id}/mensagens`);
  verifica(hist.some((m: any) => m.id === at.mensagem.id && m.tipo === 'SISTEMA'), 'a mensagem de atenção fica no histórico dos dois');
  await V.post(`/chat/conversas/${d1.id}/atencao`, {}, 429);
  await G.post(`/chat/conversas/${d1.id}/atencao`, {}, 403);
  const dG = await V.post('/chat/conversas', { tipo: 'DIRETA', usuarioId: uG.id }, [200, 201]);
  const lpA0 = await G.get('/chat/eventos?desde=0&espera=10');
  const esperaAt = G.get(`/chat/eventos?desde=${lpA0.seq}&espera=8000`);
  await espera(200);
  const atG = await V.post(`/chat/conversas/${dG.id}/atencao`, {}, 201);
  verifica(atG.destinatarios?.[0]?.whatsapp === 'sem_telefone', 'sem celular no cadastro, a atenção acontece e o WhatsApp não é enviado', atG.destinatarios);
  const lpAt = await esperaAt;
  // o tremor e a mensagem de sistema saem juntos: o long polling acorda no primeiro e o seguinte fica na fila
  const lpSeguinte = lpAt.eventos.some((e: any) => e.evento?.tipo === 'atencao') ? { eventos: [] as any[] } : await G.get(`/chat/eventos?desde=${lpAt.seq}&espera=2000`);
  const eventosAt = [...lpAt.eventos, ...lpSeguinte.eventos];
  verifica(eventosAt.some((e: any) => e.evento?.tipo === 'atencao' && e.evento.conversaId === dG.id && e.evento.de?.id === uV.id), 'long polling também entrega o chamar atenção', eventosAt.map((e: any) => e.evento?.tipo));
  limparLimitesAtencao();
  const t0 = 1_700_000_000_000;
  registrarAtencao(1, 2, t0);
  registrarWhatsapp(1, 2, t0);
  verifica(!podeAtencao(1, 2, t0 + 29_000).ok && podeAtencao(1, 2, t0 + INTERVALO_ATENCAO_MS).ok, 'o tremor libera aos 30 segundos, por remetente → destinatário');
  verifica(!podeWhatsapp(1, 2, t0 + INTERVALO_ATENCAO_MS).ok && podeWhatsapp(1, 2, t0 + INTERVALO_WHATSAPP_MS).ok, 'o WhatsApp continua bloqueado até 5 minutos');
  verifica(podeAtencao(2, 1, t0).ok && podeWhatsapp(1, 3, t0).ok, 'outro sentido ou outro destinatário não entra no limite');

  secao('Presença ao desconectar');
  wsT.ws.close();
  await aguardar(async () => wsV.eventos, () => wsV.tem('presenca', (e) => e.usuarioId === uT.id && e.online === false));
  verifica(wsV.tem('presenca', (e) => e.usuarioId === uT.id && e.online === false), 'quem fecha o navegador fica offline para os outros');
  wsV.ws.close();

  encerrar('Chat da equipe');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
