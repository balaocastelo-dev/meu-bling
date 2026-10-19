/**
 * SEED — dados iniciais do MEU BLING.
 *
 *   npm run db:seed            → configuração base (empresa, admin, situações, depósitos, formas de pagamento...)
 *   npm run db:seed -- --demo  → além da base, cria dados de exemplo (clientes, produtos, vendas, OS, financeiro)
 *
 * Situações de VENDA/COMPRA: as definidas pelo Balão (Em aberto, Em andamento, Fechada, NF emitida, Cancelada /
 * Em aberto, Fechado, Consignado, Vendido, Cancelado). Bancos antigos são migrados por migrarSituacoesBalao().
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const DEMO = process.argv.includes('--demo');

type SitSeed = { nome: string; cor: string; acoes?: string[]; inicial?: boolean; final?: boolean; cancelamento?: boolean };

/**
 * Situações do Balão (definidas pelo Thiago em 19/10/2026):
 *  VENDA:  Em aberto → Em andamento → Fechada → NF emitida | Cancelada
 *  COMPRA: Em aberto → Fechado | Consignado → Vendido (automático quando a mercadoria da compra é vendida) | Cancelado
 *  OS: fluxo da assistência técnica.
 */
export const SITUACOES: Record<'VENDA' | 'COMPRA' | 'OS', SitSeed[]> = {
  VENDA: [
    { nome: 'Em aberto', cor: '#3b82f6', acoes: ['reservarEstoque'], inicial: true },
    { nome: 'Em andamento', cor: '#f59e0b' },
    { nome: 'Fechada', cor: '#22c55e', acoes: ['lancarEstoque', 'lancarContas'], final: true },
    { nome: 'NF emitida', cor: '#0ea5e9', acoes: ['lancarEstoque', 'lancarContas', 'gerarNfe'], final: true },
    { nome: 'Cancelada', cor: '#ef4444', acoes: ['estornarEstoque', 'estornarContas', 'liberarReserva'], cancelamento: true },
  ],
  COMPRA: [
    { nome: 'Em aberto', cor: '#3b82f6', inicial: true },
    { nome: 'Fechado', cor: '#22c55e', acoes: ['lancarEstoque', 'lancarContas'], final: true },
    { nome: 'Consignado', cor: '#8b5cf6', acoes: ['lancarEstoque'] },
    { nome: 'Vendido', cor: '#16a34a', acoes: ['lancarContas'], final: true },
    { nome: 'Cancelado', cor: '#ef4444', acoes: ['estornarEstoque', 'estornarContas'], cancelamento: true },
  ],
  OS: [
    { nome: 'Aberta', cor: '#3b82f6', inicial: true },
    { nome: 'Em orçamento', cor: '#8b5cf6' },
    { nome: 'Aguardando aprovação', cor: '#f59e0b' },
    { nome: 'Aprovada', cor: '#06b6d4', acoes: ['reservarEstoque'] },
    { nome: 'Em andamento', cor: '#0ea5e9' },
    { nome: 'Aguardando peça', cor: '#f97316' },
    { nome: 'Concluída', cor: '#22c55e', acoes: ['lancarEstoque'] },
    { nome: 'Aguardando retirada', cor: '#84cc16' },
    { nome: 'Entregue', cor: '#16a34a', acoes: ['lancarEstoque', 'lancarContas'], final: true },
    { nome: 'Sem reparo', cor: '#64748b', acoes: ['liberarReserva'], final: true },
    { nome: 'Cancelada', cor: '#ef4444', acoes: ['estornarEstoque', 'estornarContas', 'liberarReserva'], cancelamento: true },
  ],
};

export const TRANSICOES: Record<'VENDA' | 'COMPRA' | 'OS', [string, string][]> = {
  VENDA: [
    ['Em aberto', 'Em andamento'], ['Em aberto', 'Fechada'], ['Em aberto', 'NF emitida'], ['Em aberto', 'Cancelada'],
    ['Em andamento', 'Em aberto'], ['Em andamento', 'Fechada'], ['Em andamento', 'NF emitida'], ['Em andamento', 'Cancelada'],
    ['Fechada', 'NF emitida'], ['Fechada', 'Em andamento'], ['Fechada', 'Em aberto'], ['Fechada', 'Cancelada'],
    ['NF emitida', 'Fechada'], ['NF emitida', 'Cancelada'],
    ['Cancelada', 'Em aberto'], ['Cancelada', 'Fechada'],
  ],
  COMPRA: [
    ['Em aberto', 'Fechado'], ['Em aberto', 'Consignado'], ['Em aberto', 'Cancelado'],
    ['Fechado', 'Vendido'], ['Fechado', 'Consignado'], ['Fechado', 'Em aberto'], ['Fechado', 'Cancelado'],
    ['Consignado', 'Vendido'], ['Consignado', 'Fechado'], ['Consignado', 'Em aberto'], ['Consignado', 'Cancelado'],
    ['Vendido', 'Fechado'], ['Vendido', 'Consignado'], ['Vendido', 'Cancelado'],
    ['Cancelado', 'Em aberto'], ['Cancelado', 'Fechado'], ['Cancelado', 'Consignado'],
  ],
  OS: [
    ['Aberta', 'Em orçamento'], ['Aberta', 'Em andamento'], ['Aberta', 'Cancelada'], ['Aberta', 'Aguardando peça'],
    ['Em orçamento', 'Aguardando aprovação'], ['Em orçamento', 'Cancelada'], ['Em orçamento', 'Sem reparo'],
    ['Aguardando aprovação', 'Aprovada'], ['Aguardando aprovação', 'Cancelada'], ['Aguardando aprovação', 'Sem reparo'], ['Aguardando aprovação', 'Em orçamento'],
    ['Aprovada', 'Em andamento'], ['Aprovada', 'Aguardando peça'], ['Aprovada', 'Cancelada'],
    ['Em andamento', 'Aguardando peça'], ['Em andamento', 'Concluída'], ['Em andamento', 'Sem reparo'], ['Em andamento', 'Cancelada'], ['Em andamento', 'Em orçamento'],
    ['Aguardando peça', 'Em andamento'], ['Aguardando peça', 'Cancelada'],
    ['Concluída', 'Aguardando retirada'], ['Concluída', 'Entregue'], ['Concluída', 'Em andamento'],
    ['Aguardando retirada', 'Entregue'], ['Aguardando retirada', 'Cancelada'],
    ['Entregue', 'Em andamento'], ['Entregue', 'Cancelada'],
    ['Sem reparo', 'Entregue'], ['Sem reparo', 'Em andamento'],
    ['Cancelada', 'Aberta'], ['Cancelada', 'Em andamento'],
  ],
};

/**
 * Migração das situações antigas (réplica do Bling) para as do Balão. Idempotente e versionada
 * (Configuracao "situacoes.versao" = 2): renomeia Atendido→Fechada/Fechado e Cancelado→Cancelada (vendas),
 * cria as novas (NF emitida, Consignado, Vendido), desativa/remove as que sobraram e refaz as transições.
 */
export async function migrarSituacoesBalao(db: PrismaClient) {
  const cfg = await db.configuracao.findUnique({ where: { chave: 'situacoes.versao' } });
  if (cfg && Number(cfg.valor) >= 2) return false;
  const RENOMEAR: Record<'VENDA' | 'COMPRA', Record<string, string>> = {
    VENDA: { Atendido: 'Fechada', Cancelado: 'Cancelada' },
    COMPRA: { Atendido: 'Fechado' },
  };
  // vendas que estavam em situações que deixam de existir vão para a equivalente
  const EQUIVALENTE: Record<'VENDA' | 'COMPRA', Record<string, string>> = {
    VENDA: { 'Em digitação': 'Em aberto', Verificado: 'Em andamento', 'Venda Agenciada': 'Fechada', 'Aguardando Estorno': 'Cancelada', 'Estornado OK': 'Cancelada' },
    COMPRA: { 'Em andamento': 'Em aberto' },
  };
  for (const modulo of ['VENDA', 'COMPRA'] as const) {
    for (const [de, para] of Object.entries(RENOMEAR[modulo])) {
      const antiga = await db.situacao.findUnique({ where: { modulo_nome: { modulo, nome: de } } });
      const nova = await db.situacao.findUnique({ where: { modulo_nome: { modulo, nome: para } } });
      if (antiga && !nova) await db.situacao.update({ where: { id: antiga.id }, data: { nome: para } });
    }
    // garante as situações do spec com flags/ações/cores/ordem corretas
    let ordem = 0;
    const ids: Record<string, number> = {};
    for (const s of SITUACOES[modulo]) {
      const r = await db.situacao.upsert({
        where: { modulo_nome: { modulo, nome: s.nome } },
        create: { modulo, nome: s.nome, cor: s.cor, ordem: ordem, sistema: true, inicial: !!s.inicial, final: !!s.final, cancelamento: !!s.cancelamento, acoes: JSON.stringify(s.acoes || []), ativo: true },
        update: { cor: s.cor, ordem: ordem, sistema: true, inicial: !!s.inicial, final: !!s.final, cancelamento: !!s.cancelamento, acoes: JSON.stringify(s.acoes || []), ativo: true },
      });
      ids[s.nome] = r.id;
      ordem += 1;
    }
    // situações que sobraram: move registros para a equivalente e remove (ou desativa se ainda referenciada)
    const sobras = await db.situacao.findMany({ where: { modulo, nome: { notIn: SITUACOES[modulo].map((s) => s.nome) } } });
    for (const sob of sobras) {
      const alvoNome = EQUIVALENTE[modulo][sob.nome] || (sob.cancelamento ? SITUACOES[modulo].find((s) => s.cancelamento)!.nome : sob.final ? SITUACOES[modulo].find((s) => s.final)!.nome : SITUACOES[modulo].find((s) => s.inicial)!.nome);
      const alvoId = ids[alvoNome];
      if (modulo === 'VENDA') await db.venda.updateMany({ where: { situacaoId: sob.id }, data: { situacaoId: alvoId } });
      else await db.compra.updateMany({ where: { situacaoId: sob.id }, data: { situacaoId: alvoId } });
      await db.templateNotificacao.updateMany({ where: { situacaoId: sob.id }, data: { situacaoId: alvoId } });
      await db.situacaoTransicao.deleteMany({ where: { OR: [{ origemId: sob.id }, { destinoId: sob.id }] } });
      await db.situacao.delete({ where: { id: sob.id } }).catch(async () => {
        await db.situacao.update({ where: { id: sob.id }, data: { ativo: false } });
      });
    }
    // transições: refaz conforme o spec
    await db.situacaoTransicao.deleteMany({ where: { modulo } });
    for (const [de, para] of TRANSICOES[modulo]) {
      if (ids[de] && ids[para]) await db.situacaoTransicao.create({ data: { modulo, origemId: ids[de], destinoId: ids[para] } });
    }
  }
  await db.configuracao.upsert({ where: { chave: 'situacoes.versao' }, create: { chave: 'situacoes.versao', valor: '2' }, update: { valor: '2' } });
  return true;
}

const DEPOSITOS = [
  { nome: 'LOJA CASTELO', padrao: true },
  { nome: 'LOJA BALÃO CENTRO' },
  { nome: 'DISTRIBUIDOR AGIS CPS SP', desconsiderarSaldo: true },
  { nome: 'DISTRIBUIDOR AGIS ES', desconsiderarSaldo: true },
  { nome: 'DISTRIBUIDOR FAGUNDEZ', desconsiderarSaldo: true },
  { nome: 'DISTRIBUIDOR INFO DISTRIBUIÇÃO', desconsiderarSaldo: true },
  { nome: 'DISTRIBUIDOR INFO+', desconsiderarSaldo: true },
  { nome: 'DISTRIBUIDOR MARQUINHOS', desconsiderarSaldo: true },
  { nome: 'DISTRIBUIDOR PAULO NOTEWEB', desconsiderarSaldo: true },
  { nome: 'DISTRIBUIDOR RENATO SALVA CELL', desconsiderarSaldo: true },
  { nome: 'DISTRIBUIDOR RODRIGO SP', desconsiderarSaldo: true },
  { nome: 'DISTRIBUIDOR TOB', desconsiderarSaldo: true },
];

const FORMAS_PAGAMENTO = [
  { nome: 'Dinheiro', tipo: 'DINHEIRO', codigoFiscal: '01' },
  { nome: 'PIX', tipo: 'PIX', codigoFiscal: '17' },
  { nome: 'Cartão de crédito', tipo: 'CARTAO_CREDITO', codigoFiscal: '03', taxaPct: 3.5, diasRecebimento: 30, maxParcelas: 12 },
  { nome: 'Cartão de débito', tipo: 'CARTAO_DEBITO', codigoFiscal: '04', taxaPct: 1.5, diasRecebimento: 1 },
  { nome: 'Boleto', tipo: 'BOLETO', codigoFiscal: '15', diasRecebimento: 3 },
  { nome: 'Transferência bancária', tipo: 'TRANSFERENCIA', codigoFiscal: '18' },
  { nome: 'Crediário / A prazo', tipo: 'CREDIARIO', codigoFiscal: '05', maxParcelas: 12 },
  { nome: 'Outros', tipo: 'OUTRO', codigoFiscal: '99' },
];

const CATEGORIAS_FIN: { nome: string; tipo: 'RECEITA' | 'DESPESA'; grupoDre: string }[] = [
  { nome: 'Venda de produtos', tipo: 'RECEITA', grupoDre: 'RECEITA_BRUTA' },
  { nome: 'Prestação de serviços (OS)', tipo: 'RECEITA', grupoDre: 'RECEITA_BRUTA' },
  { nome: 'Outras receitas', tipo: 'RECEITA', grupoDre: 'OUTRAS' },
  { nome: 'Receitas financeiras (juros, rendimentos)', tipo: 'RECEITA', grupoDre: 'RECEITA_FINANCEIRA' },
  { nome: 'Devoluções e cancelamentos', tipo: 'DESPESA', grupoDre: 'DEDUCAO' },
  { nome: 'Impostos sobre vendas (Simples Nacional)', tipo: 'DESPESA', grupoDre: 'DEDUCAO' },
  { nome: 'Compra de mercadorias (CMV)', tipo: 'DESPESA', grupoDre: 'CMV' },
  { nome: 'Peças para assistência', tipo: 'DESPESA', grupoDre: 'CMV' },
  { nome: 'Frete e logística', tipo: 'DESPESA', grupoDre: 'DESPESA_OPERACIONAL' },
  { nome: 'Aluguel', tipo: 'DESPESA', grupoDre: 'DESPESA_OPERACIONAL' },
  { nome: 'Energia, água e internet', tipo: 'DESPESA', grupoDre: 'DESPESA_OPERACIONAL' },
  { nome: 'Marketing e anúncios', tipo: 'DESPESA', grupoDre: 'DESPESA_OPERACIONAL' },
  { nome: 'Software e assinaturas', tipo: 'DESPESA', grupoDre: 'DESPESA_OPERACIONAL' },
  { nome: 'Manutenção e materiais', tipo: 'DESPESA', grupoDre: 'DESPESA_OPERACIONAL' },
  { nome: 'Salários e encargos', tipo: 'DESPESA', grupoDre: 'DESPESA_PESSOAL' },
  { nome: 'Comissões', tipo: 'DESPESA', grupoDre: 'DESPESA_PESSOAL' },
  { nome: 'Pró-labore', tipo: 'DESPESA', grupoDre: 'DESPESA_PESSOAL' },
  { nome: 'Tarifas bancárias e taxas de cartão', tipo: 'DESPESA', grupoDre: 'DESPESA_FINANCEIRA' },
  { nome: 'Juros e multas', tipo: 'DESPESA', grupoDre: 'DESPESA_FINANCEIRA' },
  { nome: 'Outras despesas', tipo: 'DESPESA', grupoDre: 'OUTRAS' },
];

const TEMPLATES = (sit: Record<string, number>) => [
  // ---- WhatsApp
  {
    nome: 'WhatsApp — Venda confirmada', evento: 'VENDA_SITUACAO', canal: 'WHATSAPP', situacaoId: sit['VENDA:Fechada'],
    corpo: 'Olá {{cliente.nome}}! 👋\nSua compra nº *{{numero}}* na *{{empresa.nome}}* foi confirmada ✅\nTotal: *{{total}}*\n\nQualquer dúvida é só chamar. Obrigado pela preferência!',
  },
  {
    nome: 'WhatsApp — Venda cancelada', evento: 'VENDA_SITUACAO', canal: 'WHATSAPP', situacaoId: sit['VENDA:Cancelada'],
    corpo: 'Olá {{cliente.nome}}. A venda nº *{{numero}}* foi *cancelada*. Se precisar de ajuda, fale com a gente. — {{empresa.nome}}',
  },
  {
    nome: 'WhatsApp — Venda: mudança de situação (genérico)', evento: 'VENDA_SITUACAO', canal: 'WHATSAPP', situacaoId: null,
    corpo: 'Olá {{cliente.nome}}! Atualização da sua compra nº *{{numero}}*: situação *{{situacao}}*. — {{empresa.nome}}',
  },
  {
    nome: 'WhatsApp — OS aberta', evento: 'OS_SITUACAO', canal: 'WHATSAPP', situacaoId: sit['OS:Aberta'],
    corpo: 'Olá {{cliente.nome}}! 🔧\nRecebemos seu equipamento ({{equipamento}}) e abrimos a Ordem de Serviço nº *{{numero}}*.\nVamos avisar por aqui a cada etapa. — {{empresa.nome}}',
  },
  {
    nome: 'WhatsApp — OS aguardando aprovação do orçamento', evento: 'OS_SITUACAO', canal: 'WHATSAPP', situacaoId: sit['OS:Aguardando aprovação'],
    corpo: 'Olá {{cliente.nome}}! O orçamento da OS nº *{{numero}}* ({{equipamento}}) ficou pronto:\n{{itens}}\n*Total: {{total}}*\n\nResponda *APROVAR* para autorizarmos o serviço. — {{empresa.nome}}',
  },
  {
    nome: 'WhatsApp — OS aguardando peça', evento: 'OS_SITUACAO', canal: 'WHATSAPP', situacaoId: sit['OS:Aguardando peça'],
    corpo: 'Olá {{cliente.nome}}, a OS nº *{{numero}}* está *aguardando peça*. Assim que chegar seguimos com o reparo. — {{empresa.nome}}',
  },
  {
    nome: 'WhatsApp — OS concluída / pronta para retirada', evento: 'OS_SITUACAO', canal: 'WHATSAPP', situacaoId: sit['OS:Aguardando retirada'],
    corpo: 'Boa notícia, {{cliente.nome}}! 🎉\nSeu equipamento ({{equipamento}}) da OS nº *{{numero}}* está *pronto para retirada*.\nTotal: *{{total}}*\nEndereço: {{empresa.endereco}} — {{empresa.nome}}',
  },
  {
    nome: 'WhatsApp — OS entregue', evento: 'OS_SITUACAO', canal: 'WHATSAPP', situacaoId: sit['OS:Entregue'],
    corpo: 'Obrigado, {{cliente.nome}}! A OS nº *{{numero}}* foi entregue. Garantia de {{garantiaDias}} dias. Conte com a gente! — {{empresa.nome}}',
  },
  {
    nome: 'WhatsApp — OS: mudança de situação (genérico)', evento: 'OS_SITUACAO', canal: 'WHATSAPP', situacaoId: null,
    corpo: 'Olá {{cliente.nome}}! Atualização da OS nº *{{numero}}* ({{equipamento}}): *{{situacao}}*. — {{empresa.nome}}',
  },
  {
    nome: 'WhatsApp — Compra: mudança de situação (fornecedor)', evento: 'COMPRA_SITUACAO', canal: 'WHATSAPP', situacaoId: null,
    corpo: 'Olá {{cliente.nome}}, o pedido de compra nº *{{numero}}* da {{empresa.nome}} está agora em *{{situacao}}*.',
  },
  // ---- E-mail
  {
    nome: 'E-mail — Venda confirmada', evento: 'VENDA_SITUACAO', canal: 'EMAIL', situacaoId: sit['VENDA:Fechada'], assunto: 'Pedido {{numero}} confirmado — {{empresa.nome}}',
    corpo: '<p>Olá <b>{{cliente.nome}}</b>,</p><p>Seu pedido nº <b>{{numero}}</b> foi confirmado.</p><p>{{itens}}</p><p>Total: <b>{{total}}</b></p><p>Obrigado pela preferência!<br>{{empresa.nome}}</p>',
  },
  {
    nome: 'E-mail — Venda: mudança de situação (genérico)', evento: 'VENDA_SITUACAO', canal: 'EMAIL', situacaoId: null, assunto: 'Pedido {{numero}}: {{situacao}} — {{empresa.nome}}',
    corpo: '<p>Olá <b>{{cliente.nome}}</b>,</p><p>Seu pedido nº <b>{{numero}}</b> está agora em: <b>{{situacao}}</b>.</p><p>{{empresa.nome}}</p>',
  },
  {
    nome: 'E-mail — OS aberta', evento: 'OS_SITUACAO', canal: 'EMAIL', situacaoId: sit['OS:Aberta'], assunto: 'Ordem de Serviço {{numero}} aberta — {{empresa.nome}}',
    corpo: '<p>Olá <b>{{cliente.nome}}</b>,</p><p>Abrimos a Ordem de Serviço nº <b>{{numero}}</b> para o equipamento <b>{{equipamento}}</b>.</p><p>Defeito relatado: {{defeito}}</p><p>Acompanhe o andamento por este e-mail ou WhatsApp.</p><p>{{empresa.nome}}</p>',
  },
  {
    nome: 'E-mail — OS orçamento', evento: 'OS_SITUACAO', canal: 'EMAIL', situacaoId: sit['OS:Aguardando aprovação'], assunto: 'Orçamento da OS {{numero}} — {{empresa.nome}}',
    corpo: '<p>Olá <b>{{cliente.nome}}</b>,</p><p>Segue o orçamento da OS nº <b>{{numero}}</b> ({{equipamento}}):</p><p>{{itens}}</p><p>Total: <b>{{total}}</b></p><p>Responda este e-mail ou nos chame no WhatsApp para aprovar.</p><p>{{empresa.nome}}</p>',
  },
  {
    nome: 'E-mail — OS: mudança de situação (genérico)', evento: 'OS_SITUACAO', canal: 'EMAIL', situacaoId: null, assunto: 'OS {{numero}}: {{situacao}} — {{empresa.nome}}',
    corpo: '<p>Olá <b>{{cliente.nome}}</b>,</p><p>A OS nº <b>{{numero}}</b> ({{equipamento}}) está agora em: <b>{{situacao}}</b>.</p><p>{{empresa.nome}}</p>',
  },
  {
    nome: 'E-mail — Compra: mudança de situação (fornecedor)', evento: 'COMPRA_SITUACAO', canal: 'EMAIL', situacaoId: null, assunto: 'Pedido de compra {{numero}}: {{situacao}} — {{empresa.nome}}',
    corpo: '<p>Olá <b>{{cliente.nome}}</b>,</p><p>O pedido de compra nº <b>{{numero}}</b> está agora em: <b>{{situacao}}</b>.</p><p>{{empresa.nome}}</p>',
  },
  {
    nome: 'E-mail — NF-e autorizada (envio XML + DANFE)', evento: 'NFE_AUTORIZADA', canal: 'EMAIL', situacaoId: null, assunto: 'NF-e {{numero}} — {{empresa.nome}}', anexarPdf: true,
    corpo: '<p>Olá <b>{{cliente.nome}}</b>,</p><p>Segue em anexo a NF-e nº <b>{{numero}}</b> (chave {{chave}}).</p><p>{{empresa.nome}}</p>',
  },
];

async function base() {
  console.log('→ Empresa');
  await prisma.empresa.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      razaoSocial: 'BALAO DA INFORMATICA MORALES LTDA',
      nomeFantasia: 'Balão da Informática',
      cnpj: '34397947000108',
      crt: 1,
      logradouro: 'Av. Anchieta',
      numero: '789',
      bairro: 'Cambuí',
      municipio: 'Campinas',
      codigoMunicipio: '3509502',
      uf: 'SP',
      cep: '13015100',
      email: 'balaocastelo@gmail.com',
      site: 'www.balao.info',
      serieNfe: 4,
      proximoNumeroNfe: 2206,
      serieNfce: 1,
      proximoNumeroNfce: 1,
      ambienteFiscal: 2,
      provedorFiscal: 'mock',
    },
    update: {},
  });

  console.log('→ Usuário administrador');
  const vendedorAdmin = await prisma.vendedor.upsert({
    where: { id: 1 },
    create: { id: 1, nome: 'Thiago', email: 'balaocastelo@gmail.com', comissaoPadraoPct: 0 },
    update: {},
  });
  await prisma.usuario.upsert({
    where: { email: 'admin@balao.info' },
    create: { nome: 'Administrador', email: 'admin@balao.info', senhaHash: await bcrypt.hash('admin123', 10), perfil: 'ADMIN', vendedorId: vendedorAdmin.id },
    update: {},
  });

  console.log('→ Situações e transições');
  if (await migrarSituacoesBalao(prisma)) console.log('   situações migradas para o padrão do Balão (v2)');
  const sitIds: Record<string, number> = {};
  for (const modulo of ['VENDA', 'COMPRA', 'OS'] as const) {
    let ordem = 0;
    for (const s of SITUACOES[modulo]) {
      const r = await prisma.situacao.upsert({
        where: { modulo_nome: { modulo, nome: s.nome } },
        create: { modulo, nome: s.nome, cor: s.cor, ordem: ordem++, sistema: true, inicial: !!s.inicial, final: !!s.final, cancelamento: !!s.cancelamento, acoes: JSON.stringify(s.acoes || []) },
        update: {},
      });
      sitIds[`${modulo}:${s.nome}`] = r.id;
    }
    for (const [de, para] of TRANSICOES[modulo]) {
      const origemId = sitIds[`${modulo}:${de}`];
      const destinoId = sitIds[`${modulo}:${para}`];
      if (!origemId || !destinoId) continue;
      await prisma.situacaoTransicao.upsert({
        where: { origemId_destinoId: { origemId, destinoId } },
        create: { modulo, origemId, destinoId },
        update: {},
      });
    }
  }

  console.log('→ Depósitos');
  for (const d of DEPOSITOS) {
    const ex = await prisma.deposito.findFirst({ where: { nome: d.nome } });
    if (!ex) await prisma.deposito.create({ data: { nome: d.nome, padrao: !!d.padrao, desconsiderarSaldo: !!d.desconsiderarSaldo } });
  }

  console.log('→ Formas de pagamento');
  for (const f of FORMAS_PAGAMENTO) {
    const ex = await prisma.formaPagamento.findFirst({ where: { nome: f.nome } });
    if (!ex) await prisma.formaPagamento.create({ data: f });
  }

  console.log('→ Categorias financeiras');
  for (const c of CATEGORIAS_FIN) {
    const ex = await prisma.categoriaFinanceira.findFirst({ where: { nome: c.nome } });
    if (!ex) await prisma.categoriaFinanceira.create({ data: c });
  }

  console.log('→ Contas financeiras');
  if (!(await prisma.contaFinanceira.findFirst({ where: { nome: 'Caixa' } }))) {
    await prisma.contaFinanceira.create({ data: { nome: 'Caixa', tipo: 'CAIXA', padrao: true, cor: '#16a34a' } });
  }
  if (!(await prisma.contaFinanceira.findFirst({ where: { nome: 'Banco principal' } }))) {
    await prisma.contaFinanceira.create({ data: { nome: 'Banco principal', tipo: 'BANCO', cor: '#2563eb' } });
  }

  console.log('→ Templates de notificação');
  for (const t of TEMPLATES(sitIds)) {
    const ex = await prisma.templateNotificacao.findFirst({ where: { nome: t.nome } });
    if (!ex) await prisma.templateNotificacao.create({ data: t as any });
  }

  console.log('→ Sequências');
  for (const [nome, valor] of [['VENDA', 24837], ['COMPRA', 0], ['OS', 0]] as const) {
    await prisma.sequencia.upsert({ where: { nome }, create: { nome, valor }, update: {} });
  }

  console.log('→ Categorias de produto');
  for (const nome of ['Computadores', 'Notebooks', 'Monitores', 'Periféricos', 'Peças e componentes', 'Áudio', 'Redes', 'Licenças e software', 'Serviços']) {
    if (!(await prisma.categoriaProduto.findFirst({ where: { nome } }))) await prisma.categoriaProduto.create({ data: { nome } });
  }
}

async function demo() {
  console.log('→ DEMO: clientes, fornecedores, produtos, vendas, OS, financeiro');
  const cat = async (nome: string) => (await prisma.categoriaProduto.findFirst({ where: { nome } }))!.id;
  const dep = (await prisma.deposito.findFirst({ where: { padrao: true } }))!;
  const sit = async (modulo: string, nome: string) => (await prisma.situacao.findFirst({ where: { modulo, nome } }))!.id;
  const fp = async (nome: string) => (await prisma.formaPagamento.findFirst({ where: { nome } }))!.id;
  const catFin = async (nome: string) => (await prisma.categoriaFinanceira.findFirst({ where: { nome } }))!.id;

  const tecnico = await prisma.tecnico.create({ data: { nome: 'Técnico Carlos', especialidade: 'Notebooks e desktops', comissaoPadraoPct: 10 } });
  const vend2 = await prisma.vendedor.create({ data: { nome: 'Vendedora Ana', comissaoPadraoPct: 3 } });

  const produtos = await Promise.all([
    prisma.produto.create({ data: { nome: 'DESKTOP OFFICE INTEL CORE I5 6ª / 16GB DDR4 / SSD 240GB NVME / FONTE 200W', codigo: 'DT-I5-16-240', preco: 2349, precoCusto: 1650, ncm: '84714110', csosn: '102', categoriaId: await cat('Computadores'), garantiaDias: 365 } }),
    prisma.produto.create({ data: { nome: 'PACOTE LICENÇA MICROSOFT WINDOWS 11 PRO + OFFICE 2021 PRO', codigo: 'LIC-W11-OFF21', preco: 599, precoCusto: 180, ncm: '85234990', csosn: '102', categoriaId: await cat('Licenças e software'), controlaEstoque: false } }),
    prisma.produto.create({ data: { nome: 'MONITOR LED 23" HDMI E VGA', codigo: 'MON-23-LED', preco: 699, precoCusto: 480, ncm: '85285220', csosn: '102', categoriaId: await cat('Monitores') } }),
    prisma.produto.create({ data: { nome: 'FONE DE OUVIDO JBL TUNE 520BT BLUETOOTH', codigo: 'JBL-520BT', preco: 199, precoCusto: 120, ncm: '85183000', csosn: '102', categoriaId: await cat('Áudio') } }),
    prisma.produto.create({ data: { nome: 'SSD NVME 1TB KINGSTON NV3', codigo: 'SSD-NV3-1TB', preco: 449, precoCusto: 300, ncm: '84717012', csosn: '102', categoriaId: await cat('Peças e componentes'), estoqueMinimo: 3 } }),
    prisma.produto.create({ data: { nome: 'MEMÓRIA RAM 16GB DDR4 3200 KINGSTON FURY', codigo: 'RAM-16-DDR4', preco: 289, precoCusto: 190, ncm: '84733041', csosn: '102', categoriaId: await cat('Peças e componentes'), estoqueMinimo: 4 } }),
    prisma.produto.create({ data: { nome: 'TECLADO + MOUSE SEM FIO LOGITECH MK270', codigo: 'LOG-MK270', preco: 189, precoCusto: 110, ncm: '84716053', csosn: '102', categoriaId: await cat('Periféricos') } }),
    prisma.produto.create({ data: { nome: 'FORMATAÇÃO COM BACKUP + INSTALAÇÃO DE PROGRAMAS', codigo: 'SRV-FORMAT', tipo: 'S', preco: 150, controlaEstoque: false, codigoServico: '14.01', categoriaId: await cat('Serviços') } }),
    prisma.produto.create({ data: { nome: 'LIMPEZA INTERNA + TROCA DE PASTA TÉRMICA (NOTEBOOK)', codigo: 'SRV-LIMPEZA', tipo: 'S', preco: 120, controlaEstoque: false, codigoServico: '14.01', categoriaId: await cat('Serviços') } }),
    prisma.produto.create({ data: { nome: 'MÃO DE OBRA — TROCA DE COMPONENTE', codigo: 'SRV-MO', tipo: 'S', preco: 100, controlaEstoque: false, codigoServico: '14.01', categoriaId: await cat('Serviços') } }),
  ]);

  // estoque inicial
  for (const p of produtos.filter((p) => p.tipo === 'P' && p.controlaEstoque)) {
    const qtd = p.codigo?.startsWith('SSD') ? 2 : 8;
    await prisma.estoqueSaldo.create({ data: { produtoId: p.id, depositoId: dep.id, saldo: qtd } });
    await prisma.movimentoEstoque.create({ data: { produtoId: p.id, depositoId: dep.id, tipo: 'ENTRADA', quantidade: qtd, custoUnitario: p.precoCusto, saldoAnterior: 0, saldoPosterior: qtd, origemTipo: 'AJUSTE', observacao: 'Saldo inicial (demo)' } });
  }

  const clientes = await Promise.all([
    prisma.contato.create({ data: { nome: 'Claudio Henrique Sanches', tipoPessoa: 'F', documento: '16791369841', celular: '5519999990001', email: 'claudio@example.com', municipio: 'Campinas', uf: 'SP', vendedorId: 1 } }),
    prisma.contato.create({ data: { nome: 'Beatriz Ferreira da Silva', tipoPessoa: 'F', celular: '5519999990002', email: 'beatriz@example.com', municipio: 'Campinas', uf: 'SP' } }),
    prisma.contato.create({ data: { nome: 'RUAH INVESTIMENTOS IMOBILIARIOS LTDA', tipoPessoa: 'J', documento: '12345678000199', ie: '123456789012', email: 'financeiro@ruah.example.com', celular: '5519999990003', municipio: 'Campinas', uf: 'SP', indicadorIe: 1 } }),
    prisma.contato.create({ data: { nome: 'Consumidor Final', tipoPessoa: 'F' } }),
  ]);
  const fornecedores = await Promise.all([
    prisma.contato.create({ data: { nome: 'AGIS Distribuição', tipo: 'FORNECEDOR', tipoPessoa: 'J', documento: '98765432000111', municipio: 'Campinas', uf: 'SP' } }),
    prisma.contato.create({ data: { nome: 'Info+ Distribuidora', tipo: 'FORNECEDOR', tipoPessoa: 'J', documento: '98765432000222', municipio: 'São Paulo', uf: 'SP' } }),
  ]);

  const hoje = new Date();
  const dia = (n: number) => new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - n, 12);

  // ---- Vendas (algumas atendidas com financeiro/estoque já lançados)
  const vendaAtendidoId = await sit('VENDA', 'Fechada');
  const vendaAbertoId = await sit('VENDA', 'Em aberto');
  const catVenda = await catFin('Venda de produtos');
  const pixId = await fp('PIX');
  const credId = await fp('Cartão de crédito');
  let nSeq = (await prisma.sequencia.findUnique({ where: { nome: 'VENDA' } }))!.valor;

  const vendasDemo = [
    { c: clientes[0], itens: [[0, 1], [1, 1], [2, 1]], dias: 2, atendida: true, fp: credId, vend: 1 },
    { c: clientes[1], itens: [[3, 1]], dias: 0, atendida: false, fp: pixId, vend: vend2.id },
    { c: clientes[2], itens: [[0, 1], [2, 2]], dias: 5, atendida: true, fp: pixId, vend: vend2.id },
    { c: clientes[3], itens: [[6, 1]], dias: 9, atendida: true, fp: pixId, vend: 1 },
    { c: clientes[1], itens: [[4, 1], [5, 1]], dias: 15, atendida: true, fp: credId, vend: 1 },
    { c: clientes[0], itens: [[3, 2]], dias: 28, atendida: true, fp: pixId, vend: vend2.id },
  ] as const;

  for (const v of vendasDemo) {
    nSeq += 1;
    const itens = v.itens.map(([pi, q], i) => {
      const p = produtos[pi];
      return { produtoId: p.id, codigo: p.codigo, descricao: p.nome, quantidade: q, valorUnitario: p.preco, total: p.preco * q, custoUnitario: p.precoCusto, comissaoPct: 3, comissaoValor: p.preco * q * 0.03, ordem: i };
    });
    const total = itens.reduce((s, i) => s + i.total, 0);
    const venda = await prisma.venda.create({
      data: {
        numero: nSeq, data: dia(v.dias), dataSaida: dia(v.dias), contatoId: v.c.id, vendedorId: v.vend, situacaoId: v.atendida ? vendaAtendidoId : vendaAbertoId,
        depositoId: dep.id, categoriaFinanceiraId: catVenda, totalProdutos: total, total, custoTotal: itens.reduce((s, i) => s + i.custoUnitario * i.quantidade, 0),
        estoqueLancado: v.atendida, contasLancadas: v.atendida,
        itens: { create: itens },
      },
    });
    const parcela = await prisma.vendaParcela.create({ data: { vendaId: venda.id, numero: 1, dataVencimento: dia(v.dias), valor: total, formaPagamentoId: v.fp } });
    if (v.atendida) {
      const cr = await prisma.contaReceber.create({
        data: { contatoId: v.c.id, vendedorId: v.vend, descricao: `Venda nº ${venda.numero} (1/1)`, dataEmissao: dia(v.dias), vencimento: dia(v.dias), competencia: dia(v.dias).toISOString().slice(0, 7), valor: total, valorRecebido: total, situacao: 'RECEBIDO', dataRecebimento: dia(v.dias), formaPagamentoId: v.fp, categoriaId: catVenda, origemTipo: 'VENDA', origemId: venda.id, parcela: '1/1', contaFinanceiraId: 1 },
      });
      await prisma.vendaParcela.update({ where: { id: parcela.id }, data: { contaReceberId: cr.id } });
      await prisma.movimentoFinanceiro.create({ data: { contaFinanceiraId: 1, data: dia(v.dias), tipo: 'ENTRADA', valor: total, descricao: `Recebimento venda nº ${venda.numero}`, categoriaId: catVenda, contaReceberId: cr.id } });
      for (const it of itens) {
        const p = produtos.find((p) => p.id === it.produtoId)!;
        if (p.tipo === 'P' && p.controlaEstoque) {
          const s = await prisma.estoqueSaldo.findUnique({ where: { produtoId_depositoId: { produtoId: p.id, depositoId: dep.id } } });
          const ant = s?.saldo ?? 0;
          await prisma.estoqueSaldo.upsert({ where: { produtoId_depositoId: { produtoId: p.id, depositoId: dep.id } }, create: { produtoId: p.id, depositoId: dep.id, saldo: -it.quantidade }, update: { saldo: { decrement: it.quantidade } } });
          await prisma.movimentoEstoque.create({ data: { produtoId: p.id, depositoId: dep.id, tipo: 'SAIDA', quantidade: it.quantidade, custoUnitario: p.precoCusto, saldoAnterior: ant, saldoPosterior: ant - it.quantidade, origemTipo: 'VENDA', origemId: venda.id } });
        }
      }
      await prisma.comissao.create({ data: { tipo: 'VENDEDOR', vendedorId: v.vend, origemTipo: 'VENDA', vendaId: venda.id, descricao: `Venda nº ${venda.numero}`, base: total, pct: 3, valor: total * 0.03, competencia: dia(v.dias).toISOString().slice(0, 7) } });
    }
    await prisma.historicoSituacao.create({ data: { entidadeTipo: 'VENDA', entidadeId: venda.id, paraSituacaoId: venda.situacaoId, paraSituacao: v.atendida ? 'Fechada' : 'Em aberto', data: dia(v.dias) } });
  }
  await prisma.sequencia.update({ where: { nome: 'VENDA' }, data: { valor: nSeq } });

  // ---- Compras
  const compraAtendidoId = await sit('COMPRA', 'Fechado');
  const compraAbertoId = await sit('COMPRA', 'Em aberto');
  const catCmv = await catFin('Compra de mercadorias (CMV)');
  const boletoId = await fp('Boleto');
  const compra1 = await prisma.compra.create({
    data: { numero: 1, data: dia(20), fornecedorId: fornecedores[0].id, situacaoId: compraAtendidoId, depositoId: dep.id, categoriaFinanceiraId: catCmv, totalProdutos: 1650 * 3, total: 1650 * 3, estoqueLancado: true, contasLancadas: true,
      itens: { create: [{ produtoId: produtos[0].id, descricao: produtos[0].nome, quantidade: 3, valorUnitario: 1650, total: 4950 }] } },
  });
  const cp1 = await prisma.contaPagar.create({ data: { contatoId: fornecedores[0].id, descricao: `Compra nº 1 (1/1)`, dataEmissao: dia(20), vencimento: dia(-10), competencia: dia(20).toISOString().slice(0, 7), valor: 4950, situacao: 'ABERTO', formaPagamentoId: boletoId, categoriaId: catCmv, origemTipo: 'COMPRA', origemId: compra1.id, parcela: '1/1' } });
  await prisma.compraParcela.create({ data: { compraId: compra1.id, numero: 1, dataVencimento: dia(-10), valor: 4950, formaPagamentoId: boletoId, contaPagarId: cp1.id } });
  await prisma.compra.create({
    data: { numero: 2, data: dia(1), dataPrevista: dia(-4), fornecedorId: fornecedores[1].id, situacaoId: compraAbertoId, depositoId: dep.id, categoriaFinanceiraId: catCmv, totalProdutos: 300 * 5, total: 1500,
      itens: { create: [{ produtoId: produtos[4].id, descricao: produtos[4].nome, quantidade: 5, valorUnitario: 300, total: 1500 }] },
      parcelas: { create: [{ numero: 1, dataVencimento: dia(-28), valor: 1500, formaPagamentoId: boletoId }] } },
  });
  await prisma.sequencia.update({ where: { nome: 'COMPRA' }, data: { valor: 2 } });

  // ---- Ordens de serviço
  const osSits = { aberta: await sit('OS', 'Aberta'), aprov: await sit('OS', 'Aguardando aprovação'), andamento: await sit('OS', 'Em andamento'), retirada: await sit('OS', 'Aguardando retirada'), entregue: await sit('OS', 'Entregue') };
  const catServ = await catFin('Prestação de serviços (OS)');
  const osDemo = [
    { c: clientes[1], eq: 'Notebook', marca: 'Dell', modelo: 'Inspiron 15 3520', serie: 'DL2024A1', defeito: 'Não liga, LED pisca laranja', sit: osSits.aberta, dias: 0, itens: [] as any[] },
    { c: clientes[0], eq: 'Desktop', marca: 'Balão', modelo: 'Office i5', serie: 'BL2401', defeito: 'Muito lento, travando', diag: 'HD mecânico com setores defeituosos', sit: osSits.aprov, dias: 2, itens: [{ tipo: 'PECA', pi: 4, q: 1 }, { tipo: 'SERVICO', pi: 7, q: 1 }, { tipo: 'SERVICO', pi: 9, q: 1 }] },
    { c: clientes[2], eq: 'Notebook', marca: 'Lenovo', modelo: 'IdeaPad 3', serie: 'LN99812', defeito: 'Superaquecendo e desligando', diag: 'Pasta térmica ressecada, cooler sujo', sit: osSits.andamento, dias: 3, itens: [{ tipo: 'SERVICO', pi: 8, q: 1 }] },
    { c: clientes[3], eq: 'Desktop', marca: 'Genérico', modelo: '-', serie: '-', defeito: 'Formatação', diag: 'Windows corrompido', sit: osSits.retirada, dias: 5, itens: [{ tipo: 'SERVICO', pi: 7, q: 1 }, { tipo: 'PECA', pi: 5, q: 1 }] },
    { c: clientes[1], eq: 'Notebook', marca: 'Acer', modelo: 'Aspire 5', serie: 'AC5511', defeito: 'Tela piscando', diag: 'Cabo flat da tela', sit: osSits.entregue, dias: 12, itens: [{ tipo: 'SERVICO', pi: 9, q: 1 }] },
  ];
  let osN = 0;
  for (const o of osDemo) {
    osN += 1;
    const itens = o.itens.map((it: any, i: number) => {
      const p = produtos[it.pi];
      return { tipo: it.tipo, produtoId: p.id, descricao: p.nome, quantidade: it.q, valorUnitario: p.preco, total: p.preco * it.q, custoUnitario: p.precoCusto, comissaoTecnicoPct: it.tipo === 'SERVICO' ? 10 : 0, depositoId: dep.id, ordem: i };
    });
    const totalServicos = itens.filter((i: any) => i.tipo === 'SERVICO').reduce((s: number, i: any) => s + i.total, 0);
    const totalPecas = itens.filter((i: any) => i.tipo === 'PECA').reduce((s: number, i: any) => s + i.total, 0);
    const entregue = o.sit === osSits.entregue;
    const os = await prisma.ordemServico.create({
      data: { numero: osN, dataEntrada: dia(o.dias), dataPrevista: dia(o.dias - 3), contatoId: o.c.id, vendedorId: 1, tecnicoId: tecnico.id, situacaoId: o.sit, depositoId: dep.id, categoriaFinanceiraId: catServ,
        equipamento: o.eq, marca: o.marca, modelo: o.modelo, numeroSerie: o.serie, defeitoRelatado: o.defeito, diagnostico: (o as any).diag, orcar: o.sit === osSits.aprov, orcamentoAprovado: [osSits.andamento, osSits.retirada, osSits.entregue].includes(o.sit),
        totalServicos, totalPecas, total: totalServicos + totalPecas, contasLancadas: entregue, estoqueLancado: entregue,
        itens: { create: itens }, parcelas: { create: itens.length ? [{ numero: 1, dataVencimento: dia(o.dias - 3), valor: totalServicos + totalPecas, formaPagamentoId: pixId }] : [] } },
    });
    await prisma.historicoSituacao.create({ data: { entidadeTipo: 'OS', entidadeId: os.id, paraSituacaoId: o.sit, paraSituacao: (await prisma.situacao.findUnique({ where: { id: o.sit } }))!.nome, data: dia(o.dias) } });
    if (entregue) {
      const cr = await prisma.contaReceber.create({ data: { contatoId: o.c.id, descricao: `OS nº ${os.numero} (1/1)`, vencimento: dia(o.dias - 3), competencia: dia(o.dias).toISOString().slice(0, 7), valor: os.total, valorRecebido: os.total, situacao: 'RECEBIDO', dataRecebimento: dia(o.dias - 3), formaPagamentoId: pixId, categoriaId: catServ, origemTipo: 'OS', origemId: os.id, parcela: '1/1', contaFinanceiraId: 1 } });
      await prisma.movimentoFinanceiro.create({ data: { contaFinanceiraId: 1, data: dia(o.dias - 3), tipo: 'ENTRADA', valor: os.total, descricao: `Recebimento OS nº ${os.numero}`, categoriaId: catServ, contaReceberId: cr.id } });
      await prisma.comissao.create({ data: { tipo: 'TECNICO', tecnicoId: tecnico.id, origemTipo: 'OS', osId: os.id, descricao: `OS nº ${os.numero}`, base: totalServicos, pct: 10, valor: totalServicos * 0.1, competencia: dia(o.dias).toISOString().slice(0, 7) } });
    }
  }
  await prisma.sequencia.update({ where: { nome: 'OS' }, data: { valor: osN } });

  // ---- Despesas (contas a pagar manuais) para o DRE
  const despesas: [string, number, number, boolean][] = [
    ['Aluguel', 3500, 5, true], ['Energia, água e internet', 780, 8, true], ['Marketing e anúncios', 600, 10, true], ['Salários e encargos', 6200, 5, true], ['Software e assinaturas', 250, 3, false], ['Tarifas bancárias e taxas de cartão', 180, 1, true],
  ];
  for (const [catNome, valor, d, pago] of despesas) {
    const cid = await catFin(catNome);
    const cp = await prisma.contaPagar.create({ data: { descricao: catNome + ' — ' + hoje.toLocaleDateString('pt-BR', { month: 'long' }), vencimento: dia(d), competencia: dia(d).toISOString().slice(0, 7), valor, valorPago: pago ? valor : 0, situacao: pago ? 'PAGO' : 'ABERTO', dataPagamento: pago ? dia(d) : null, categoriaId: cid, origemTipo: 'MANUAL', contaFinanceiraId: pago ? 2 : null, recorrente: true } });
    if (pago) await prisma.movimentoFinanceiro.create({ data: { contaFinanceiraId: 2, data: dia(d), tipo: 'SAIDA', valor, descricao: cp.descricao, categoriaId: cid, contaPagarId: cp.id } });
  }
  // saldo inicial do banco
  await prisma.contaFinanceira.update({ where: { id: 2 }, data: { saldoInicial: 25000 } });
  // recalcula saldos atuais
  for (const conta of await prisma.contaFinanceira.findMany()) {
    const ent = await prisma.movimentoFinanceiro.aggregate({ where: { contaFinanceiraId: conta.id, tipo: 'ENTRADA' }, _sum: { valor: true } });
    const sai = await prisma.movimentoFinanceiro.aggregate({ where: { contaFinanceiraId: conta.id, tipo: 'SAIDA' }, _sum: { valor: true } });
    await prisma.contaFinanceira.update({ where: { id: conta.id }, data: { saldoAtual: conta.saldoInicial + (ent._sum.valor || 0) - (sai._sum.valor || 0) } });
  }
}

async function main() {
  await base();
  if (DEMO) {
    const jaTem = await prisma.venda.count();
    if (jaTem > 0) console.log('⚠ Já existem vendas — pulando dados de demonstração.');
    else await demo();
  }
  console.log('\n✅ Seed concluído.');
  console.log('   Login: admin@balao.info   Senha: admin123   (troque no primeiro acesso)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
