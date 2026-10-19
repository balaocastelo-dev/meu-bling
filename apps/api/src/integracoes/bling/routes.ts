/**
 * Rotas de migração do Bling: OAuth2 (auth-url/callback), status, importação em background e CSV.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { auditar } from '../../lib/auditoria.js';
import { randomToken } from '../../lib/crypto.js';
import { blingStatus, trocarCodigo, urlAutorizacao, urlCallback, desconectarBling, blingGet, renovarToken } from './cliente.js';
import { ENTIDADES, estadoImportacao, iniciarImportacao, importarCsv, type EntidadeBling } from './importador.js';

const states = new Map<string, number>(); // state OAuth → timestamp

export default async function blingRoutes(app: FastifyInstance) {
  const cfg = app.exigirPerfil('ADMIN', 'GERENTE');

  const exigirToken = async () => {
    const st = await blingStatus();
    if (!st.conectado) throw new AppError('Conecte o Bling em Configurações', 422, 'BLING_DESCONECTADO');
  };

  app.get('/api/v1/bling/status', { preHandler: cfg }, async () => {
    const st = await blingStatus();
    const ultima = await prisma.configuracao.findUnique({ where: { chave: 'bling.ultimaImportacao' } });
    return { conectado: st.conectado, configurado: st.configurado, expira: st.expira, ultimaImportacao: ultima?.valor || null, callbackUrl: urlCallback(), importacao: { emAndamento: estadoImportacao().emAndamento } };
  });

  /** URL de autorização OAuth. Cadastre no app Bling o redirect: APP_URL/configuracoes/bling/callback */
  app.get('/api/v1/bling/auth-url', { preHandler: cfg }, async () => {
    const e = await prisma.empresa.findUnique({ where: { id: 1 }, select: { blingClientId: true, blingClientSecret: true } });
    if (!e?.blingClientId || !e?.blingClientSecret) throw new AppError('Informe o Client ID e o Client Secret do aplicativo Bling em Configurações.', 422, 'BLING_NAO_CONFIGURADO');
    const state = randomToken(16);
    states.set(state, Date.now());
    for (const [k, t] of states) if (Date.now() - t > 15 * 60 * 1000) states.delete(k);
    return { url: urlAutorizacao(e.blingClientId, state), state, callbackUrl: urlCallback() };
  });

  app.post('/api/v1/bling/callback', { preHandler: cfg }, async (req) => {
    const b = z.object({ code: z.string().min(1), state: z.string().optional() }).parse(req.body);
    if (b.state && !states.has(b.state)) throw new AppError('State inválido ou expirado. Gere a URL de autorização novamente.', 422, 'BLING_STATE');
    if (b.state) states.delete(b.state);
    await trocarCodigo(b.code);
    await auditar(req, 'Empresa', 1, 'ACAO', { acao: 'bling.conectar' });
    const st = await blingStatus();
    return { conectado: st.conectado, expira: st.expira };
  });

  app.post('/api/v1/bling/renovar-token', { preHandler: cfg }, async () => {
    await renovarToken();
    return blingStatus();
  });

  app.delete('/api/v1/bling/desconectar', { preHandler: cfg }, async (req) => {
    await desconectarBling();
    await auditar(req, 'Empresa', 1, 'ACAO', { acao: 'bling.desconectar' });
    return { ok: true };
  });

  /** Testa a conexão listando 1 contato. */
  app.get('/api/v1/bling/testar', { preHandler: cfg }, async () => {
    await exigirToken();
    const r = await blingGet<{ data: any[] }>('/contatos', { limite: 1 });
    return { ok: true, exemplo: r.data?.[0]?.nome || null };
  });

  app.post('/api/v1/bling/importar', { preHandler: cfg }, async (req, reply) => {
    await exigirToken();
    const b = z
      .object({
        entidades: z.array(z.enum(ENTIDADES as [EntidadeBling, ...EntidadeBling[]])).min(1),
        dataInicial: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        dataFinal: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        detalhesProdutos: z.boolean().optional(),
        /** vendas "Em aberto/Em andamento/Verificado" do Bling entram como fechadas ("Fechada") */
        fecharEmAberto: z.boolean().optional(),
        /** vendas fechadas têm o valor lançado como recebido no Caixa na data da venda */
        baixarNoCaixa: z.boolean().optional(),
      })
      .parse(req.body);
    if (estadoImportacao().emAndamento) throw new AppError('Já existe uma importação em andamento.', 409, 'IMPORTACAO_EM_ANDAMENTO');
    const opcoes = { detalhesProdutos: b.detalhesProdutos, dataFinal: b.dataFinal, fecharEmAberto: b.fecharEmAberto, baixarNoCaixa: b.baixarNoCaixa };
    const r = await iniciarImportacao(b.entidades, b.dataInicial, opcoes);
    await auditar(req, 'Empresa', 1, 'ACAO', { acao: 'bling.importar', entidades: b.entidades, dataInicial: b.dataInicial, ...opcoes });
    return reply.code(202).send({ emAndamento: r.emAndamento, entidades: r.entidades, arquivoLog: r.arquivoLog });
  });

  app.get('/api/v1/bling/importar/status', { preHandler: cfg }, async () => estadoImportacao());

  /** Importa CSV exportado do Bling (contatos ou produtos). */
  app.post('/api/v1/bling/importar-csv', { preHandler: cfg }, async (req) => {
    let entidade: 'contatos' | 'produtos' | null = null;
    let conteudo: string | null = null;
    let nomeArquivo = '';
    if (req.isMultipart()) {
      for await (const part of req.parts()) {
        if (part.type === 'file') {
          nomeArquivo = part.filename;
          const buf = await part.toBuffer();
          const utf8 = buf.toString('utf8');
          conteudo = /�/.test(utf8) ? buf.toString('latin1') : utf8;
        } else if (part.fieldname === 'entidade') entidade = String((part as any).value) as any;
      }
    } else {
      const b = z.object({ entidade: z.enum(['contatos', 'produtos']), conteudo: z.string().min(5) }).parse(req.body);
      entidade = b.entidade;
      conteudo = b.conteudo;
    }
    if (!entidade || !['contatos', 'produtos'].includes(entidade)) throw new AppError('Informe a entidade: contatos ou produtos.', 400, 'VALIDACAO');
    if (!conteudo) throw new AppError('Envie o arquivo CSV.', 400, 'VALIDACAO');
    let r;
    try {
      r = await importarCsv(entidade, conteudo);
    } catch (e: any) {
      throw new AppError(e?.message || 'Falha ao importar CSV', 422, 'CSV_INVALIDO');
    }
    await auditar(req, 'Empresa', 1, 'ACAO', { acao: 'bling.importar-csv', entidade, arquivo: nomeArquivo, ...r, detalhes: undefined });
    return { entidade, arquivo: nomeArquivo, ...r };
  });
}
