import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { AppError, NotFound } from '../../lib/errors.js';
import { auditar } from '../../lib/auditoria.js';
import { encrypt } from '../../lib/crypto.js';
import { paginacaoSchema, paginar, respostaPaginada, dataSchema, somenteDigitos } from '../../lib/util.js';
import { lerPfx } from './certificado.js';
import * as fiscal from './service.js';
import { orientacaoNota } from './orientacao.js';
import { caminhoXml } from './service.js';
import { registrarServico } from '../../core/servicos.js';

const itemSchema = z.object({
  produtoId: z.number().int().nullable().optional(),
  codigo: z.string().min(1),
  gtin: z.string().nullable().optional(),
  descricao: z.string().min(1),
  ncm: z.string().min(2),
  cest: z.string().nullable().optional(),
  cfop: z.string().min(4),
  unidade: z.string().default('UN'),
  quantidade: z.number().positive(),
  valorUnitario: z.number().nonnegative(),
  desconto: z.number().nonnegative().default(0),
  origem: z.number().int().default(0),
  csosn: z.string().nullable().optional(),
  cst: z.string().nullable().optional(),
  icmsAliquota: z.number().default(0),
  pisCst: z.string().default('49'),
  cofinsCst: z.string().default('49'),
  informacoesAdicionais: z.string().nullable().optional(),
});

const notaSchema = z.object({
  tipo: z.number().int().min(0).max(1).default(1),
  modelo: z.union([z.literal(55), z.literal(65)]).default(55),
  contatoId: z.number().int().nullable().optional(),
  naturezaOperacao: z.string().default('Venda de mercadoria'),
  finalidade: z.number().int().min(1).max(4).default(1),
  consumidorFinal: z.number().int().min(0).max(1).default(1),
  indicadorPresenca: z.number().int().default(1),
  formaPagamentoFiscal: z.string().default('99'),
  informacoesComplementares: z.string().nullable().optional(),
  valorFrete: z.number().nonnegative().default(0),
  valorDesconto: z.number().nonnegative().default(0),
  valorOutras: z.number().nonnegative().default(0),
  fretePorConta: z.number().int().default(9),
  dataSaida: dataSchema,
  itens: z.array(itemSchema).min(1),
});

function totais(itens: z.infer<typeof itemSchema>[], frete: number, descontoGlobal: number, outras: number) {
  const valorProdutos = itens.reduce((s, i) => s + i.quantidade * i.valorUnitario, 0);
  const descItens = itens.reduce((s, i) => s + (i.desconto || 0), 0);
  const valorDesconto = descontoGlobal || descItens;
  const valorTotal = Math.round((valorProdutos - valorDesconto + frete + outras) * 100) / 100;
  return { valorProdutos: Math.round(valorProdutos * 100) / 100, valorDesconto, valorTotal };
}

export default async function fiscalRoutes(app: FastifyInstance) {
  // ------------------------------------------------------------------ certificado A1
  app.post('/api/v1/empresa/certificado', { preHandler: app.exigirPerfil('ADMIN') }, async (req) => {
    const partes = req.parts();
    let arquivo: Buffer | null = null;
    let senha = '';
    for await (const parte of partes) {
      if (parte.type === 'file') arquivo = await parte.toBuffer();
      else if (parte.fieldname === 'senha') senha = String(parte.value || '');
    }
    if (!arquivo) throw new AppError('Envie o arquivo .pfx/.p12 do certificado A1.', 422);
    const cert = lerPfx(arquivo, senha);
    const empresa = await prisma.empresa.findUnique({ where: { id: 1 } });
    if (cert.cnpj && empresa && somenteDigitos(empresa.cnpj) && cert.cnpj !== somenteDigitos(empresa.cnpj)) {
      req.log.warn(`Certificado do CNPJ ${cert.cnpj} difere do CNPJ da empresa ${empresa.cnpj}`);
    }
    await prisma.empresa.update({
      where: { id: 1 },
      data: { certificadoPfx: new Uint8Array(arquivo), certificadoSenha: encrypt(senha), certificadoNome: cert.nome, certificadoValidade: cert.validade },
    });
    await auditar(req, 'Empresa', 1, 'ALTERAR', { certificado: cert.nome });
    return { nome: cert.nome, validade: cert.validade, cnpj: cert.cnpj, inicio: cert.inicio };
  });

  app.delete('/api/v1/empresa/certificado', { preHandler: app.exigirPerfil('ADMIN') }, async (req) => {
    await prisma.empresa.update({ where: { id: 1 }, data: { certificadoPfx: null, certificadoSenha: null, certificadoNome: null, certificadoValidade: null } });
    await auditar(req, 'Empresa', 1, 'ALTERAR', { certificado: 'removido' });
    return { ok: true };
  });

  app.get('/api/v1/fiscal/status-sefaz', async () => fiscal.statusSefaz());

  // ------------------------------------------------------------------ notas fiscais
  app.get('/api/v1/notas-fiscais', async (req) => {
    const q = paginacaoSchema
      .extend({
        tipo: z.coerce.number().int().optional(),
        modelo: z.coerce.number().int().optional(),
        situacao: z.string().optional(),
        pesquisa: z.string().optional(),
        dataInicial: dataSchema,
        dataFinal: dataSchema,
        contatoId: z.coerce.number().int().optional(),
      })
      .parse(req.query);
    const where: any = {};
    if (q.tipo !== undefined) where.tipo = q.tipo;
    if (q.modelo) where.modelo = q.modelo;
    if (q.situacao) where.situacao = q.situacao;
    if (q.contatoId) where.contatoId = q.contatoId;
    if (q.dataInicial || q.dataFinal) where.dataEmissao = { gte: q.dataInicial ?? undefined, lte: q.dataFinal ? new Date(q.dataFinal.getTime() + 11 * 3600 * 1000 + 59 * 60 * 1000) : undefined };
    if (q.pesquisa) {
      const n = Number(q.pesquisa);
      where.OR = [
        { contato: { nome: { contains: q.pesquisa } } },
        { chave: { contains: q.pesquisa } },
        ...(Number.isInteger(n) ? [{ numero: n }] : []),
      ];
    }
    const [total, data] = await Promise.all([
      prisma.notaFiscal.count({ where }),
      prisma.notaFiscal.findMany({
        where,
        ...paginar(q),
        orderBy: [{ dataEmissao: 'desc' }, { numero: 'desc' }],
        select: {
          id: true, tipo: true, modelo: true, serie: true, numero: true, chave: true, situacao: true, dataEmissao: true, dataAutorizacao: true, valorTotal: true, motivo: true, cStat: true, protocolo: true, ambiente: true,
          contato: { select: { id: true, nome: true, documento: true } },
          venda: { select: { id: true, numero: true } },
          os: { select: { id: true, numero: true } },
        },
      }),
    ]);
    return respostaPaginada(data, total, q);
  });

  app.get('/api/v1/notas-fiscais/:id', async (req) => {
    const nota = await fiscal.carregarNota(Number((req.params as any).id));
    return { ...nota, xml: undefined, xmlProtocolo: undefined, temXml: !!nota.xml, temXmlProtocolo: !!nota.xmlProtocolo, orientacao: orientacaoNota(nota as any) };
  });

  // nota rejeitada por duplicidade (número já usado — ex.: emitido pelo Bling): pega o próximo número livre
  app.post('/api/v1/notas-fiscais/:id/renumerar', async (req) => {
    const id = Number((req.params as any).id);
    const r = await prisma.$transaction(async (tx) => {
      const nota = await tx.notaFiscal.findUnique({ where: { id } });
      if (!nota) throw new AppError('Nota fiscal não encontrada.', 404, 'NAO_ENCONTRADO');
      if (!['PENDENTE', 'REJEITADA', 'ERRO'].includes(nota.situacao)) throw new AppError(`Nota ${nota.situacao.toLowerCase()} não pode mudar de número.`, 422, 'NOTA_SITUACAO');
      for (let tentativa = 0; tentativa < 50; tentativa++) {
        const emp = await tx.empresa.update({ where: { id: 1 }, data: nota.modelo === 65 ? { proximoNumeroNfce: { increment: 1 } } : { proximoNumeroNfe: { increment: 1 } } });
        const numero = (nota.modelo === 65 ? emp.proximoNumeroNfce : emp.proximoNumeroNfe) - 1;
        const serie = nota.modelo === 65 ? emp.serieNfce : emp.serieNfe;
        const ocupado = await tx.notaFiscal.findFirst({ where: { modelo: nota.modelo, serie, numero, NOT: { id } }, select: { id: true } });
        if (ocupado || numero <= nota.numero) continue;
        await tx.notaFiscal.update({ where: { id }, data: { numero, serie, chave: null, situacao: 'PENDENTE', cStat: null, motivo: null } });
        return { de: nota.numero, para: numero, serie };
      }
      throw new AppError('Não achei número livre em 50 tentativas — confira a numeração em Configurações → Fiscal.', 422, 'NUMERACAO');
    });
    await auditar(req, 'NotaFiscal', id, 'ALTERAR', { renumerada: r });
    return r;
  });

  app.post('/api/v1/notas-fiscais', async (req, reply) => {
    const body = notaSchema.parse(req.body);
    const { serie, numero, ambiente } = await fiscal.proximoNumeroNota(body.modelo);
    const t = totais(body.itens, body.valorFrete, body.valorDesconto, body.valorOutras);
    const nota = await prisma.notaFiscal.create({
      data: {
        tipo: body.tipo, modelo: body.modelo, serie, numero, ambiente, situacao: 'PENDENTE', contatoId: body.contatoId ?? null,
        naturezaOperacao: body.naturezaOperacao, finalidade: body.finalidade, consumidorFinal: body.consumidorFinal, indicadorPresenca: body.indicadorPresenca,
        formaPagamentoFiscal: body.formaPagamentoFiscal, informacoesComplementares: body.informacoesComplementares ?? null,
        valorFrete: body.valorFrete, valorOutras: body.valorOutras, fretePorConta: body.fretePorConta, dataSaida: body.dataSaida ?? null, ...t,
        itens: { create: body.itens.map((it, i) => ({ ...it, numeroItem: i + 1, valorTotal: Math.round(it.quantidade * it.valorUnitario * 100) / 100 })) },
      },
    });
    await auditar(req, 'NotaFiscal', nota.id, 'CRIAR');
    return reply.code(201).send(await fiscal.carregarNota(nota.id));
  });

  app.put('/api/v1/notas-fiscais/:id', async (req) => {
    const id = Number((req.params as any).id);
    const atual = await prisma.notaFiscal.findUnique({ where: { id } });
    if (!atual) throw new NotFound('Nota fiscal');
    if (!['PENDENTE', 'REJEITADA', 'ERRO'].includes(atual.situacao)) throw new AppError('Só notas pendentes/rejeitadas podem ser editadas.', 422);
    const body = notaSchema.partial({ modelo: true, tipo: true }).parse(req.body);
    const t = totais(body.itens, body.valorFrete ?? 0, body.valorDesconto ?? 0, body.valorOutras ?? 0);
    await prisma.$transaction(async (tx) => {
      await tx.notaFiscalItem.deleteMany({ where: { notaId: id } });
      await tx.notaFiscal.update({
        where: { id },
        data: {
          contatoId: body.contatoId ?? null, naturezaOperacao: body.naturezaOperacao, finalidade: body.finalidade, consumidorFinal: body.consumidorFinal, indicadorPresenca: body.indicadorPresenca,
          formaPagamentoFiscal: body.formaPagamentoFiscal, informacoesComplementares: body.informacoesComplementares ?? null, valorFrete: body.valorFrete, valorOutras: body.valorOutras,
          fretePorConta: body.fretePorConta, dataSaida: body.dataSaida ?? null, situacao: 'PENDENTE', motivo: null, cStat: null, ...t,
          itens: { create: body.itens.map((it, i) => ({ ...it, numeroItem: i + 1, valorTotal: Math.round(it.quantidade * it.valorUnitario * 100) / 100 })) },
        },
      });
    });
    await auditar(req, 'NotaFiscal', id, 'ALTERAR');
    return fiscal.carregarNota(id);
  });

  app.delete('/api/v1/notas-fiscais/:id', { preHandler: app.exigirPerfil('ADMIN', 'GERENTE') }, async (req) => {
    const id = Number((req.params as any).id);
    const nota = await prisma.notaFiscal.findUnique({ where: { id } });
    if (!nota) throw new NotFound('Nota fiscal');
    if (!['PENDENTE', 'ERRO', 'REJEITADA'].includes(nota.situacao)) throw new AppError('Só notas pendentes podem ser excluídas. Notas autorizadas devem ser canceladas.', 422);
    await prisma.$transaction(async (tx) => {
      await tx.venda.updateMany({ where: { notaId: id }, data: { notaId: null } });
      await tx.ordemServico.updateMany({ where: { notaId: id }, data: { notaId: null } });
      await tx.notaFiscal.delete({ where: { id } });
    });
    await auditar(req, 'NotaFiscal', id, 'EXCLUIR');
    return { ok: true };
  });

  app.post('/api/v1/notas-fiscais/:id/transmitir', async (req) => {
    const id = Number((req.params as any).id);
    const r = await fiscal.transmitir(id);
    await auditar(req, 'NotaFiscal', id, 'ACAO', { acao: 'transmitir', ...r });
    return r;
  });

  app.post('/api/v1/notas-fiscais/:id/consultar', async (req) => fiscal.consultar(Number((req.params as any).id)));

  app.post('/api/v1/notas-fiscais/:id/cancelar', { preHandler: app.exigirPerfil('ADMIN', 'GERENTE', 'FINANCEIRO') }, async (req) => {
    const id = Number((req.params as any).id);
    const body = z.object({ justificativa: z.string().min(15, 'Justificativa com no mínimo 15 caracteres') }).parse(req.body);
    const r = await fiscal.cancelar(id, body.justificativa, req.user.id);
    await auditar(req, 'NotaFiscal', id, 'ACAO', { acao: 'cancelar', justificativa: body.justificativa });
    return r;
  });

  app.post('/api/v1/notas-fiscais/:id/carta-correcao', async (req) => {
    const id = Number((req.params as any).id);
    const body = z.object({ texto: z.string().min(15) }).parse(req.body);
    const r = await fiscal.cartaCorrecao(id, body.texto);
    await auditar(req, 'NotaFiscal', id, 'ACAO', { acao: 'carta-correcao' });
    return r;
  });

  app.post('/api/v1/notas-fiscais/inutilizar', { preHandler: app.exigirPerfil('ADMIN', 'GERENTE') }, async (req) => {
    const body = z.object({ modelo: z.union([z.literal(55), z.literal(65)]).default(55), serie: z.number().int(), numeroInicial: z.number().int().positive(), numeroFinal: z.number().int().positive(), justificativa: z.string().min(15) }).parse(req.body);
    const r = await fiscal.inutilizar(body.modelo, body.serie, body.numeroInicial, body.numeroFinal, body.justificativa);
    await auditar(req, 'NotaFiscal', null, 'ACAO', { acao: 'inutilizar', ...body });
    return r;
  });

  app.get('/api/v1/notas-fiscais/:id/xml', async (req, reply) => {
    const nota = await prisma.notaFiscal.findUnique({ where: { id: Number((req.params as any).id) } });
    if (!nota) throw new NotFound('Nota fiscal');
    const xml = nota.xmlProtocolo || nota.xml || (nota.chave && fs.existsSync(caminhoXml(nota.chave)) ? fs.readFileSync(caminhoXml(nota.chave), 'utf8') : null);
    if (!xml) throw new AppError('A nota ainda não possui XML (transmita primeiro).', 422);
    reply.header('Content-Disposition', `attachment; filename="NFe-${nota.chave || nota.numero}.xml"`);
    return reply.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>${xml}`);
  });

  app.get('/api/v1/notas-fiscais/:id/danfe', async (req, reply) => {
    const id = Number((req.params as any).id);
    const { buffer } = await fiscal.gerarPdfDanfe(id);
    const q = z.object({ download: z.coerce.boolean().optional() }).parse(req.query);
    reply.header('Content-Disposition', `${q.download ? 'attachment' : 'inline'}; filename="DANFE-${id}.pdf"`);
    return reply.type('application/pdf').send(buffer);
  });

  app.post('/api/v1/notas-fiscais/:id/enviar-email', async (req) => {
    const id = Number((req.params as any).id);
    const body = z.object({ para: z.string().email().optional() }).parse(req.body ?? {});
    const nota = await fiscal.carregarNota(id);
    if (nota.situacao !== 'AUTORIZADA' || !nota.chave) throw new AppError('Só é possível enviar notas autorizadas.', 422);
    const para = body.para || nota.contato?.email;
    if (!para) throw new AppError('Cliente sem e-mail cadastrado. Informe o destinatário.', 422);
    const emp = await fiscal.empresa();
    const { buffer } = await fiscal.gerarPdfDanfe(id);
    const xml = nota.xmlProtocolo || nota.xml || '';
    let enviado = false;
    try {
      const email: any = await import(/* @vite-ignore */ '../email/servico.js' as string);
      await email.enviarEmail({
        para,
        assunto: `NF-e ${nota.numero} — ${emp.nomeFantasia || emp.razaoSocial}`,
        html: `<p>Olá ${nota.contato?.nome || ''},</p><p>Segue em anexo a NF-e nº <b>${nota.numero}</b> (chave ${nota.chave}).</p><p>${emp.nomeFantasia || emp.razaoSocial}</p>`,
        anexos: [
          { filename: `NFe-${nota.chave}.xml`, content: `<?xml version="1.0" encoding="UTF-8"?>${xml}`, contentType: 'application/xml' },
          { filename: `DANFE-${nota.numero}.pdf`, content: buffer, contentType: 'application/pdf' },
        ],
      });
      enviado = true;
    } catch (e: any) {
      throw new AppError(`Falha ao enviar e-mail: ${e?.message || e}`, 422, 'EMAIL');
    }
    await prisma.notificacao.create({ data: { canal: 'EMAIL', destinatario: para, assunto: `NF-e ${nota.numero}`, corpo: 'XML + DANFE em anexo', status: 'ENVIADA', enviadaEm: new Date(), origemTipo: 'NFE', origemId: id, contatoId: nota.contatoId, anexoPath: nota.danfePath } });
    return { ok: enviado, para };
  });

  // Serviço: consulta notas em PROCESSANDO (lotes assíncronos) a cada 2 min
  registrarServico('fiscal-processando', (app) => {
    setInterval(async () => {
      try {
        const pendentes = await prisma.notaFiscal.findMany({ where: { situacao: 'PROCESSANDO', chave: { not: null } }, take: 10 });
        for (const n of pendentes) {
          await fiscal.consultar(n.id).catch((e) => app.log.warn({ e }, `consulta NF ${n.id} falhou`));
        }
      } catch (e) {
        app.log.warn({ e }, 'fiscal-processando');
      }
    }, 2 * 60 * 1000).unref();
  });
}
