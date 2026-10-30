/**
 * MERCADO LIVRE — OAuth e publicação (docs/JARVIS.md §8) — 29/10/2026
 * - Status e conexão sem credencial: avisa o que falta, não explode.
 * - O callback é público (o navegador volta do ML sem token) mas só aceita `code` válido.
 * - Client Secret nunca volta pela API.
 * - Publicar sem conta ligada marca PRECISA_CONFIGURAR/ERRO, nunca PUBLICADO.
 *   npx tsx testes/jarvis-mercadolivre.ts http://localhost:3333
 */
import { encerrar, entrar, secao, SUF, verifica } from './lib.js';

async function main() {
  const base = process.argv[2] || 'http://localhost:3333';
  const adm = await entrar('admin@balao.info', 'admin123');
  adm.nome = 'ADMIN';

  // o runner roda a suíte duas vezes no mesmo banco: parte de um estado conhecido
  await adm.post('/jarvis/ml/desconectar', {});
  await adm.put('/jarvis/config', { mlClientId: null });

  secao('Status sem Client ID cadastrado');
  const st: any = await adm.get('/jarvis/ml/status');
  verifica(st.conectado === false, 'conta não está ligada', st);
  verifica(st.configurado === false, 'sem Client ID, não está configurado', st);
  verifica(typeof st.redirectUri === 'string' && st.redirectUri.includes('/jarvis/ml/callback'), 'mostra o redirect URI para cadastrar no ML', st.redirectUri);

  secao('Conectar sem Client ID avisa o que falta');
  const erro: any = await adm.post('/jarvis/ml/conectar', {}, 422);
  verifica(String(erro?.erro ?? '').toLowerCase().includes('client id'), 'diz que falta o Client ID', erro?.erro);

  secao('Com Client ID, devolve o link de autorização');
  const segredoTeste = `secreta-${SUF}`;
  await adm.put('/jarvis/config', { mlClientId: '3415778559288261', mlClientSecret: segredoTeste });
  const link: any = await adm.post('/jarvis/ml/conectar', {});
  verifica(String(link.url).startsWith('https://auth.mercadolivre.com.br/authorization'), 'link oficial do ML', link.url);
  verifica(String(link.url).includes('client_id=3415778559288261'), 'leva o Client ID', link.url);
  verifica(String(link.url).includes('response_type=code'), 'fluxo de código de autorização');

  secao('O Client Secret nunca volta pela API');
  const cfg: any = await adm.get('/jarvis/config');
  verifica(!JSON.stringify(cfg).includes(segredoTeste), 'secret não aparece na configuração', cfg?.mlSecretMascarado);
  verifica(cfg.mlTemSecret === true, 'mas a tela sabe que existe um guardado', cfg?.mlTemSecret);
  verifica(cfg.mlClientId === '3415778559288261', 'o Client ID volta (é público)', cfg?.mlClientId);
  const st2: any = await adm.get('/jarvis/ml/status');
  verifica(!JSON.stringify(st2).includes(segredoTeste), 'nem no status');

  secao('Salvar com o secret em branco não apaga o que está lá');
  await adm.put('/jarvis/config', { mlClientId: '3415778559288261' });
  const cfg2: any = await adm.get('/jarvis/config');
  verifica(cfg2.mlTemSecret === true, 'o secret guardado continua', cfg2?.mlTemSecret);

  secao('Callback é público, mas não aceita qualquer coisa');
  // o navegador volta do ML sem JWT: se exigir login aqui, a conexão nunca fecha
  const semCode = await fetch(`${base}/api/v1/jarvis/ml/callback`);
  verifica(semCode.status !== 401, 'não exige login (o navegador volta sem token)', semCode.status);
  verifica(semCode.status === 400, 'sem code, recusa com 400', semCode.status);
  const comErro = await fetch(`${base}/api/v1/jarvis/ml/callback?error=access_denied&error_description=usuario+negou`);
  const htmlErro = await comErro.text();
  verifica(comErro.status === 400 && htmlErro.includes('negou'), 'mostra o motivo quando o usuário nega', comErro.status);
  // code inventado: o ML recusa, e isso tem que virar mensagem na tela, não 500
  const codeFalso = await fetch(`${base}/api/v1/jarvis/ml/callback?code=TG-codigo-invalido-${SUF}`);
  verifica(codeFalso.status !== 500, 'code inválido não quebra o servidor', codeFalso.status);
  const htmlFalso = await codeFalso.text();
  verifica(!htmlFalso.includes(segredoTeste), 'a página de erro não vaza o secret');

  secao('Publicar sem conta ligada não mente');
  const produto: any = await adm.post('/produtos', { nome: `Monitor Teste ${SUF}`, preco: 900, precoCusto: 600, ativo: true }, [200, 201]);
  const rasc: any = await adm.post('/jarvis/anuncios/rascunho', { produtoId: produto.id, condicao: 'novo' });
  const anuncio: any = await adm.post('/jarvis/anuncios', {
    produtoId: produto.id, titulo: rasc.titulo, descricao: rasc.descricao, preco: 900,
    condicao: 'novo', fotos: [], canais: ['MERCADO_LIVRE'], porCanal: rasc.porCanal,
  }, 201);
  const r: any = await adm.post(`/jarvis/anuncios/${anuncio.id}/publicar`, { canal: 'MERCADO_LIVRE' });
  verifica(r.situacao !== 'PUBLICADO', 'sem conta ligada, NUNCA marca publicado', r.situacao);
  verifica(['PRECISA_CONFIGURAR', 'ERRO'].includes(r.situacao), 'marca o que realmente aconteceu', r.situacao);
  verifica(!!r.erro, 'guarda o motivo para aparecer na tela', r.erro);

  secao('Desconectar');
  await adm.post('/jarvis/ml/desconectar', {});
  const st3: any = await adm.get('/jarvis/ml/status');
  verifica(st3.conectado === false, 'volta a desconectado', st3);

  secao('Só o gestor mexe');
  const senha = 'Senha@12345';
  await adm.post('/usuarios', { nome: `Vend ML ${SUF}`, email: `vml${SUF}@teste.com`, senha, perfil: 'VENDEDOR' }, [201, 409]);
  const vend = await entrar(`vml${SUF}@teste.com`, senha).catch(() => null);
  if (vend) {
    vend.nome = 'VENDEDOR';
    await vend.get('/jarvis/ml/status', 403);
    await vend.post('/jarvis/ml/conectar', {}, 403);
  }

  encerrar('Mercado Livre');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
