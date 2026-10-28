/**
 * CONSIGNAÇÃO — operações (contrato, desconto, pagamento, retirada, robô diário, painel e vitrine do site).
 * As regras ficam em nucleo.ts.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma, type Tx } from '../../lib/prisma.js';
import { AppError, NotFound } from '../../lib/errors.js';
import { env } from '../../lib/env.js';
import { arredondar, competenciaDe, proximoNumero, somenteDigitos } from '../../lib/util.js';
import type { ContextoAcao } from '../../core/situacoes.js';
import { categoriaPadraoId } from '../comum/financeiro.js';
import { acaoEstornarEstoque, acaoLancarEstoque } from '../compras/service.js';
import { baixarContaPagar, baixarContaReceber, resumoFinanceiro, saldoContaPagar } from '../financeiro/service.js';
import { diasEntre, inicioDoDia, meioDia } from './calendario.js';
import {
  abertas,
  atualizarQuitacao,
  avisarConsignante,
  calcular,
  carregarConsignacao,
  CATEGORIA_DEVOLUCAO,
  CATEGORIA_PAGAMENTO,
  CATEGORIA_TAXA,
  dataBr,
  fotosDe,
  gerarDiarias,
  includeConsignacao,
  lerJson,
  lerRegras,
  linkConsignante,
  moedaBr,
  novoToken,
  planoDiarias,
  primeiroNome,
  registrarEvento,
  ROTULO_STATUS,
  STATUS_ATIVOS,
  valorDoConsignante,
  type ConsignacaoLida,
  type Status,
} from './nucleo.js';

type Db = Tx | typeof prisma;

// ---------------------------------------------------------------------------- simulação
export async function simular(precoVenda: number, pct?: number | null) {
  const r = await lerRegras();
  const percentual = pct ?? r.percentualConsignante;
  const valor = valorDoConsignante(precoVenda, percentual);
  const plano = planoDiarias(valor, r);
  return {
    precoVenda,
    percentualConsignante: percentual,
    valorConsignante: valor,
    lucroLoja: arredondar(precoVenda - valor),
    prazoDias: r.prazoDias,
    diaria: plano.diaria,
    quantidadeDiarias: plano.quantidade,
    taxaRetirada: r.taxaRetirada,
    regras: r,
  };
}

// ---------------------------------------------------------------------------- consignante
export interface DadosConsignante {
  nome: string;
  documento?: string | null;
  rg?: string | null;
  celular?: string | null;
  email?: string | null;
  cep?: string | null;
  logradouro?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  municipio?: string | null;
  uf?: string | null;
}

/** Acha o consignante pelo CPF/CNPJ (ou cria); completa o que estiver em branco. */
async function resolverConsignante(tx: Tx, d: DadosConsignante) {
  const doc = somenteDigitos(d.documento);
  const celular = somenteDigitos(d.celular);
  const existente = doc ? await tx.contato.findFirst({ where: { documento: doc } }) : null;
  const campos = {
    rg: d.rg || undefined,
    celular: celular ? (celular.length <= 11 ? `55${celular}` : celular) : undefined,
    email: d.email || undefined,
    cep: somenteDigitos(d.cep) || undefined,
    logradouro: d.logradouro || undefined,
    numero: d.numero || undefined,
    complemento: d.complemento || undefined,
    bairro: d.bairro || undefined,
    municipio: d.municipio || undefined,
    uf: d.uf ? d.uf.toUpperCase().slice(0, 2) : undefined,
  };
  if (existente) {
    const dados: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(campos)) if (v !== undefined && (k === 'celular' || !(existente as any)[k])) dados[k] = v;
    if (existente.tipo === 'CLIENTE') dados.tipo = 'AMBOS';
    return Object.keys(dados).length ? tx.contato.update({ where: { id: existente.id }, data: dados }) : existente;
  }
  return tx.contato.create({ data: { nome: d.nome.trim(), tipo: 'FORNECEDOR', tipoPessoa: doc.length === 14 ? 'J' : 'F', documento: doc || null, ...campos } });
}

// ---------------------------------------------------------------------------- criar
export interface NovaConsignacao {
  consignanteId?: number | null;
  consignante?: DadosConsignante | null;
  vendedorId?: number | null;
  tipoEquipamento: string;
  descricao: string;
  marca?: string | null;
  modelo?: string | null;
  numeroSerie?: string | null;
  imei?: string | null;
  estado?: string | null;
  acessorios?: string | null;
  detalhes?: string | null;
  precoVenda: number;
  percentualConsignante?: number | null;
  dataEntrada?: Date | null;
  prazoDias?: number | null;
  declaracaoOrigem?: boolean;
  assinadoNaLoja?: boolean;
  mostrarNoSite?: boolean;
  destaque?: boolean;
  observacoes?: string | null;
}

async function categoriaConsignados(tx: Tx) {
  const c = await tx.categoriaProduto.findFirst({ where: { nome: 'Consignados' } });
  if (c) return c.id;
  return (await tx.categoriaProduto.create({ data: { nome: 'Consignados' } })).id;
}

export async function criarConsignacao(d: NovaConsignacao, usuario: { id: number; vendedorId?: number | null }) {
  if (!(d.precoVenda > 0)) throw new AppError('Informe o preço de venda do equipamento.', 422, 'PRECO', { campo: 'precoVenda' });
  if (!d.descricao?.trim()) throw new AppError('Descreva o equipamento (ex.: "MacBook Air M1 8GB 256GB").', 422, 'DESCRICAO', { campo: 'descricao' });
  if (!d.consignanteId && !d.consignante?.nome) throw new AppError('Informe o consignante (dono do equipamento).', 422, 'CONSIGNANTE', { campo: 'consignante' });
  const regras = await lerRegras();
  const pct = d.percentualConsignante ?? regras.percentualConsignante;
  if (!(pct > 0 && pct < 100)) throw new AppError('O percentual do consignante deve ficar entre 1% e 99%.', 422, 'PERCENTUAL', { campo: 'percentualConsignante' });
  const prazoDias = d.prazoDias ?? regras.prazoDias;
  const entrada = meioDia(d.dataEntrada ?? new Date());
  const dataLimite = meioDia(new Date(entrada.getTime() + prazoDias * 86400000));
  const valor = valorDoConsignante(d.precoVenda, pct);

  const id = await prisma.$transaction(
    async (tx) => {
      const consignante = d.consignanteId ? await tx.contato.findUnique({ where: { id: d.consignanteId } }) : await resolverConsignante(tx, d.consignante!);
      if (!consignante) throw new AppError('Consignante não encontrado.', 422, 'CONSIGNANTE', { campo: 'consignanteId' });
      if (d.consignanteId && d.consignante) await resolverConsignante(tx, { ...d.consignante, documento: d.consignante.documento || consignante.documento });
      const contato = await tx.contato.findUnique({ where: { id: consignante.id } });
      const faltando = [!contato?.documento && 'CPF/CNPJ', !(contato?.celular || contato?.telefone) && 'celular (WhatsApp)'].filter(Boolean);
      if (faltando.length) throw new AppError(`Complete o cadastro do consignante: ${faltando.join(' e ')}.`, 422, 'CONSIGNANTE_INCOMPLETO', { campo: 'consignante', faltando });

      const numero = await proximoNumero('CONSIGNACAO', tx);
      const situacao = await tx.situacao.findFirst({ where: { modulo: 'COMPRA', nome: 'Consignado', ativo: true } });
      if (!situacao) throw new AppError('Não há a situação "Consignado" nas compras. Confira em Configurações → Situações.', 500, 'SITUACAO');
      const produto = await tx.produto.create({
        data: {
          nome: d.descricao.trim(),
          codigo: `CONS-${numero}`,
          preco: d.precoVenda,
          precoCusto: valor,
          marca: d.marca || null,
          descricaoCurta: d.estado || null,
          descricaoDetalhada: d.detalhes || null,
          controlaEstoque: true,
          garantiaDias: 90,
          prontaEntrega: true,
          disponibilidade: 'Pronta entrega (consignado)',
          categoriaId: await categoriaConsignados(tx),
        },
      });
      const categoriaCmv = await categoriaPadraoId(tx, CATEGORIA_PAGAMENTO, 'DESPESA', 'CMV');
      const numeroCompra = await proximoNumero('COMPRA', tx);
      const compra = await tx.compra.create({
        data: {
          numero: numeroCompra,
          data: entrada,
          dataPrevista: dataLimite,
          fornecedorId: consignante.id,
          situacaoId: situacao.id,
          categoriaFinanceiraId: categoriaCmv,
          totalProdutos: valor,
          total: valor,
          // o contas a pagar do consignado é controlado pela consignação (venda ou diárias), nunca pela compra
          contasLancadas: true,
          observacoesInternas: `Consignação nº ${numero}`,
          itens: { create: [{ produtoId: produto.id, descricao: produto.nome, quantidade: 1, valorUnitario: valor, total: valor, ordem: 0 }] },
          parcelas: { create: [{ numero: 1, dataVencimento: dataLimite, valor }] },
        },
      });
      await tx.historicoSituacao.create({ data: { entidadeTipo: 'COMPRA', entidadeId: compra.id, paraSituacaoId: situacao.id, paraSituacao: situacao.nome, usuarioId: usuario.id, observacao: `Consignação nº ${numero}` } });
      const ctx: ContextoAcao = { modulo: 'COMPRA', entidadeId: compra.id, tx, usuarioId: usuario.id, situacaoOrigemId: null, situacaoDestinoId: situacao.id };
      await acaoLancarEstoque(ctx);

      const vendedorId = d.vendedorId ?? usuario.vendedorId ?? null;
      const c = await tx.consignacao.create({
        data: {
          numero,
          token: novoToken(),
          consignanteId: consignante.id,
          vendedorId,
          usuarioId: usuario.id,
          tipoEquipamento: d.tipoEquipamento,
          descricao: d.descricao.trim(),
          marca: d.marca || null,
          modelo: d.modelo || null,
          numeroSerie: d.numeroSerie || null,
          imei: d.imei || null,
          estado: d.estado || null,
          acessorios: d.acessorios || null,
          detalhes: d.detalhes || null,
          declaracaoOrigem: !!d.declaracaoOrigem,
          precoVenda: arredondar(d.precoVenda),
          percentualConsignante: pct,
          valorConsignante: valor,
          precoVendaOriginal: arredondar(d.precoVenda),
          valorConsignanteOriginal: valor,
          prazoDias,
          diariaPct: regras.diariaPct,
          diariaMinima: regras.diariaMinima,
          diariaMaxima: regras.diariaMaxima,
          taxaRetirada: regras.taxaRetirada,
          dataEntrada: entrada,
          dataLimite,
          status: 'NO_PRAZO',
          compraId: compra.id,
          produtoId: produto.id,
          mostrarNoSite: d.mostrarNoSite ?? true,
          destaque: !!d.destaque,
          observacoes: d.observacoes || null,
          ...(d.assinadoNaLoja ? { assinadoEm: new Date(), assinadoPor: 'LOJA', assinaturaNome: consignante.nome } : {}),
        },
      });
      const plano = planoDiarias(valor, regras);
      await registrarEvento(tx, c.id, 'CRIADO', `Contrato nº ${numero}: ${c.descricao} por ${moedaBr(c.precoVenda)}. Você recebe ${moedaBr(valor)} (${pct}%). Prazo até ${dataBr(dataLimite)}.`, { usuarioId: usuario.id });
      if (d.assinadoNaLoja) await registrarEvento(tx, c.id, 'ASSINADO', 'Contrato assinado na loja.', { usuarioId: usuario.id });
      const nome = (consignante.nome || '').split(/\s+/)[0];
      await avisarConsignante(
        tx,
        c,
        'criado',
        `Olá, ${nome}! Aqui é do Balão da Informática. Recebemos seu ${c.descricao} em consignação (contrato nº ${numero}).\n\n` +
          `• Preço de venda: ${moedaBr(c.precoVenda)}\n• Você recebe: ${moedaBr(valor)} na hora da venda\n• Se não vender até ${dataBr(dataLimite)}, começamos a te pagar ${moedaBr(plano.diaria)} por dia útil até completar o valor\n\n` +
          `${d.assinadoNaLoja ? 'Acompanhe' : 'Assine o contrato e acompanhe'} tudo por aqui: ${linkConsignante(c.token)}`,
      );
      return c.id;
    },
    { timeout: 30000 },
  );
  return consignacaoCompleta(id);
}

// ---------------------------------------------------------------------------- leitura
export async function consignacaoCompleta(id: number) {
  const c = await carregarConsignacao(id);
  if (!c) throw new NotFound('Consignação');
  return { ...c, ...calcular(c) };
}

export async function listarConsignacoes(f: { status?: string; pesquisa?: string; ativas?: boolean; consignanteId?: number }) {
  const where: any = { consignanteId: f.consignanteId };
  if (f.status) where.status = f.status;
  else if (f.ativas) where.status = { in: [...STATUS_ATIVOS, 'VENDIDO'] };
  if (f.pesquisa) {
    const t = f.pesquisa.trim();
    const n = Number(t.replace(/\D/g, ''));
    where.OR = [{ descricao: { contains: t } }, { imei: { contains: t } }, { numeroSerie: { contains: t } }, { consignante: { nome: { contains: t } } }, { marca: { contains: t } }, ...(n && n < 1e7 ? [{ numero: n }] : [])];
  }
  const lista = await prisma.consignacao.findMany({ where, include: includeConsignacao, orderBy: [{ id: 'desc' }], take: 500 });
  const hoje = new Date();
  const data = lista.map((c) => {
    const calc = calcular(c, hoje);
    const { eventos, descontos, contasReceber, ...resto } = c;
    return { ...resto, ...calc, contasPagar: undefined, fotos: undefined };
  });
  return { data, totais: totaisDe(data) };
}

function totaisDe(lista: { status: string; saldo: number; devidoHoje: number; atrasado: number; valorConsignante: number; precoVenda: number; pago: number; vendidoEmDiarias: boolean; quitadoEm: Date | null }[]) {
  const soma = (l: typeof lista, f: (x: (typeof lista)[number]) => number) => arredondar(l.reduce((s, x) => s + f(x), 0));
  const noPrazo = lista.filter((x) => x.status === 'NO_PRAZO');
  const emDiarias = lista.filter((x) => x.status === 'EM_DIARIAS');
  const vendidosAPagar = lista.filter((x) => x.status === 'VENDIDO' && x.saldo > 0.009);
  return {
    qtdNoPrazo: noPrazo.length,
    qtdEmDiarias: emDiarias.length,
    qtdAguardandoRetirada: lista.filter((x) => x.status === 'AGUARDANDO_RETIRADA').length,
    qtdVendidosAPagar: vendidosAPagar.length,
    valorEmLoja: soma([...noPrazo, ...emDiarias], (x) => x.precoVenda),
    devidoConsignantes: soma(lista.filter((x) => ['NO_PRAZO', 'EM_DIARIAS', 'VENDIDO', 'AGUARDANDO_RETIRADA'].includes(x.status)), (x) => x.saldo),
    pagarHoje: soma(lista, (x) => x.devidoHoje),
    atrasado: soma(lista, (x) => x.atrasado),
    vendidosAPagar: soma(vendidosAPagar, (x) => x.saldo),
    pago: soma(lista, (x) => x.pago),
  };
}

/** Painel do ADM: o que pagar hoje, compromisso diário de caixa, sugestão de quitar e o que vence nos próximos dias. */
export async function painelConsignacao() {
  const regras = await lerRegras();
  const lista = await prisma.consignacao.findMany({ where: { status: { in: [...STATUS_ATIVOS, 'VENDIDO'] } }, include: includeConsignacao, orderBy: { dataLimite: 'asc' } });
  const hoje = new Date();
  const calc = lista.map((c) => ({ c, k: calcular(c, hoje) }));
  const fin = await resumoFinanceiro().catch(() => ({ saldoTotal: 0 }) as any);
  const caixa = arredondar(fin.saldoTotal || 0);

  // compromisso de caixa: quanto sai por dia útil nos próximos 10 dias úteis
  const fim = new Date(inicioDoDia(hoje).getTime() + 15 * 86400000);
  const porDia = new Map<string, number>();
  for (const { c } of calc) {
    for (const p of c.contasPagar) {
      if (!abertas(p) || p.vencimento > fim) continue;
      const k = p.vencimento < inicioDoDia(hoje) ? 'atrasado' : p.vencimento.toISOString().slice(0, 10);
      porDia.set(k, arredondar((porDia.get(k) || 0) + saldoContaPagar(p)));
    }
  }
  const compromisso = [...porDia.entries()].sort(([a], [b]) => (a === 'atrasado' ? -1 : b === 'atrasado' ? 1 : a.localeCompare(b))).map(([dia, valor]) => ({ dia, valor, acimaDoTeto: regras.tetoDiarioLoja > 0 && valor > regras.tetoDiarioLoja }));
  const diariaMediaHoje = compromisso.find((x) => x.dia === hoje.toISOString().slice(0, 10))?.valor || 0;

  const pagarAgora = calc
    .filter(({ k }) => k.devidoHoje > 0.009)
    .map(({ c, k }) => ({ id: c.id, numero: c.numero, descricao: c.descricao, consignante: c.consignante.nome, status: c.status, valor: k.devidoHoje, atrasado: k.atrasado, motivo: c.status === 'VENDIDO' ? 'Vendido: pagar na hora' : `Diária ${Math.min(k.diariasPagas + 1, k.diariasTotal)}/${k.diariasTotal}` }));

  const sugestoesQuitar = calc
    .filter(({ c, k }) => c.status === 'VENDIDO' && c.vendidoEmDiarias && k.saldo > 0.009)
    .map(({ c, k }) => {
      const sobra = arredondar(caixa - k.saldo);
      const recomendado = sobra >= Math.max(regras.tetoDiarioLoja, 0) && caixa > 0;
      return {
        id: c.id,
        numero: c.numero,
        descricao: c.descricao,
        consignante: c.consignante.nome,
        saldo: k.saldo,
        diariasRestantes: k.diariasTotal - k.diariasPagas,
        recomendado,
        texto: recomendado
          ? `Recomendo quitar: o caixa tem ${moedaBr(caixa)} e sobra ${moedaBr(sobra)} depois de pagar ${moedaBr(k.saldo)}. Libera ${k.diariasTotal - k.diariasPagas} diária(s) do seu caixa diário.`
          : `Seguir nas diárias: quitar ${moedaBr(k.saldo)} agora deixaria o caixa ${caixa > 0 ? `com ${moedaBr(sobra)}` : 'sem saldo conhecido'}.`,
      };
    });

  const vencendo = calc
    .filter(({ c, k }) => c.status === 'NO_PRAZO' && k.diasParaPrazo <= 3)
    .map(({ c, k }) => ({ id: c.id, numero: c.numero, descricao: c.descricao, consignante: c.consignante.nome, diasParaPrazo: k.diasParaPrazo, precoVenda: c.precoVenda, diaria: planoDiarias(c.valorConsignante, c).diaria }));

  const semAssinatura = calc.filter(({ c }) => !c.assinadoEm && STATUS_ATIVOS.includes(c.status as Status)).map(({ c }) => ({ id: c.id, numero: c.numero, descricao: c.descricao, consignante: c.consignante.nome, link: linkConsignante(c.token) }));

  const avisos: { tom: string; texto: string; id?: number }[] = [];
  const atrasadoTotal = arredondar(calc.reduce((s, { k }) => s + k.atrasado, 0));
  if (atrasadoTotal > 0.009) avisos.push({ tom: 'vermelho', texto: `Pagamentos atrasados a consignantes: ${moedaBr(atrasadoTotal)}.` });
  for (const x of compromisso.filter((y) => y.acimaDoTeto)) avisos.push({ tom: 'amarelo', texto: `${x.dia === 'atrasado' ? 'Atrasados' : `Dia ${x.dia.split('-').reverse().join('/')}`}: ${moedaBr(x.valor)} em diárias, acima do teto de ${moedaBr(regras.tetoDiarioLoja)} por dia.` });
  for (const v of vencendo) avisos.push({ tom: 'amarelo', id: v.id, texto: `Nº ${v.numero} ${v.descricao}: ${v.diasParaPrazo <= 0 ? 'prazo termina hoje' : `faltam ${v.diasParaPrazo} dia(s)`} — depois começam diárias de ${moedaBr(v.diaria)}.` });

  return {
    totais: totaisDe(calc.map(({ c, k }) => ({ ...c, ...k }))),
    caixa,
    regras,
    diariaHoje: diariaMediaHoje,
    compromisso,
    pagarAgora,
    sugestoesQuitar,
    vencendo,
    semAssinatura,
    avisos,
  };
}

/** Avisos curtos para o quadro "Avisos importantes" do gestor. */
export async function avisosConsignacao() {
  const p = await painelConsignacao();
  const r: { tipo: 'erro' | 'aviso' | 'info'; mensagem: string; link: string; prioridade: number }[] = [];
  const vendidos = p.pagarAgora.filter((x) => x.status === 'VENDIDO');
  const diarias = p.pagarAgora.filter((x) => x.status !== 'VENDIDO');
  if (vendidos.length) r.push({ tipo: 'erro', prioridade: 1, mensagem: `Consignado vendido: pagar ${moedaBr(vendidos.reduce((s, x) => s + x.valor, 0))} a ${vendidos.length} consignante(s) agora`, link: '/consignacoes' });
  if (diarias.length) r.push({ tipo: diarias.some((x) => x.atrasado > 0) ? 'erro' : 'aviso', prioridade: 2, mensagem: `Diárias de consignação hoje: ${moedaBr(diarias.reduce((s, x) => s + x.valor, 0))} (${diarias.length} consignante${diarias.length > 1 ? 's' : ''})`, link: '/consignacoes' });
  if (p.vencendo.length) r.push({ tipo: 'info', prioridade: 3, mensagem: `${p.vencendo.length} consignado(s) perto de começar as diárias: dê destaque ou peça desconto`, link: '/consignacoes' });
  if (p.sugestoesQuitar.length) r.push({ tipo: 'aviso', prioridade: 2, mensagem: `${p.sugestoesQuitar.length} consignado(s) vendido(s) nas diárias: decidir se quita o saldo`, link: '/consignacoes' });
  return r;
}

// ---------------------------------------------------------------------------- alterar
export interface AlteracaoConsignacao {
  descricao?: string;
  tipoEquipamento?: string;
  marca?: string | null;
  modelo?: string | null;
  numeroSerie?: string | null;
  imei?: string | null;
  estado?: string | null;
  acessorios?: string | null;
  detalhes?: string | null;
  precoVenda?: number;
  mostrarNoSite?: boolean;
  destaque?: boolean;
  observacoes?: string | null;
  declaracaoOrigem?: boolean;
  vendedorId?: number | null;
}

/**
 * Ajusta os dados do equipamento. O valor do consignante é TRAVADO: o preço de venda pode subir
 * (ou baixar até o valor do consignante, saindo da margem da loja); baixar o valor dele só com
 * desconto autorizado por ele (botão "Pedir desconto").
 */
export async function alterarConsignacao(id: number, d: AlteracaoConsignacao, usuarioId: number) {
  const c = await prisma.consignacao.findUnique({ where: { id } });
  if (!c) throw new NotFound('Consignação');
  if (['RETIRADO', 'CANCELADO'].includes(c.status)) throw new AppError(`Consignação ${ROTULO_STATUS[c.status as Status].toLowerCase()}: não dá mais para alterar.`, 422, 'SITUACAO_INVALIDA');
  if (d.precoVenda !== undefined) {
    if (c.status === 'VENDIDO') throw new AppError('Já vendido: o preço não muda mais.', 422, 'SITUACAO_INVALIDA');
    if (d.precoVenda + 0.009 < c.valorConsignante)
      throw new AppError(`O preço não pode ficar abaixo do valor travado do consignante (${moedaBr(c.valorConsignante)}). Para baixar o valor dele, use "Pedir desconto" — ele autoriza pelo WhatsApp.`, 422, 'ABAIXO_DO_CONSIGNANTE', { campo: 'precoVenda' });
  }
  await prisma.$transaction(async (tx) => {
    const dados: any = {};
    for (const k of ['descricao', 'tipoEquipamento', 'marca', 'modelo', 'numeroSerie', 'imei', 'estado', 'acessorios', 'detalhes', 'mostrarNoSite', 'destaque', 'observacoes', 'declaracaoOrigem', 'vendedorId'] as const) {
      if (d[k] !== undefined) dados[k] = typeof d[k] === 'string' ? (d[k] as string).trim() || (k === 'descricao' || k === 'tipoEquipamento' ? (c as any)[k] : null) : d[k];
    }
    if (d.precoVenda !== undefined) dados.precoVenda = arredondar(d.precoVenda);
    await tx.consignacao.update({ where: { id }, data: dados });
    if (c.produtoId) {
      await tx.produto.update({
        where: { id: c.produtoId },
        data: {
          ...(dados.descricao ? { nome: dados.descricao } : {}),
          ...(dados.precoVenda !== undefined ? { preco: dados.precoVenda } : {}),
          ...(dados.marca !== undefined ? { marca: dados.marca } : {}),
          ...(dados.estado !== undefined ? { descricaoCurta: dados.estado } : {}),
          ...(dados.detalhes !== undefined ? { descricaoDetalhada: dados.detalhes } : {}),
        },
      });
    }
    if (dados.precoVenda !== undefined && dados.precoVenda !== c.precoVenda) {
      await registrarEvento(tx, id, 'PRECO', `Preço de venda: ${moedaBr(c.precoVenda)} → ${moedaBr(dados.precoVenda)} (o valor do consignante continua ${moedaBr(c.valorConsignante)}).`, { usuarioId });
    }
  });
  return consignacaoCompleta(id);
}

// ---------------------------------------------------------------------------- fotos
export const PASTA_FOTOS = 'consignados';

export async function salvarFotos(id: number, arquivos: { nome: string; buffer: Buffer }[]) {
  const c = await prisma.consignacao.findUnique({ where: { id }, select: { id: true, fotos: true, produtoId: true } });
  if (!c) throw new NotFound('Consignação');
  const dir = path.join(env.STORAGE_DIR, PASTA_FOTOS, String(id));
  await fs.mkdir(dir, { recursive: true });
  const { default: sharp } = await import('sharp');
  const atuais = lerJson<string[]>(c.fotos, []);
  for (const a of arquivos) {
    const nome = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`;
    try {
      const img = await sharp(a.buffer).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
      await fs.writeFile(path.join(dir, nome), img);
      atuais.push(nome);
    } catch {
      throw new AppError(`"${a.nome}" não é uma imagem válida (envie JPG, PNG, WEBP ou HEIC).`, 422, 'IMAGEM_INVALIDA');
    }
  }
  if (atuais.length > 12) throw new AppError('No máximo 12 fotos por equipamento.', 422, 'FOTOS_DEMAIS');
  await prisma.consignacao.update({ where: { id }, data: { fotos: JSON.stringify(atuais) } });
  if (c.produtoId) await prisma.produto.update({ where: { id: c.produtoId }, data: { imagemUrl: `${env.BASE_PATH}/uploads/${PASTA_FOTOS}/${id}/${atuais[0]}` } });
  return fotosDe({ id, fotos: JSON.stringify(atuais) });
}

export async function removerFoto(id: number, nome: string) {
  const c = await prisma.consignacao.findUnique({ where: { id }, select: { fotos: true, produtoId: true } });
  if (!c) throw new NotFound('Consignação');
  const atuais = lerJson<string[]>(c.fotos, []);
  if (!atuais.includes(nome)) throw new NotFound('Foto');
  const resto = atuais.filter((x) => x !== nome);
  await prisma.consignacao.update({ where: { id }, data: { fotos: JSON.stringify(resto) } });
  await fs.unlink(path.join(env.STORAGE_DIR, PASTA_FOTOS, String(id), path.basename(nome))).catch(() => {});
  if (c.produtoId) await prisma.produto.update({ where: { id: c.produtoId }, data: { imagemUrl: resto[0] ? `${env.BASE_PATH}/uploads/${PASTA_FOTOS}/${id}/${resto[0]}` : null } });
  return fotosDe({ id, fotos: JSON.stringify(resto) });
}

/** Ordem das fotos (a primeira é a capa no site). */
export async function ordenarFotos(id: number, ordem: string[]) {
  const c = await prisma.consignacao.findUnique({ where: { id }, select: { fotos: true, produtoId: true } });
  if (!c) throw new NotFound('Consignação');
  const atuais = lerJson<string[]>(c.fotos, []);
  const nova = [...ordem.filter((n) => atuais.includes(n)), ...atuais.filter((n) => !ordem.includes(n))];
  await prisma.consignacao.update({ where: { id }, data: { fotos: JSON.stringify(nova) } });
  if (c.produtoId && nova[0]) await prisma.produto.update({ where: { id: c.produtoId }, data: { imagemUrl: `${env.BASE_PATH}/uploads/${PASTA_FOTOS}/${id}/${nova[0]}` } });
  return fotosDe({ id, fotos: JSON.stringify(nova) });
}

// ---------------------------------------------------------------------------- assinatura
export async function assinar(id: number, p: { meio: 'CELULAR' | 'LOJA'; nome: string; documento?: string | null; imagemPng?: Buffer | null; ip?: string | null; agente?: string | null; usuarioId?: number | null }) {
  const c = await prisma.consignacao.findUnique({ where: { id }, include: { consignante: { select: { documento: true } } } });
  if (!c) throw new NotFound('Consignação');
  if (c.assinadoEm) return { jaAssinado: true };
  if (['RETIRADO', 'CANCELADO'].includes(c.status)) throw new AppError('Este contrato foi encerrado.', 422, 'SITUACAO_INVALIDA');
  if (p.meio === 'CELULAR') {
    const doc = somenteDigitos(p.documento);
    if (c.consignante.documento && doc !== c.consignante.documento) throw new AppError('O CPF/CNPJ não confere com o do contrato. Digite o documento do dono do equipamento.', 422, 'DOCUMENTO_NAO_CONFERE', { campo: 'documento' });
    if (!p.imagemPng?.length) throw new AppError('Faça sua assinatura no quadro antes de confirmar.', 422, 'SEM_ASSINATURA', { campo: 'assinatura' });
  }
  let arquivo: string | null = null;
  if (p.imagemPng?.length) {
    const dir = path.join(env.STORAGE_DIR, 'anexos', `consignacao-${id}`);
    await fs.mkdir(dir, { recursive: true });
    arquivo = path.join(`consignacao-${id}`, 'assinatura.png');
    await fs.writeFile(path.join(env.STORAGE_DIR, 'anexos', arquivo), p.imagemPng);
  }
  await prisma.consignacao.update({
    where: { id },
    data: { assinadoEm: new Date(), assinadoPor: p.meio, assinaturaNome: p.nome.trim(), assinaturaDocumento: somenteDigitos(p.documento) || null, assinaturaIp: p.ip || null, assinaturaAgente: (p.agente || '').slice(0, 300) || null, assinaturaArquivo: arquivo },
  });
  await registrarEvento(prisma, id, 'ASSINADO', p.meio === 'CELULAR' ? `Contrato assinado pelo celular por ${p.nome.trim()}.` : `Contrato assinado na loja por ${p.nome.trim()}.`, { usuarioId: p.usuarioId });
  return { jaAssinado: false };
}

/** Imagem da assinatura em data URI (para o contrato). */
export async function assinaturaDataUri(c: { assinaturaArquivo: string | null }) {
  if (!c.assinaturaArquivo) return null;
  const arq = path.resolve(env.STORAGE_DIR, 'anexos', c.assinaturaArquivo);
  if (!arq.startsWith(path.resolve(env.STORAGE_DIR) + path.sep)) return null;
  const b = await fs.readFile(arq).catch(() => null);
  return b ? `data:image/png;base64,${b.toString('base64')}` : null;
}

// ---------------------------------------------------------------------------- desconto autorizado pelo consignante
export async function pedirDesconto(id: number, pct: number, origem: 'ROBO' | 'LOJA', usuarioId: number | null = null, db: Db = prisma) {
  const c = await db.consignacao.findUnique({ where: { id } });
  if (!c) throw new NotFound('Consignação');
  if (c.status !== 'NO_PRAZO') throw new AppError('Pedido de desconto só enquanto o equipamento está no prazo (antes das diárias).', 422, 'SITUACAO_INVALIDA');
  if (!(pct > 0 && pct <= 50)) throw new AppError('Desconto entre 1% e 50%.', 422, 'PERCENTUAL', { campo: 'pct' });
  await db.consignacaoDesconto.updateMany({ where: { consignacaoId: id, status: 'PENDENTE' }, data: { status: 'EXPIRADO' } });
  const precoPara = arredondar(c.precoVenda * (1 - pct / 100));
  const valorPara = arredondar(c.valorConsignante * (1 - pct / 100));
  const d = await db.consignacaoDesconto.create({ data: { consignacaoId: id, pct, precoDe: c.precoVenda, precoPara, valorDe: c.valorConsignante, valorPara, origem } });
  await registrarEvento(db, id, 'DESCONTO_PEDIDO', `Pedimos autorização para baixar ${pct}%: preço ${moedaBr(c.precoVenda)} → ${moedaBr(precoPara)}; você receberia ${moedaBr(valorPara)}.`, { usuarioId });
  const nome = await primeiroNome(db, c.consignanteId);
  await avisarConsignante(
    db,
    c,
    `desconto-${d.id}`,
    `Oi, ${nome}! Seu ${c.descricao} ainda não vendeu. Para vender mais rápido, você autoriza baixar ${pct}%?\n\n` +
      `• Preço: ${moedaBr(c.precoVenda)} → ${moedaBr(precoPara)}\n• Você recebe: ${moedaBr(c.valorConsignante)} → ${moedaBr(valorPara)}\n\n` +
      `Responda com um toque aqui: ${linkConsignante(c.token)}`,
  );
  return d;
}

export async function responderDesconto(id: number, descontoId: number, autorizar: boolean, ip?: string | null) {
  const d = await prisma.consignacaoDesconto.findFirst({ where: { id: descontoId, consignacaoId: id } });
  if (!d) throw new NotFound('Pedido de desconto');
  if (d.status !== 'PENDENTE') return { status: d.status, jaRespondido: true };
  const c = await prisma.consignacao.findUnique({ where: { id } });
  if (!c || c.status !== 'NO_PRAZO') {
    await prisma.consignacaoDesconto.update({ where: { id: d.id }, data: { status: 'EXPIRADO' } });
    throw new AppError('Este pedido de desconto não vale mais (o equipamento já vendeu ou o prazo terminou).', 422, 'DESCONTO_EXPIRADO');
  }
  await prisma.$transaction(async (tx) => {
    await tx.consignacaoDesconto.update({ where: { id: d.id }, data: { status: autorizar ? 'AUTORIZADO' : 'RECUSADO', respondidoEm: new Date(), ip: ip || null } });
    if (!autorizar) {
      await registrarEvento(tx, id, 'DESCONTO_RECUSADO', `Desconto de ${d.pct}% recusado. O preço continua ${moedaBr(c.precoVenda)}.`);
      return;
    }
    await tx.consignacao.update({ where: { id }, data: { precoVenda: d.precoPara, valorConsignante: d.valorPara } });
    if (c.produtoId) await tx.produto.update({ where: { id: c.produtoId }, data: { preco: d.precoPara, precoCusto: d.valorPara } });
    if (c.compraId) {
      await tx.compraItem.updateMany({ where: { compraId: c.compraId }, data: { valorUnitario: d.valorPara, total: d.valorPara } });
      await tx.compra.update({ where: { id: c.compraId }, data: { totalProdutos: d.valorPara, total: d.valorPara } });
      await tx.compraParcela.updateMany({ where: { compraId: c.compraId }, data: { valor: d.valorPara } });
    }
    await registrarEvento(tx, id, 'DESCONTO_AUTORIZADO', `Desconto de ${d.pct}% autorizado: preço ${moedaBr(d.precoDe)} → ${moedaBr(d.precoPara)}; você recebe ${moedaBr(d.valorPara)}.`);
  });
  return { status: autorizar ? 'AUTORIZADO' : 'RECUSADO', jaRespondido: false };
}

// ---------------------------------------------------------------------------- escolha do consignante (fim do prazo)
export async function escolher(id: number, escolha: 'RECEBER' | 'RETIRAR') {
  const c = await prisma.consignacao.findUnique({ where: { id } });
  if (!c) throw new NotFound('Consignação');
  if (!['NO_PRAZO', 'EM_DIARIAS', 'AGUARDANDO_RETIRADA'].includes(c.status)) throw new AppError(`A consignação está "${ROTULO_STATUS[c.status as Status]}": não há o que escolher.`, 422, 'SITUACAO_INVALIDA');
  const hoje = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.consignacao.update({ where: { id }, data: { escolha, escolhaEm: hoje } });
    if (escolha === 'RETIRAR') {
      const antesDoPrazo = c.status === 'NO_PRAZO' && inicioDoDia(hoje) < inicioDoDia(c.dataLimite);
      if (c.status === 'EM_DIARIAS') {
        // para de gerar diárias; o que já foi pago é devolvido na retirada
        await tx.contaPagar.updateMany({ where: { consignacaoId: id, situacao: 'ABERTO', valorPago: 0 }, data: { situacao: 'CANCELADO' } });
      }
      await tx.consignacao.update({ where: { id }, data: { status: 'AGUARDANDO_RETIRADA' } });
      await registrarEvento(tx, id, 'ESCOLHA', antesDoPrazo ? `O consignante vai retirar o equipamento antes do prazo (taxa de ${moedaBr(c.taxaRetirada)}).` : 'O consignante escolheu retirar o equipamento (sem taxa).');
    } else {
      if (c.status === 'AGUARDANDO_RETIRADA') {
        const voltaPara: Status = inicioDoDia(hoje) >= inicioDoDia(c.dataLimite) ? 'EM_DIARIAS' : 'NO_PRAZO';
        await tx.consignacao.update({ where: { id }, data: { status: voltaPara } });
        if (voltaPara === 'EM_DIARIAS') await gerarDiarias(tx, c, { aPartirDe: hoje });
      }
      await registrarEvento(tx, id, 'ESCOLHA', 'O consignante escolheu receber aos poucos (diárias em dias úteis).');
    }
  });
  return consignacaoCompleta(id);
}

// ---------------------------------------------------------------------------- pagamentos ao consignante
/**
 * Paga o consignante: por padrão, tudo que vence até hoje (diárias do dia/atrasadas ou o valor da venda);
 * com `valor`, abate da mais antiga para a mais nova.
 */
export async function pagarConsignante(id: number, p: { contaFinanceiraId: number; valor?: number | null; data: Date; tudo?: boolean }) {
  const c = await carregarConsignacao(id);
  if (!c) throw new NotFound('Consignação');
  const cf = await prisma.contaFinanceira.findUnique({ where: { id: p.contaFinanceiraId } });
  if (!cf || !cf.ativo) throw new AppError('Escolha a conta (banco ou caixa) de onde sai o dinheiro.', 422, 'CONTA_FINANCEIRA', { campo: 'contaFinanceiraId' });
  const fimHoje = new Date(inicioDoDia(p.data).getTime() + 86400000 - 1);
  const emAberto = c.contasPagar.filter(abertas);
  if (!emAberto.length) throw new AppError('Nada em aberto para pagar a este consignante.', 422, 'NADA_A_PAGAR');
  const devidas = p.tudo || p.valor ? emAberto : emAberto.filter((x) => x.vencimento <= fimHoje);
  if (!devidas.length) throw new AppError(`Nada vence hoje. A próxima diária é em ${dataBr(emAberto[0].vencimento)} (${moedaBr(saldoContaPagar(emAberto[0]))}).`, 422, 'NADA_HOJE');
  const totalDevido = arredondar(devidas.reduce((s, x) => s + saldoContaPagar(x), 0));
  const valor = arredondar(p.valor && p.valor > 0 ? p.valor : totalDevido);
  if (valor > totalDevido + 0.009) throw new AppError(`Valor maior que o saldo em aberto (${moedaBr(totalDevido)}).`, 422, 'VALOR_ACIMA_DO_SALDO');
  let resta = valor;
  for (const x of devidas) {
    if (resta <= 0.009) break;
    const parte = arredondar(Math.min(resta, saldoContaPagar(x)));
    if (parte <= 0) continue;
    await baixarContaPagar({ id: x.id, valor: parte, data: p.data, contaFinanceiraId: p.contaFinanceiraId, observacoes: `Pagamento ao consignante (consignação nº ${c.numero})` });
    resta = arredondar(resta - parte);
  }
  await prisma.$transaction((tx) => atualizarQuitacao(tx, id));
  await informarPagamento(id);
  return consignacaoCompleta(id);
}

/**
 * Vendido durante as diárias (ou antecipação decidida pelo ADM): troca as diárias que faltam
 * por uma conta só, vencendo hoje — e, com a conta financeira, já paga.
 */
export async function quitarSaldo(id: number, p: { contaFinanceiraId?: number | null; data: Date; usuarioId: number }) {
  const c = await carregarConsignacao(id);
  if (!c) throw new NotFound('Consignação');
  if (!['VENDIDO', 'EM_DIARIAS', 'AGUARDANDO_RETIRADA'].includes(c.status)) throw new AppError('Só dá para quitar o saldo de consignação vendida ou em diárias.', 422, 'SITUACAO_INVALIDA');
  const k = calcular(c);
  if (k.saldo <= 0.009) throw new AppError('O consignante já recebeu tudo.', 422, 'JA_QUITADO');
  await prisma.$transaction(async (tx) => {
    await tx.contaPagar.updateMany({ where: { consignacaoId: id, situacao: 'ABERTO', valorPago: 0 }, data: { situacao: 'CANCELADO' } });
    // diária paga pela metade: o resto entra na quitação
    const parciais = await tx.contaPagar.findMany({ where: { consignacaoId: id, situacao: 'PARCIAL' } });
    for (const x of parciais) await tx.contaPagar.update({ where: { id: x.id }, data: { valor: arredondar(x.valorPago - x.juros + x.desconto), situacao: 'PAGO', dataPagamento: x.dataPagamento || new Date() } });
    const pagoAgora = arredondar((await tx.contaPagar.findMany({ where: { consignacaoId: id, situacao: { not: 'CANCELADO' } } })).reduce((s, x) => s + (x.valorPago - x.juros), 0));
    const falta = arredondar(c.valorConsignante - pagoAgora);
    const categoriaId = await categoriaPadraoId(tx, CATEGORIA_PAGAMENTO, 'DESPESA', 'CMV');
    const hoje = meioDia(p.data);
    await tx.contaPagar.create({
      data: { contatoId: c.consignanteId, descricao: `Consignação nº ${c.numero} — quitação do saldo — ${c.descricao}`, dataEmissao: hoje, vencimento: hoje, competencia: competenciaDe(hoje), valor: falta, categoriaId: await Promise.resolve(categoriaId), origemTipo: 'CONSIGNACAO', origemId: id, consignacaoId: id, parcela: 'QUITACAO' },
    });
    await registrarEvento(tx, id, 'QUITACAO', `Saldo de ${moedaBr(falta)} será pago de uma vez (as diárias que faltavam foram trocadas pela quitação).`, { usuarioId: p.usuarioId });
  });
  if (p.contaFinanceiraId) return pagarConsignante(id, { contaFinanceiraId: p.contaFinanceiraId, data: p.data, tudo: true });
  return consignacaoCompleta(id);
}

const temporizadores = new Map<number, NodeJS.Timeout>();

/** Avisa o consignante do pagamento (junta pagamentos feitos em sequência numa mensagem só). */
export async function informarPagamento(id: number, atraso = 0) {
  const t = temporizadores.get(id);
  if (t) clearTimeout(t);
  const executar = async () => {
    temporizadores.delete(id);
    const c = await carregarConsignacao(id);
    if (!c) return;
    const k = calcular(c);
    const avisos = lerJson<Record<string, string | number>>(c.avisos, {});
    const informado = Number(avisos.pagoInformado || 0);
    const novo = arredondar(k.pago - informado);
    if (novo <= 0.009) return;
    avisos.pagoInformado = k.pago;
    await prisma.consignacao.update({ where: { id }, data: { avisos: JSON.stringify(avisos) } });
    c.avisos = JSON.stringify(avisos);
    await registrarEvento(prisma, id, 'PAGAMENTO', `Pagamento de ${moedaBr(novo)}. Recebido até agora: ${moedaBr(k.pago)} de ${moedaBr(c.valorConsignante)}.`);
    if (k.saldo <= 0.009) return; // a mensagem de "tudo pago" sai na quitação
    const nome = await primeiroNome(prisma, c.consignanteId);
    await avisarConsignante(
      prisma,
      c,
      null,
      `Olá, ${nome}! Fizemos um pagamento de ${moedaBr(novo)} referente à consignação nº ${c.numero} (${c.descricao}).\nRecebido até agora: ${moedaBr(k.pago)} de ${moedaBr(c.valorConsignante)} · falta ${moedaBr(k.saldo)}.\n${linkConsignante(c.token)}`,
    );
  };
  if (atraso > 0) temporizadores.set(id, setTimeout(() => void executar().catch(() => {}), atraso));
  else await executar();
}

// ---------------------------------------------------------------------------- retirada e cancelamento
export async function retirar(id: number, p: { isentarTaxa?: boolean; recebido?: boolean; contaFinanceiraId?: number | null; data: Date; usuarioId: number }) {
  const c = await carregarConsignacao(id);
  if (!c) throw new NotFound('Consignação');
  if (!['NO_PRAZO', 'EM_DIARIAS', 'AGUARDANDO_RETIRADA'].includes(c.status)) throw new AppError(`Consignação "${ROTULO_STATUS[c.status as Status]}": o equipamento não está mais com a loja.`, 422, 'SITUACAO_INVALIDA');
  const k = calcular(c);
  if (k.estoque < 1) throw new AppError('O equipamento não está no estoque (já saiu numa venda?). Confira antes de registrar a retirada.', 422, 'SEM_ESTOQUE');
  const antesDoPrazo = inicioDoDia(p.data) < inicioDoDia(c.dataLimite);
  const taxa = antesDoPrazo && !p.isentarTaxa ? c.taxaRetirada : 0;
  const devolver = k.pago; // diárias já recebidas voltam para a loja
  if ((taxa > 0 || devolver > 0) && p.recebido && !p.contaFinanceiraId) throw new AppError('Escolha a conta onde o dinheiro da retirada entrou.', 422, 'CONTA_FINANCEIRA', { campo: 'contaFinanceiraId' });
  const receber: { descricao: string; valor: number; categoria: string }[] = [];
  if (taxa > 0) receber.push({ descricao: `Consignação nº ${c.numero} — taxa de retirada antes do prazo — ${c.descricao}`, valor: taxa, categoria: CATEGORIA_TAXA });
  if (devolver > 0.009) receber.push({ descricao: `Consignação nº ${c.numero} — devolução das diárias recebidas — ${c.descricao}`, valor: devolver, categoria: CATEGORIA_DEVOLUCAO });
  const hoje = meioDia(p.data);
  const criadas = await prisma.$transaction(
    async (tx) => {
      await tx.contaPagar.updateMany({ where: { consignacaoId: id, situacao: 'ABERTO', valorPago: 0 }, data: { situacao: 'CANCELADO' } });
      const ids: number[] = [];
      for (const r of receber) {
        const categoriaId = await categoriaPadraoId(tx, r.categoria, 'RECEITA', 'OUTRAS');
        const cr = await tx.contaReceber.create({ data: { contatoId: c.consignanteId, descricao: r.descricao, dataEmissao: hoje, vencimento: hoje, competencia: competenciaDe(hoje), valor: r.valor, categoriaId, origemTipo: 'CONSIGNACAO', origemId: id, consignacaoId: id } });
        ids.push(cr.id);
      }
      if (c.compraId) {
        const ctx: ContextoAcao = { modulo: 'COMPRA', entidadeId: c.compraId, tx, usuarioId: p.usuarioId, situacaoOrigemId: null, situacaoDestinoId: null as any };
        await acaoEstornarEstoque(ctx);
        const compra = await tx.compra.findUnique({ where: { id: c.compraId }, include: { situacao: true } });
        const cancelado = await tx.situacao.findFirst({ where: { modulo: 'COMPRA', cancelamento: true, ativo: true }, orderBy: { ordem: 'asc' } });
        if (compra && cancelado && compra.situacaoId !== cancelado.id) {
          await tx.compra.update({ where: { id: compra.id }, data: { situacaoId: cancelado.id } });
          await tx.historicoSituacao.create({ data: { entidadeTipo: 'COMPRA', entidadeId: compra.id, deSituacaoId: compra.situacaoId, deSituacao: compra.situacao.nome, paraSituacaoId: cancelado.id, paraSituacao: cancelado.nome, usuarioId: p.usuarioId, observacao: `Consignação nº ${c.numero}: equipamento retirado pelo consignante` } });
        }
      }
      if (c.produtoId) await tx.produto.update({ where: { id: c.produtoId }, data: { ativo: false } });
      await tx.consignacao.update({ where: { id }, data: { status: 'RETIRADO', retiradoEm: new Date() } });
      await tx.consignacaoDesconto.updateMany({ where: { consignacaoId: id, status: 'PENDENTE' }, data: { status: 'EXPIRADO' } });
      const partes = [taxa > 0 ? `taxa de ${moedaBr(taxa)}` : antesDoPrazo ? 'taxa dispensada pela loja' : 'sem taxa (depois do prazo)', devolver > 0.009 ? `devolução de ${moedaBr(devolver)} em diárias já recebidas` : null].filter(Boolean);
      await registrarEvento(tx, id, 'RETIRADO', `Equipamento retirado pelo consignante (${partes.join('; ')}).`, { usuarioId: p.usuarioId });
      return ids;
    },
    { timeout: 30000 },
  );
  if (p.recebido && p.contaFinanceiraId) {
    for (const crId of criadas) {
      const cr = await prisma.contaReceber.findUnique({ where: { id: crId } });
      if (cr) await baixarContaReceber({ id: cr.id, valor: cr.valor, data: p.data, contaFinanceiraId: p.contaFinanceiraId, observacoes: `Retirada do consignado nº ${c.numero}` });
    }
  }
  const nome = await primeiroNome(prisma, c.consignanteId);
  const fresca = await prisma.consignacao.findUnique({ where: { id } });
  if (fresca) await avisarConsignante(prisma, fresca, 'retirado', `Olá, ${nome}! Registramos a retirada do seu ${c.descricao} (consignação nº ${c.numero}). Obrigado por confiar no Balão da Informática — quando quiser, é só voltar!`);
  return consignacaoCompleta(id);
}

/** Lançada por engano: só sem venda e sem nenhum pagamento. */
export async function cancelarConsignacao(id: number, usuarioId: number) {
  const c = await carregarConsignacao(id);
  if (!c) throw new NotFound('Consignação');
  if (c.status === 'CANCELADO') return consignacaoCompleta(id);
  if (c.status === 'VENDIDO' || c.status === 'QUITADO') throw new AppError('Já vendido ou quitado: não dá para cancelar. Estorne a venda antes, se for o caso.', 422, 'SITUACAO_INVALIDA');
  if (c.contasPagar.some((x) => x.valorPago > 0)) throw new AppError('Já há pagamento ao consignante. Estorne os pagamentos no contas a pagar ou registre a retirada.', 422, 'TEM_PAGAMENTO');
  await prisma.$transaction(async (tx) => {
    await tx.contaPagar.updateMany({ where: { consignacaoId: id, situacao: { not: 'CANCELADO' } }, data: { situacao: 'CANCELADO' } });
    if (c.compraId) {
      await acaoEstornarEstoque({ modulo: 'COMPRA', entidadeId: c.compraId, tx, usuarioId, situacaoOrigemId: null, situacaoDestinoId: null as any });
      const compra = await tx.compra.findUnique({ where: { id: c.compraId }, include: { situacao: true } });
      const cancelado = await tx.situacao.findFirst({ where: { modulo: 'COMPRA', cancelamento: true, ativo: true }, orderBy: { ordem: 'asc' } });
      if (compra && cancelado && compra.situacaoId !== cancelado.id) {
        await tx.compra.update({ where: { id: compra.id }, data: { situacaoId: cancelado.id } });
        await tx.historicoSituacao.create({ data: { entidadeTipo: 'COMPRA', entidadeId: compra.id, deSituacaoId: compra.situacaoId, deSituacao: compra.situacao.nome, paraSituacaoId: cancelado.id, paraSituacao: cancelado.nome, usuarioId, observacao: `Consignação nº ${c.numero} cancelada` } });
      }
    }
    if (c.produtoId) await tx.produto.update({ where: { id: c.produtoId }, data: { ativo: false } });
    await tx.consignacao.update({ where: { id }, data: { status: 'CANCELADO', canceladoEm: new Date() } });
    await tx.consignacaoDesconto.updateMany({ where: { consignacaoId: id, status: 'PENDENTE' }, data: { status: 'EXPIRADO' } });
    await registrarEvento(tx, id, 'CANCELADO', 'Consignação cancelada (lançada por engano).', { publico: false, usuarioId });
  });
  return consignacaoCompleta(id);
}

/** Reenvia o link do contrato pelo WhatsApp. */
export async function reenviarLink(id: number) {
  const c = await prisma.consignacao.findUnique({ where: { id } });
  if (!c) throw new NotFound('Consignação');
  const nome = await primeiroNome(prisma, c.consignanteId);
  await avisarConsignante(prisma, c, null, `Olá, ${nome}! Este é o link da sua consignação nº ${c.numero} (${c.descricao}) no Balão da Informática. ${c.assinadoEm ? 'Acompanhe por aqui' : 'Assine o contrato e acompanhe por aqui'}: ${linkConsignante(c.token)}`);
  return { ok: true, link: linkConsignante(c.token) };
}

/** Força o início das diárias agora (ex.: combinado com o consignante). */
export async function iniciarDiariasAgora(id: number, usuarioId: number) {
  const c = await prisma.consignacao.findUnique({ where: { id } });
  if (!c) throw new NotFound('Consignação');
  if (c.status !== 'NO_PRAZO') throw new AppError('As diárias só começam a partir do prazo (consignação no prazo).', 422, 'SITUACAO_INVALIDA');
  await prisma.$transaction(async (tx) => {
    await tx.consignacao.update({ where: { id }, data: { dataLimite: c.dataLimite > new Date() ? meioDia(new Date()) : c.dataLimite } });
    const atual = await tx.consignacao.findUniqueOrThrow({ where: { id } });
    await gerarDiarias(tx, atual, { usuarioId });
  });
  return consignacaoCompleta(id);
}

// ---------------------------------------------------------------------------- robô diário
/**
 * Roda a cada 30 min:
 *  - nos dias configurados (padrão 3º e 7º), pede ao consignante autorização para baixar 5%;
 *  - no fim do prazo, gera as diárias e avisa o consignante (com a opção de retirar sem taxa).
 */
export async function rodarRobo(hoje = new Date()) {
  const regras = await lerRegras();
  const lista = await prisma.consignacao.findMany({ where: { status: 'NO_PRAZO' } });
  let descontos = 0;
  let diarias = 0;
  for (const c of lista) {
    try {
      const dias = diasEntre(c.dataEntrada, hoje);
      const passouPrazo = inicioDoDia(hoje) >= inicioDoDia(c.dataLimite);
      if (passouPrazo) {
        await prisma.$transaction(async (tx) => {
          const atual = await tx.consignacao.findUnique({ where: { id: c.id } });
          if (!atual || atual.status !== 'NO_PRAZO') return;
          await tx.consignacaoDesconto.updateMany({ where: { consignacaoId: c.id, status: 'PENDENTE' }, data: { status: 'EXPIRADO' } });
          const r = await gerarDiarias(tx, atual);
          if (!r.quantidade) return;
          diarias++;
          const nome = await primeiroNome(tx, atual.consignanteId);
          await avisarConsignante(
            tx,
            atual,
            'prazo',
            `Olá, ${nome}! O prazo de ${atual.prazoDias} dias da consignação nº ${atual.numero} terminou e o ${atual.descricao} ainda não vendeu.\n\n` +
              `A partir de ${dataBr(r.primeira!)} começamos a te pagar ${moedaBr(r.diaria)} por dia útil (${r.quantidade} pagamento${r.quantidade > 1 ? 's' : ''}, total ${moedaBr(r.total!)}). Se vender antes, pagamos o que faltar.\n\n` +
              `Prefere retirar o equipamento? É sem taxa. Escolha aqui: ${linkConsignante(atual.token)}`,
          );
        });
        continue;
      }
      if (!c.assinadoEm) continue;
      const avisos = lerJson<Record<string, string>>(c.avisos, {});
      const dia = regras.diasPedirDesconto.filter((d) => dias >= d && d < c.prazoDias).sort((a, b) => b - a)[0];
      if (dia !== undefined && !avisos[`pedir-desconto-dia-${dia}`] && regras.descontoPct > 0) {
        const pendente = await prisma.consignacaoDesconto.findFirst({ where: { consignacaoId: c.id, status: 'PENDENTE' } });
        avisos[`pedir-desconto-dia-${dia}`] = new Date().toISOString();
        await prisma.consignacao.update({ where: { id: c.id }, data: { avisos: JSON.stringify(avisos) } });
        if (!pendente) {
          await pedirDesconto(c.id, regras.descontoPct, 'ROBO');
          descontos++;
        }
      }
    } catch (e) {
      console.error(`[consignacao] robô falhou na consignação ${c.id}`, e);
    }
  }
  return { conferidas: lista.length, descontosPedidos: descontos, diariasIniciadas: diarias };
}

// ---------------------------------------------------------------------------- link do consignante e vitrine do site
/** O que o consignante vê no link (sem custos internos da loja nem dados de outras pessoas). */
export async function visaoConsignante(token: string) {
  const c = await prisma.consignacao.findUnique({ where: { token }, include: includeConsignacao });
  if (!c) throw new NotFound('Consignação');
  const k = calcular(c);
  const emp = await prisma.empresa.findUnique({ where: { id: 1 } });
  const hoje = new Date();
  const podeEscolher = ['EM_DIARIAS', 'AGUARDANDO_RETIRADA'].includes(c.status) || (c.status === 'NO_PRAZO' && inicioDoDia(hoje) >= inicioDoDia(c.dataLimite));
  return {
    empresa: { nome: emp?.nomeFantasia || emp?.razaoSocial || 'Balão da Informática', telefone: emp?.telefone || null, site: emp?.site || null, logoPath: emp?.logoPath || null },
    consignacao: {
      numero: c.numero,
      status: c.status,
      rotuloStatus: k.rotuloStatus,
      consignante: c.consignante.nome.split(/\s+/)[0],
      descricao: c.descricao,
      tipoEquipamento: c.tipoEquipamento,
      marca: c.marca,
      modelo: c.modelo,
      estado: c.estado,
      acessorios: c.acessorios,
      numeroSerie: c.numeroSerie,
      imei: c.imei,
      fotos: k.fotosUrls,
      precoVenda: c.precoVenda,
      percentualConsignante: c.percentualConsignante,
      valorConsignante: c.valorConsignante,
      dataEntrada: c.dataEntrada,
      dataLimite: c.dataLimite,
      diasConsignado: k.diasConsignado,
      diasParaPrazo: k.diasParaPrazo,
      prazoDias: c.prazoDias,
      diaria: c.diariaValor || planoDiarias(c.valorConsignante, c).diaria,
      diariaPct: c.diariaPct,
      taxaRetirada: c.taxaRetirada,
      assinado: !!c.assinadoEm,
      assinadoEm: c.assinadoEm,
      vendidoEm: c.vendidoEm,
      retiradoEm: c.retiradoEm,
      quitadoEm: c.quitadoEm,
      escolha: c.escolha,
      podeEscolher,
      pago: k.pago,
      saldo: k.saldo,
      proximoPagamento: k.proximaDiaria,
      pagamentos: c.contasPagar
        .filter((x) => x.situacao !== 'CANCELADO')
        .map((x) => ({ descricao: x.parcela === 'VENDA' ? 'Pagamento da venda' : x.parcela === 'QUITACAO' ? 'Quitação do saldo' : `Diária ${x.parcela}`, vencimento: x.vencimento, valor: x.valor, pago: arredondar(x.valorPago - x.juros), situacao: x.situacao, dataPagamento: x.dataPagamento })),
      descontoPendente: k.descontoPendente ? { id: k.descontoPendente.id, pct: k.descontoPendente.pct, precoDe: k.descontoPendente.precoDe, precoPara: k.descontoPendente.precoPara, valorDe: k.descontoPendente.valorDe, valorPara: k.descontoPendente.valorPara } : null,
      linhaDoTempo: c.eventos.filter((e) => e.publico).map((e) => ({ data: e.data, tipo: e.tipo, texto: e.texto })),
      noSite: c.mostrarNoSite && !!c.assinadoEm && ['NO_PRAZO', 'EM_DIARIAS'].includes(c.status),
    },
  };
}

function slug(t: string) {
  return t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

/** Vitrine "Consignados" do site: só o que está assinado, na loja e marcado para o site. */
export async function vitrine() {
  const lista = await prisma.consignacao.findMany({
    where: { status: { in: ['NO_PRAZO', 'EM_DIARIAS'] }, mostrarNoSite: true, assinadoEm: { not: null } },
    include: { produto: { select: { id: true, codigo: true, preco: true, precoCartao: true, ativo: true, saldos: { select: { saldo: true } } } } },
    orderBy: [{ destaque: 'desc' }, { dataEntrada: 'desc' }],
  });
  const base = env.APP_URL.replace(/\/$/, '').replace(new RegExp(`${env.BASE_PATH}$`), '');
  return lista
    .filter((c) => c.produto?.ativo && c.produto.saldos.reduce((s, x) => s + x.saldo, 0) > 0)
    .map((c) => ({
      numero: c.numero,
      slug: `${slug(c.descricao)}-c${c.numero}`,
      titulo: c.descricao,
      tipo: c.tipoEquipamento,
      marca: c.marca,
      modelo: c.modelo,
      estado: c.estado,
      acessorios: c.acessorios,
      detalhes: c.detalhes,
      preco: c.precoVenda,
      codigo: c.produto?.codigo,
      destaque: c.destaque,
      novidade: diasEntre(c.dataEntrada, new Date()) <= 3,
      desde: c.dataEntrada,
      fotos: fotosDe(c).map((f) => `${base}${f.url}`),
      garantia: '3 meses de garantia da loja',
    }));
}
