/**
 * DOCUMENTOS DA VENDA
 *   GET /api/v1/vendas/:id/documentos?formato=cupom|a4|garantia   HTML pronto para imprimir / salvar PDF
 *   GET /api/v1/vendas/:id/documentos/resumo                      o que a venda tem (certificados, licenças, NF)
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { carregarContexto } from './dados.js';
import { htmlDocumento } from './render.js';

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
      certificados: c.certificados.map((i) => ({ descricao: i.descricao, tipo: i.tipo, seminovo: i.seminovo, garantia: i.garantia.texto, validaAte: i.garantia.validaAte, quantidade: i.quantidade })),
      temGarantia: c.temGarantia,
      /** kit de garantia (certificados + termo + licenças): só quando tem aparelho com certificado */
      temKit: c.certificados.length > 0,
      temLicenca: c.temLicenca,
      nota: c.venda.nota ? { id: c.venda.nota.id, numero: c.venda.nota.numero, situacao: c.venda.nota.situacao } : null,
    };
  });
}
