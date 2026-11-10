/**
 * DOCUMENTOS DA VENDA
 *   GET /api/v1/vendas/:id/documentos?formato=cupom|a4|garantia   HTML pronto para imprimir / salvar PDF
 *   GET /api/v1/vendas/:id/documentos/resumo                      o que a venda tem (certificados, licenças, NF)
 *   PUT /api/v1/vendas/:id/documentos/garantia                    grava o prazo (3/6/12) confirmado pelo vendedor
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { carregarContexto } from './dados.js';
import { htmlDocumento } from './render.js';
import { prisma } from '../../lib/prisma.js';
import { auditar } from '../../lib/auditoria.js';

const idDe = (req: any) => {
  const id = Number(req.params?.id);
  if (!Number.isInteger(id) || id <= 0) throw new AppError('ID inválido.', 400, 'ID_INVALIDO');
  return id;
};

export default async function documentosRoutes(app: FastifyInstance) {
  app.get('/api/v1/vendas/:id/documentos', async (req, reply) => {
    const q = z.object({ formato: z.enum(['cupom', 'a4', 'garantia']).default('a4') }).parse(req.query);
    const c = await carregarContexto(idDe(req));
    return reply.type('text/html; charset=utf-8').send(htmlDocumento(c, q.formato));
  });

  app.get('/api/v1/vendas/:id/documentos/resumo', async (req) => {
    const c = await carregarContexto(idDe(req));
    return {
      certificados: c.certificados.map((i) => ({
        itemId: i.id,
        descricao: i.descricao,
        tipo: i.tipo,
        seminovo: i.seminovo,
        garantia: i.garantia.texto,
        /** prazo em meses que vai sair no certificado agora (escolhido ou automático) */
        garantiaMeses: i.garantia.meses,
        /** true = alguém já confirmou este prazo; false = ainda é o automático */
        garantiaEscolhida: !!i.garantia.escolhido,
        validaAte: i.garantia.validaAte,
        quantidade: i.quantidade,
      })),
      temGarantia: c.temGarantia,
      /** kit de garantia (certificados + termo + licenças): só quando tem aparelho com certificado */
      temKit: c.certificados.length > 0,
      temLicenca: c.temLicenca,
      nota: c.venda.nota ? { id: c.venda.nota.id, numero: c.venda.nota.numero, situacao: c.venda.nota.situacao } : null,
    };
  });

  /**
   * Prazo de garantia confirmado pelo vendedor antes de imprimir o certificado.
   * Vem como [{ itemId, meses }] — 3, 6 ou 12. É gravado no item da venda, então o
   * certificado, o recibo e a 2ª via saem sempre com o mesmo prazo que o cliente combinou.
   */
  app.put('/api/v1/vendas/:id/documentos/garantia', async (req) => {
    const vendaId = idDe(req);
    const body = z
      .object({
        itens: z
          .array(z.object({ itemId: z.coerce.number().int().positive(), meses: z.union([z.literal(3), z.literal(6), z.literal(12)]) }))
          .min(1)
          .max(50),
      })
      .parse(req.body);

    // só itens desta venda: o id do item vem da tela e não pode alcançar outra venda
    const daVenda = new Set((await prisma.vendaItem.findMany({ where: { vendaId }, select: { id: true } })).map((i) => i.id));
    const invalidos = body.itens.filter((i) => !daVenda.has(i.itemId));
    if (invalidos.length) throw new AppError('Item que não é desta venda.', 422, 'ITEM_DE_OUTRA_VENDA');

    await prisma.$transaction(body.itens.map((i) => prisma.vendaItem.update({ where: { id: i.itemId }, data: { garantiaMeses: i.meses } })));
    await auditar(req, 'Venda', vendaId, 'ACAO', { acao: 'garantia-confirmada', itens: body.itens });
    const c = await carregarContexto(vendaId);
    return { certificados: c.certificados.map((i) => ({ itemId: i.id, descricao: i.descricao, garantia: i.garantia.texto, validaAte: i.garantia.validaAte })) };
  });
}
