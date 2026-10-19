/**
 * Rotas públicas (sem token): acompanhamento de OS / pedido pelo cliente e aprovação de orçamento.
 * O token é derivado do id + APP_SECRET (ver token.ts). Nunca expõe dados sensíveis (custos, senha do equipamento, observações internas).
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { AppError, NotFound } from '../../lib/errors.js';
import { auditar } from '../../lib/auditoria.js';
import { mudarSituacao } from '../../core/situacoes.js';
import { enderecoLinha, formatarTelefone } from '../comum/html.js';
import { calcularAtrasada } from '../ordens-servico/service.js';
import { idPorToken } from './token.js';

export default async function publicoRoutes(app: FastifyInstance) {
  const limite = { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } };

  async function empresaPublica() {
    const e = await prisma.empresa.findUnique({ where: { id: 1 } });
    return {
      nome: e?.nomeFantasia || e?.razaoSocial || '',
      telefone: formatarTelefone(e?.telefone),
      email: e?.email || null,
      site: e?.site || null,
      endereco: e ? enderecoLinha(e) : '',
      logoPath: e?.logoPath || null,
    };
  }

  const primeiroNome = (n: string) => n.split(' ')[0];

  // ---- OS
  app.get('/api/v1/publico/os/:token', limite, async (req) => {
    const token = String((req.params as any).token || '');
    const id = await idPorToken('os', token);
    if (!id) throw new NotFound('Ordem de serviço');
    const os = await prisma.ordemServico.findUnique({
      where: { id },
      include: {
        contato: { select: { nome: true } },
        tecnico: { select: { nome: true } },
        situacao: { select: { id: true, nome: true, cor: true, final: true, cancelamento: true } },
        itens: { orderBy: { ordem: 'asc' }, select: { tipo: true, descricao: true, quantidade: true, valorUnitario: true, desconto: true, total: true } },
        parcelas: { orderBy: { numero: 'asc' }, select: { numero: true, dataVencimento: true, valor: true, formaPagamento: { select: { nome: true } }, contaReceber: { select: { situacao: true } } } },
      },
    });
    if (!os) throw new NotFound('Ordem de serviço');
    const historicoSit = await prisma.historicoSituacao.findMany({
      where: { entidadeTipo: 'OS', entidadeId: id },
      orderBy: { data: 'asc' },
      select: { paraSituacao: true, data: true },
    });
    return {
      empresa: await empresaPublica(),
      os: {
        numero: os.numero,
        cliente: primeiroNome(os.contato.nome),
        dataEntrada: os.dataEntrada,
        dataPrevista: os.dataPrevista,
        dataConclusao: os.dataConclusao,
        equipamento: [os.equipamento, os.marca, os.modelo].filter(Boolean).join(' '),
        numeroSerie: os.numeroSerie,
        defeitoRelatado: os.defeitoRelatado,
        diagnostico: os.diagnostico,
        servicoExecutado: os.servicoExecutado,
        tecnico: os.tecnico?.nome || null,
        situacao: os.situacao,
        atrasada: calcularAtrasada(os),
        orcar: os.orcar,
        orcamentoAprovado: os.orcamentoAprovado,
        orcamentoAprovadoEm: os.orcamentoAprovadoEm,
        podeAprovar: os.orcar && !os.orcamentoAprovado && !os.situacao.final && !os.situacao.cancelamento,
        itens: os.itens,
        totalServicos: os.totalServicos,
        totalPecas: os.totalPecas,
        descontoValor: os.descontoValor,
        total: os.total,
        garantiaDias: os.garantiaDias,
        parcelas: os.parcelas.map((p) => ({ numero: p.numero, dataVencimento: p.dataVencimento, valor: p.valor, formaPagamento: p.formaPagamento?.nome || null, situacao: p.contaReceber?.situacao || null })),
        observacoes: os.observacoes,
        historico: historicoSit,
      },
    };
  });

  app.post('/api/v1/publico/os/:token/aprovar', limite, async (req) => {
    const token = String((req.params as any).token || '');
    const id = await idPorToken('os', token);
    if (!id) throw new NotFound('Ordem de serviço');
    const body = z.object({ nome: z.string().trim().min(2, 'Informe seu nome').max(120), observacao: z.string().trim().max(500).nullable().optional() }).parse(req.body || {});
    const os = await prisma.ordemServico.findUnique({ where: { id }, include: { situacao: true } });
    if (!os) throw new NotFound('Ordem de serviço');
    if (!os.orcar) throw new AppError('Esta OS não possui orçamento para aprovação.', 422, 'SEM_ORCAMENTO');
    if (os.orcamentoAprovado) return { ok: true, jaAprovado: true, situacao: { id: os.situacao.id, nome: os.situacao.nome, cor: os.situacao.cor } };
    if (os.situacao.final || os.situacao.cancelamento) throw new AppError('Esta OS já foi finalizada.', 422, 'OS_FINALIZADA');

    await prisma.ordemServico.update({
      where: { id },
      data: { orcamentoAprovado: true, orcamentoAprovadoEm: new Date(), orcamentoAprovadoPor: `${body.nome} (aprovação online)` },
    });
    let situacao = { id: os.situacao.id, nome: os.situacao.nome, cor: os.situacao.cor };
    const aprovada = await prisma.situacao.findFirst({ where: { modulo: 'OS', nome: 'Aprovada', ativo: true } });
    if (aprovada && aprovada.id !== os.situacaoId) {
      const t = await prisma.situacaoTransicao.findUnique({ where: { origemId_destinoId: { origemId: os.situacaoId, destinoId: aprovada.id } } });
      if (t?.ativo) {
        const r = await mudarSituacao({ modulo: 'OS', entidadeId: id, situacaoDestinoId: aprovada.id, usuarioId: null, observacao: `Orçamento aprovado online por ${body.nome}${body.observacao ? ': ' + body.observacao : ''}` });
        situacao = { id: r.situacao.id, nome: r.situacao.nome, cor: r.situacao.cor };
      }
    }
    await auditar(req, 'OrdemServico', id, 'ACAO', { acao: 'aprovarOrcamentoOnline', nome: body.nome, observacao: body.observacao });
    return { ok: true, jaAprovado: false, situacao };
  });

  // ---- Venda
  app.get('/api/v1/publico/venda/:token', limite, async (req) => {
    const token = String((req.params as any).token || '');
    const id = await idPorToken('venda', token);
    if (!id) throw new NotFound('Pedido');
    const v = await prisma.venda.findUnique({
      where: { id },
      include: {
        contato: { select: { nome: true } },
        vendedor: { select: { nome: true } },
        situacao: { select: { id: true, nome: true, cor: true, final: true, cancelamento: true } },
        nota: { select: { numero: true, serie: true, situacao: true, chave: true } },
        itens: { orderBy: { ordem: 'asc' }, select: { descricao: true, quantidade: true, unidade: true, valorUnitario: true, desconto: true, total: true } },
        parcelas: { orderBy: { numero: 'asc' }, select: { numero: true, dataVencimento: true, valor: true, formaPagamento: { select: { nome: true } }, contaReceber: { select: { situacao: true } } } },
      },
    });
    if (!v) throw new NotFound('Pedido');
    const historicoSit = await prisma.historicoSituacao.findMany({ where: { entidadeTipo: 'VENDA', entidadeId: id }, orderBy: { data: 'asc' }, select: { paraSituacao: true, data: true } });
    const descontoCalc = v.descontoTipo === 'PERCENTUAL' ? Math.round(v.totalProdutos * v.descontoValor) / 100 : v.descontoValor;
    return {
      empresa: await empresaPublica(),
      venda: {
        numero: v.numero,
        cliente: primeiroNome(v.contato.nome),
        data: v.data,
        dataPrevista: v.dataPrevista,
        vendedor: v.vendedor?.nome || null,
        situacao: v.situacao,
        itens: v.itens,
        totalProdutos: v.totalProdutos,
        desconto: descontoCalc,
        frete: v.frete,
        outrasDespesas: v.outrasDespesas,
        total: v.total,
        parcelas: v.parcelas.map((p) => ({ numero: p.numero, dataVencimento: p.dataVencimento, valor: p.valor, formaPagamento: p.formaPagamento?.nome || null, situacao: p.contaReceber?.situacao || null })),
        nota: v.nota && v.nota.situacao === 'AUTORIZADA' ? { numero: v.nota.numero, serie: v.nota.serie, chave: v.nota.chave } : null,
        observacoes: v.observacoes,
        historico: historicoSit,
      },
    };
  });
}
