/**
 * Catálogo do site → produtos do ERP.
 * Não chama o site e não abre o banco da loja: o SQLite nasce numa pasta temporária
 * e a sincronização recebe o catálogo já em memória (o mesmo caminho do job de 30 min
 * e do botão "Sincronizar agora").
 *
 * Nome e marca entram só na criação. No produto que já existe, a volta seguinte
 * atualiza preço, foto, custo, categoria, disponibilidade e fornecedor, e deixa
 * o nome e a marca como estão no ERP.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encerrar, igual, secao, verifica } from './lib.js';
import type { ProdutoDoSite } from '../src/modules/site/catalogo.js';

const API = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'meu-bling-catalogo-'));
const arquivo = path.join(pasta, 'teste.db');
const urlBanco = `file:${arquivo}`;

if (!arquivo.startsWith(os.tmpdir()) || /meubling|\/data\//i.test(arquivo)) {
  console.error('Recusa: o banco do teste não é temporário.');
  process.exit(1);
}

process.env.DATABASE_URL = urlBanco;
process.env.TRILHA_AUDITORIA = 'off';
process.env.STORAGE_DIR = path.join(pasta, 'storage');
process.env.TZ = 'America/Sao_Paulo';
process.env.SITE_SINCRONIZAR = '0';

const push = spawnSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
  cwd: API,
  env: { ...process.env, DATABASE_URL: urlBanco, TRILHA_AUDITORIA: 'off' },
  stdio: 'inherit',
});
if (push.status !== 0) process.exit(push.status || 1);

const { sincronizarCatalogo } = await import('../src/modules/site/catalogo.js');
const { prisma } = await import('../src/lib/prisma.js');

if (process.env.DATABASE_URL !== urlBanco) {
  console.error('Recusa: a sincronização não está apontando para o banco temporário.');
  process.exit(1);
}

function item(p: Partial<ProdutoDoSite> & { id: string; name: string }): ProdutoDoSite {
  return {
    price: '100,00',
    supplier: 'KaBuM!',
    availability: 'Disponível',
    ...p,
  };
}

const ssd = (): ProdutoDoSite =>
  item({
    id: '529728',
    name: 'SSD 1TB KABUM',
    brand: 'KABUM! essentials',
    price: '199,90',
    price_card: '219,90',
    cost: '120,00',
    image: 'https://cdn.exemplo/ssd.jpg',
    category: 'Armazenamento/SSD',
    slug: 'ssd-1tb-kabum',
    availability: 'Pronta entrega',
    supplier: 'KaBuM!',
  });

const mouse = (): ProdutoDoSite =>
  item({
    id: '8811',
    name: 'Mouse sem fio KABUM',
    brand: 'KABUM! smart',
    price: '89,90',
    price_card: '99,90',
    cost: '40,00',
    image: 'https://cdn.exemplo/mouse.jpg',
    category: 'Perifericos/Mouse',
    slug: 'mouse-sem-fio',
    availability: 'Disponível',
    supplier: 'KaBuM!',
  });

const cabo = (): ProdutoDoSite =>
  item({
    id: '7700',
    name: 'Cabo HDMI KABUM',
    brand: 'KABUM! essentials',
    price: '29,90',
    price_card: '34,90',
    cost: '12,00',
    image: 'https://cdn.exemplo/cabo.jpg',
    category: 'Cabos/HDMI',
    slug: 'cabo-hdmi',
    availability: 'Disponível',
    supplier: 'KaBuM!',
  });

async function porCodigo(codigo: string) {
  const p = await prisma.produto.findUnique({
    where: { codigo },
    include: { categoria: { include: { pai: true } } },
  });
  if (!p) throw new Error(`produto ${codigo} não encontrado`);
  return p;
}

try {
  secao('Produto novo recebe nome e marca do site');
  const primeira = await sincronizarCatalogo({ produtos: [ssd(), mouse(), cabo()] });
  verifica(primeira.criados === 3 && primeira.atualizados === 0 && primeira.recebidos === 3, 'a primeira volta cria os três e não atualiza ninguém', primeira);
  verifica(primeira.desativados === 0, 'espelho pequeno não desativa produto', primeira.desativados);

  const novo = await porCodigo('SITE-529728');
  verifica(novo.nome === 'SSD 1TB KABUM' && novo.marca === 'KABUM! essentials', 'nome e marca do site entram na criação', { nome: novo.nome, marca: novo.marca });
  verifica(novo.siteId === '529728' && novo.fornecedor === 'KaBuM!', 'código SITE- e fornecedor KaBuM!', { siteId: novo.siteId, fornecedor: novo.fornecedor });
  verifica(igual(novo.preco, 199.9) && igual(novo.precoCartao ?? 0, 219.9) && igual(novo.precoCusto, 120), 'preço à vista, cartão e custo', { preco: novo.preco, cartao: novo.precoCartao, custo: novo.precoCusto });
  verifica(novo.imagemUrl === 'https://cdn.exemplo/ssd.jpg' && novo.siteSlug === 'ssd-1tb-kabum', 'foto e slug', { foto: novo.imagemUrl, slug: novo.siteSlug });
  verifica(novo.prontaEntrega === true && novo.disponibilidade === 'Pronta entrega', 'pronta entrega', { pronta: novo.prontaEntrega, disponibilidade: novo.disponibilidade });
  verifica(novo.categoria?.nome === 'SSD' && novo.categoria.pai?.nome === 'Armazenamento', 'categoria pelo caminho do site', { cat: novo.categoria?.nome, pai: novo.categoria?.pai?.nome });
  verifica((await porCodigo('SITE-8811')).marca === 'KABUM! smart' && (await porCodigo('SITE-7700')).marca === 'KABUM! essentials', 'as outras marcas também nascem do site');

  const sincronizadoEm = novo.siteSincronizadoEm?.getTime();

  secao('Renomear no ERP e sincronizar de novo não devolve o nome antigo');
  await prisma.produto.update({
    where: { id: novo.id },
    data: { nome: 'SSD 1TB BALAO.INFO', marca: 'BALAO.INFO', ncm: '84717040', estoqueMinimo: 2, garantiaDias: 365 },
  });
  await prisma.produto.update({
    where: { codigo: 'SITE-8811' },
    data: { nome: 'Mouse sem fio BALAO.INFO', marca: 'BALAO.INFO', ncm: '84716053', ativo: false },
  });
  await prisma.produto.update({
    where: { codigo: 'SITE-7700' },
    data: { nome: 'Cabo HDMI BALAO.INFO', marca: null },
  });
  const local = await prisma.produto.create({
    data: { tipo: 'P', nome: 'Cadastro da loja', codigo: 'LOCAL-1', preco: 10, unidade: 'UN', fornecedor: 'KaBuM!' },
  });
  const sumiu = await prisma.produto.create({
    data: { tipo: 'P', nome: 'Produto fora deste espelho', codigo: 'SITE-sumiu', siteId: 'sumiu', preco: 10, unidade: 'UN', ativo: true, fornecedor: 'KaBuM!' },
  });

  const segunda = await sincronizarCatalogo({ produtos: [ssd(), mouse(), cabo()] });
  verifica(segunda.criados === 0 && segunda.atualizados === 1 && segunda.iguais === 2 && segunda.reativados === 1, 'só reativa quem estava inativo; nome diferente não conta como mudança', segunda);
  verifica(segunda.desativados === 0, 'continua sem desativar no espelho pequeno', segunda.desativados);

  const ssdDepois = await porCodigo('SITE-529728');
  verifica(ssdDepois.nome === 'SSD 1TB BALAO.INFO' && ssdDepois.marca === 'BALAO.INFO', 'nome e marca editados no ERP permanecem', { nome: ssdDepois.nome, marca: ssdDepois.marca });
  verifica(ssdDepois.ncm === '84717040' && ssdDepois.estoqueMinimo === 2 && ssdDepois.garantiaDias === 365, 'fiscal, mínimo e garantia não são tocados', { ncm: ssdDepois.ncm, minimo: ssdDepois.estoqueMinimo, garantia: ssdDepois.garantiaDias });
  verifica(ssdDepois.siteSincronizadoEm?.getTime() === sincronizadoEm, 'sem outra mudança, a volta nem regrava o produto', { antes: sincronizadoEm, depois: ssdDepois.siteSincronizadoEm });
  verifica(ssdDepois.fornecedor === 'KaBuM!', 'fornecedor KaBuM! segue no produto', ssdDepois.fornecedor);

  const caboDepois = await porCodigo('SITE-7700');
  verifica(caboDepois.nome === 'Cabo HDMI BALAO.INFO' && caboDepois.marca === null, 'marca apagada no ERP não é preenchida de novo pelo site', { nome: caboDepois.nome, marca: caboDepois.marca });

  const mouseDepois = await porCodigo('SITE-8811');
  verifica(mouseDepois.nome === 'Mouse sem fio BALAO.INFO' && mouseDepois.marca === 'BALAO.INFO' && mouseDepois.ativo === true, 'reativar não devolve o nome nem a marca do site', { nome: mouseDepois.nome, marca: mouseDepois.marca, ativo: mouseDepois.ativo });
  verifica(mouseDepois.ncm === '84716053' && igual(mouseDepois.preco, 89.9), 'NCM fica e o preço que já era o do site continua', { ncm: mouseDepois.ncm, preco: mouseDepois.preco });
  verifica((await prisma.produto.findUnique({ where: { id: local.id } }))?.nome === 'Cadastro da loja', 'produto que não é do site não é reescrito');
  verifica((await prisma.produto.findUnique({ where: { id: sumiu.id } }))?.ativo === true, 'produto ausente num espelho pequeno continua ativo');

  secao('Preço, foto e o restante continuam sendo atualizados');
  const fonte = await prisma.produto.create({
    data: { tipo: 'P', nome: 'Fonte BALAO.INFO', marca: 'BALAO.INFO', codigo: 'SITE-6600', preco: 1, unidade: 'UN', fornecedor: 'KaBuM!', ncm: '85044090' },
  });
  const ssdNovo = ssd();
  ssdNovo.name = 'SSD 1TB KABUM RENOMEADO NO SITE';
  ssdNovo.brand = 'KABUM! smart';
  ssdNovo.price = '249,90';
  ssdNovo.price_card = '269,90';
  ssdNovo.cost = '150,00';
  ssdNovo.image = 'https://cdn.exemplo/ssd-nova.jpg';
  ssdNovo.slug = 'ssd-1tb-novo';
  ssdNovo.availability = 'Disponível';
  ssdNovo.category = 'Componentes/SSD';
  ssdNovo.supplier = 'KaBuM!';
  const mouseNovo = mouse();
  mouseNovo.name = 'Mouse KABUM DE NOVO';
  mouseNovo.brand = 'KABUM! essentials';
  mouseNovo.price = '79,90';
  mouseNovo.image = 'https://cdn.exemplo/mouse-novo.jpg';
  const teclado = item({
    id: '9001',
    name: 'Teclado KABUM',
    brand: 'KABUM! smart',
    price: '149,00',
    price_card: '169,00',
    image: 'https://cdn.exemplo/teclado.jpg',
    category: 'Perifericos/Teclado',
    slug: 'teclado-kabum',
    supplier: 'KaBuM!',
  });
  const fonteSite = item({
    id: '6600',
    name: 'Fonte KABUM',
    brand: 'KABUM! essentials',
    price: '300,00',
    image: 'https://cdn.exemplo/fonte.jpg',
    supplier: 'KaBuM!',
    slug: 'fonte-kabum',
  });

  const terceira = await sincronizarCatalogo({ produtos: [ssdNovo, mouseNovo, cabo(), teclado, fonteSite] });
  verifica(terceira.criados === 1 && terceira.atualizados === 3 && terceira.iguais === 1 && terceira.desativados === 0, 'cria o teclado, atualiza quem mudou de preço e não mexe no cabo', terceira);

  const ssdAtual = await porCodigo('SITE-529728');
  verifica(ssdAtual.nome === 'SSD 1TB BALAO.INFO' && ssdAtual.marca === 'BALAO.INFO', 'o nome novo do site não substitui o do ERP', { nome: ssdAtual.nome, marca: ssdAtual.marca });
  verifica(igual(ssdAtual.preco, 249.9) && igual(ssdAtual.precoCartao ?? 0, 269.9) && igual(ssdAtual.precoCusto, 150), 'preço, cartão e custo acompanham o site', { preco: ssdAtual.preco, cartao: ssdAtual.precoCartao, custo: ssdAtual.precoCusto });
  verifica(ssdAtual.imagemUrl === 'https://cdn.exemplo/ssd-nova.jpg' && ssdAtual.siteSlug === 'ssd-1tb-novo', 'foto e slug acompanham o site', { foto: ssdAtual.imagemUrl, slug: ssdAtual.siteSlug });
  verifica(ssdAtual.prontaEntrega === false && ssdAtual.disponibilidade === 'Disponível', 'disponibilidade acompanha o site', { pronta: ssdAtual.prontaEntrega, disponibilidade: ssdAtual.disponibilidade });
  verifica(ssdAtual.categoria?.nome === 'SSD' && ssdAtual.categoria.pai?.nome === 'Componentes', 'categoria acompanha o site', { cat: ssdAtual.categoria?.nome, pai: ssdAtual.categoria?.pai?.nome });
  verifica(ssdAtual.fornecedor === 'KaBuM!' && ssdAtual.ncm === '84717040' && ssdAtual.codigo === 'SITE-529728', 'fornecedor KaBuM!, NCM e código permanecem', { fornecedor: ssdAtual.fornecedor, ncm: ssdAtual.ncm, codigo: ssdAtual.codigo });

  const mouseAtual = await porCodigo('SITE-8811');
  verifica(mouseAtual.nome === 'Mouse sem fio BALAO.INFO' && mouseAtual.marca === 'BALAO.INFO', 'mouse mantém nome e marca do ERP', { nome: mouseAtual.nome, marca: mouseAtual.marca });
  verifica(igual(mouseAtual.preco, 79.9) && mouseAtual.imagemUrl === 'https://cdn.exemplo/mouse-novo.jpg' && mouseAtual.fornecedor === 'KaBuM!', 'preço e foto do mouse atualizam; fornecedor segue KaBuM!', { preco: mouseAtual.preco, foto: mouseAtual.imagemUrl, fornecedor: mouseAtual.fornecedor });

  const tecladoCriado = await porCodigo('SITE-9001');
  verifica(tecladoCriado.nome === 'Teclado KABUM' && tecladoCriado.marca === 'KABUM! smart' && tecladoCriado.fornecedor === 'KaBuM!', 'produto que nasce nesta volta ainda recebe nome e marca do site', { nome: tecladoCriado.nome, marca: tecladoCriado.marca });

  const fonteAtual = await prisma.produto.findUnique({ where: { id: fonte.id } });
  verifica(fonteAtual?.nome === 'Fonte BALAO.INFO' && fonteAtual.marca === 'BALAO.INFO', 'produto achado pelo código SITE- mantém nome e marca', { nome: fonteAtual?.nome, marca: fonteAtual?.marca });
  verifica(fonteAtual?.siteId === '6600' && fonteAtual.codigo === 'SITE-6600' && igual(fonteAtual.preco, 300) && fonteAtual.imagemUrl === 'https://cdn.exemplo/fonte.jpg', 'ganha o siteId e atualiza preço e foto', { siteId: fonteAtual?.siteId, codigo: fonteAtual?.codigo, preco: fonteAtual?.preco, foto: fonteAtual?.imagemUrl });
  verifica(fonteAtual?.fornecedor === 'KaBuM!' && fonteAtual.ncm === '85044090', 'vínculo KaBuM! e NCM do produto achado pelo código', { fornecedor: fonteAtual?.fornecedor, ncm: fonteAtual?.ncm });

  secao('A volta seguinte, com o mesmo catálogo, não desfaz o nome');
  const quarta = await sincronizarCatalogo({ produtos: [ssdNovo, mouseNovo, cabo(), teclado, fonteSite] });
  verifica(quarta.criados === 0 && quarta.atualizados === 0 && quarta.iguais === 5, 'nada mudou nos campos que a sync grava', quarta);
  const deNovo = await porCodigo('SITE-529728');
  verifica(deNovo.nome === 'SSD 1TB BALAO.INFO' && deNovo.marca === 'BALAO.INFO' && igual(deNovo.preco, 249.9), 'nome e marca do ERP seguem, com o preço novo', { nome: deNovo.nome, marca: deNovo.marca, preco: deNovo.preco });
  verifica((await porCodigo('SITE-7700')).marca === null && (await porCodigo('SITE-9001')).nome === 'Teclado KABUM', 'marca vazia continua vazia e o produto novo continua com o nome do site');
} finally {
  await prisma.$disconnect().catch(() => undefined);
}

encerrar('Sincronização do catálogo do site');
