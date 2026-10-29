/**
 * CENTRAL DE ANÚNCIOS (docs/JARVIS.md §9) — 29/10/2026
 * - Rascunho do produto funciona SEM chave de IA (texto padrão).
 * - Canal com API publica sozinho; canal sem API é kit e diz por quê.
 * - Nenhum canal vira "publicado" sem alguém publicar de verdade.
 * - Só ADMIN.
 *   npx tsx testes/jarvis-anuncios.ts http://localhost:3333
 */
import { encerrar, entrar, igual, secao, SUF, verifica } from './lib.js';

async function main() {
  const adm = await entrar('admin@balao.info', 'admin123');
  adm.nome = 'ADMIN';

  const produto: any = await adm.post('/produtos', {
    nome: `Notebook Teste ${SUF}`, preco: 3500, precoCusto: 2000,
    marca: 'Dell', descricaoCurta: 'Notebook i5 16GB SSD 512', ativo: true,
  }, [200, 201]);

  secao('Catálogo de canais: quem publica sozinho e quem é kit');
  const canais: any[] = await adm.get('/jarvis/anuncios/canais');
  const ml = canais.find((c) => c.canal === 'MERCADO_LIVRE');
  const olx = canais.find((c) => c.canal === 'OLX');
  const google = canais.find((c) => c.canal === 'GOOGLE_MEU_NEGOCIO');
  verifica(ml?.modo === 'api', 'Mercado Livre é canal de API', ml?.modo);
  // a OLX não tem API pública; automatizar o site logado derruba a conta (docs/JARVIS.md §13)
  verifica(olx?.modo === 'kit', 'OLX é kit, e não automação de navegador', olx?.modo);
  verifica(!!olx?.observacao && olx.observacao.length > 20, 'o kit explica o motivo na tela', olx?.observacao);
  verifica(google?.modo === 'kit', 'Google Meu Negócio é kit até a aprovação', google?.modo);
  verifica(igual(olx?.limiteTitulo, 90) && igual(ml?.limiteTitulo, 60), 'limites de título por canal', { olx: olx?.limiteTitulo, ml: ml?.limiteTitulo });

  secao('Rascunho funciona mesmo sem chave de IA');
  const rasc: any = await adm.post('/jarvis/anuncios/rascunho', { produtoId: produto.id, condicao: 'usado' });
  verifica(!!rasc.titulo && rasc.titulo.length <= 90, 'tem título dentro do limite', rasc.titulo);
  verifica(!!rasc.descricao && rasc.descricao.length > 30, 'tem descrição', rasc.descricao?.slice(0, 60));
  verifica(rasc.descricao.includes('3 meses'), 'usado leva a garantia certa (3 meses)', rasc.descricao?.slice(0, 120));
  verifica(!!rasc.porCanal?.OLX && !!rasc.porCanal?.INSTAGRAM, 'traz texto para cada canal', Object.keys(rasc.porCanal ?? {}));
  const rascNovo: any = await adm.post('/jarvis/anuncios/rascunho', { produtoId: produto.id, condicao: 'novo' });
  verifica(rascNovo.descricao.includes('1 ano'), 'novo leva 1 ano de garantia');
  await adm.post('/jarvis/anuncios/rascunho', { produtoId: 999999 }, 404);

  secao('Criar anúncio: kit nasce pronto, canal de API nasce pendente');
  const anuncio: any = await adm.post('/jarvis/anuncios', {
    produtoId: produto.id, titulo: rasc.titulo, descricao: rasc.descricao, preco: 3500,
    condicao: 'usado', fotos: [], canais: ['MERCADO_LIVRE', 'OLX'], porCanal: rasc.porCanal, geradoPorIa: false,
  }, 201);
  const cML = anuncio.canais.find((c: any) => c.canal === 'MERCADO_LIVRE');
  const cOLX = anuncio.canais.find((c: any) => c.canal === 'OLX');
  verifica(cML?.situacao === 'PENDENTE', 'Mercado Livre entra como pendente', cML?.situacao);
  verifica(cOLX?.situacao === 'KIT_PRONTO', 'OLX já entra como kit pronto', cOLX?.situacao);
  verifica(!!cOLX?.texto, 'o kit guarda o texto adaptado para copiar');
  await adm.post('/jarvis/anuncios', { titulo: 'x', descricao: 'y', preco: 1, canais: [] }, 400);

  secao('Nada vira "publicado" sem publicar de verdade');
  // sem conta conectada, o Mercado Livre precisa dizer o que falta — não fingir que publicou
  const tentativa: any = await adm.post(`/jarvis/anuncios/${anuncio.id}/publicar`, { canal: 'MERCADO_LIVRE' });
  verifica(tentativa.situacao === 'PRECISA_CONFIGURAR', 'sem conta ligada, avisa em vez de publicar', tentativa.situacao);
  verifica(!!tentativa.erro && tentativa.erro.includes('Mercado Livre'), 'diz qual canal e o que falta', tentativa.erro);
  // pedir para a API publicar num canal de kit tem que ser recusado com explicação
  await adm.post(`/jarvis/anuncios/${anuncio.id}/publicar`, { canal: 'OLX' }, 422);

  secao('Marcar "publiquei" depois de publicar o kit à mão');
  const marcado: any = await adm.post(`/jarvis/anuncios/${anuncio.id}/publiquei`, { canal: 'OLX', url: 'https://olx.com.br/anuncio-x' });
  verifica(marcado.situacao === 'PUBLICADO' && marcado.url === 'https://olx.com.br/anuncio-x', 'grava situação e link', marcado);
  verifica(!!marcado.publicadoEm && !!marcado.publicadoPor, 'registra quando e quem', { em: marcado.publicadoEm, quem: marcado.publicadoPor });

  secao('Listagem');
  const lista: any = await adm.get('/jarvis/anuncios');
  const meu = lista.data.find((a: any) => a.id === anuncio.id);
  verifica(!!meu && Array.isArray(meu.canais) && meu.canais.length === 2, 'anúncio aparece com os canais', meu?.canais?.length);
  verifica(Array.isArray(meu.fotos), 'fotos voltam como lista, não texto JSON', meu?.fotos);

  secao('Só o gestor entra');
  const senha = 'Senha@12345';
  await adm.post('/usuarios', { nome: `Vend Anuncio ${SUF}`, email: `vanun${SUF}@teste.com`, senha, perfil: 'VENDEDOR' }, [201, 409]);
  const vend = await entrar(`vanun${SUF}@teste.com`, senha).catch(() => null);
  if (vend) {
    vend.nome = 'VENDEDOR';
    await vend.get('/jarvis/anuncios', 403);
    await vend.post('/jarvis/anuncios/rascunho', { produtoId: produto.id }, 403);
  }

  encerrar('Central de Anúncios');
}

main().catch((e) => { console.error(e); process.exit(1); });
