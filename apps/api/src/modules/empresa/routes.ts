/**
 * Empresa (dados do emitente, fiscal, SMTP, Open Finance, Bling) e configurações genéricas.
 * Segredos são gravados com encrypt() e nunca devolvidos.
 * NÃO contém /empresa/certificado nem /empresa/smtp/testar (módulos fiscal/notificações).
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { limparCacheCfgCustos } from '../comum/custos-venda.js';
import path from 'node:path';
import fs from 'node:fs/promises';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../lib/env.js';
import { AppError } from '../../lib/errors.js';
import { encrypt } from '../../lib/crypto.js';
import { auditar } from '../../lib/auditoria.js';
import { somenteDigitos } from '../../lib/util.js';

const SEGREDOS = ['cscToken', 'smtpPass', 'openFinanceClientSecret', 'blingClientSecret'] as const;

const texto = z.string().trim().nullable().optional();

const empresaSchema = z.object({
  razaoSocial: z.string().trim().min(2).optional(),
  nomeFantasia: texto,
  cnpj: z.string().trim().optional(),
  ie: texto,
  im: texto,
  crt: z.coerce.number().int().min(1).max(3).optional(),
  logradouro: texto,
  numero: texto,
  complemento: texto,
  bairro: texto,
  codigoMunicipio: texto,
  municipio: texto,
  uf: z.string().trim().length(2).toUpperCase().nullable().optional(),
  cep: texto,
  telefone: texto,
  email: z.string().trim().email().nullable().optional().or(z.literal('')),
  site: texto,
  // fiscal
  ambienteFiscal: z.coerce.number().int().min(1).max(2).optional(),
  serieNfe: z.coerce.number().int().min(1).optional(),
  proximoNumeroNfe: z.coerce.number().int().min(1).optional(),
  serieNfce: z.coerce.number().int().min(1).optional(),
  proximoNumeroNfce: z.coerce.number().int().min(1).optional(),
  cscId: texto,
  cscToken: texto,
  naturezaOperacaoPadrao: z.string().trim().min(1).optional(),
  cfopPadraoDentroUf: z.string().trim().length(4).optional(),
  cfopPadraoForaUf: z.string().trim().length(4).optional(),
  csosnPadrao: z.string().trim().min(3).max(4).optional(),
  aliquotaSimplesPct: z.coerce.number().min(0).max(100).optional(),
  taxaCartao1xPct: z.coerce.number().min(0).max(100).optional(),
  taxaCartao12xPct: z.coerce.number().min(0).max(100).optional(),
  freteVendaPadrao: z.coerce.number().min(0).optional(),
  custoProdutoMinPct: z.coerce.number().min(0).max(100).optional(),
  custoProdutoMaxPct: z.coerce.number().min(0).max(100).optional(),
  provedorFiscal: z.enum(['sefaz', 'mock']).optional(),
  // smtp
  smtpHost: texto,
  smtpPort: z.coerce.number().int().min(1).max(65535).nullable().optional(),
  smtpSecure: z.boolean().optional(),
  smtpUser: texto,
  smtpPass: texto,
  smtpFrom: texto,
  smtpAtivo: z.boolean().optional(),
  // whatsapp
  whatsappAtivo: z.boolean().optional(),
  // open finance
  openFinanceProvedor: texto,
  openFinanceClientId: texto,
  openFinanceClientSecret: texto,
  openFinanceAtivo: z.boolean().optional(),
  // bling
  blingClientId: texto,
  blingClientSecret: texto,
});

/** Monta a resposta pública da empresa (sem segredos). */
function serializarEmpresa(e: NonNullable<Awaited<ReturnType<typeof prisma.empresa.findUnique>>>) {
  const {
    cscToken,
    certificadoPfx,
    certificadoSenha,
    smtpPass,
    openFinanceClientSecret,
    blingClientSecret,
    blingAccessToken,
    blingRefreshToken,
    ...publicos
  } = e;
  return {
    ...publicos,
    temCscToken: !!cscToken,
    certificado: {
      nome: e.certificadoNome,
      validade: e.certificadoValidade,
      temCertificado: !!certificadoPfx,
      temSenha: !!certificadoSenha,
    },
    smtp: {
      host: e.smtpHost,
      port: e.smtpPort,
      secure: e.smtpSecure,
      user: e.smtpUser,
      from: e.smtpFrom,
      ativo: e.smtpAtivo,
      temSenha: !!smtpPass,
    },
    whatsapp: { ativo: e.whatsappAtivo },
    openFinance: {
      ativo: e.openFinanceAtivo,
      provedor: e.openFinanceProvedor,
      clientId: e.openFinanceClientId,
      temSecret: !!openFinanceClientSecret,
    },
    bling: {
      clientId: e.blingClientId,
      temSecret: !!blingClientSecret,
      temToken: !!blingAccessToken,
      expira: e.blingTokenExpira,
    },
  };
}

export default async function empresaRoutes(app: FastifyInstance) {
  app.get('/api/v1/empresa', async () => {
    const e = await prisma.empresa.findUnique({ where: { id: 1 } });
    if (!e) throw new AppError('Empresa não configurada. Rode o seed.', 500, 'EMPRESA');
    return serializarEmpresa(e);
  });

  app.put('/api/v1/empresa', { preHandler: app.exigirPerfil('ADMIN', 'GERENTE') }, async (req) => {
    const body = empresaSchema.parse(req.body);
    const data: Record<string, unknown> = { ...body };

    // segredos: ignora "***"/vazio; senão criptografa
    for (const campo of SEGREDOS) {
      const v = body[campo];
      if (v === undefined) continue;
      if (v === null || v === '' || /^[*•]+$/.test(v)) {
        delete data[campo];
      } else {
        data[campo] = encrypt(v);
      }
    }
    if (body.cnpj !== undefined) data.cnpj = somenteDigitos(body.cnpj);
    if (body.cep !== undefined && body.cep) data.cep = somenteDigitos(body.cep);
    if (body.email === '') data.email = null;

    const e = await prisma.empresa.update({ where: { id: 1 }, data });
    limparCacheCfgCustos();
    const alterados = Object.keys(data).filter((k) => !(SEGREDOS as readonly string[]).includes(k));
    await auditar(req, 'Empresa', 1, 'ALTERAR', { campos: alterados, segredos: Object.keys(data).filter((k) => (SEGREDOS as readonly string[]).includes(k)) });
    return serializarEmpresa(e);
  });

  // ---- Logo (multipart)
  app.post('/api/v1/empresa/logo', { preHandler: app.exigirPerfil('ADMIN', 'GERENTE') }, async (req) => {
    const arquivo = await req.file();
    if (!arquivo) throw new AppError('Envie o arquivo da logo (campo "arquivo").', 400, 'SEM_ARQUIVO');
    const ext = path.extname(arquivo.filename || '').toLowerCase() || '.png';
    if (!['.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif'].includes(ext)) {
      throw new AppError('Formato de imagem não suportado (use PNG, JPG, WEBP, SVG ou GIF).', 422, 'FORMATO');
    }
    const buf = await arquivo.toBuffer();
    if (!buf.length) throw new AppError('Arquivo vazio.', 422, 'ARQUIVO_VAZIO');
    const dir = path.join(env.STORAGE_DIR, 'logos');
    await fs.mkdir(dir, { recursive: true });
    const nome = `logo-${Date.now()}${ext}`;
    await fs.writeFile(path.join(dir, nome), buf);

    // remove logo anterior
    const atual = await prisma.empresa.findUnique({ where: { id: 1 }, select: { logoPath: true } });
    if (atual?.logoPath?.startsWith('/uploads/logos/')) {
      await fs.unlink(path.join(env.STORAGE_DIR, atual.logoPath.replace(/^\/uploads\//, ''))).catch(() => {});
    }
    const logoPath = `/uploads/logos/${nome}`;
    await prisma.empresa.update({ where: { id: 1 }, data: { logoPath } });
    await auditar(req, 'Empresa', 1, 'ALTERAR', { logoPath });
    return { logoPath };
  });

  // ---- Configurações genéricas chave/valor
  app.get('/api/v1/configuracoes', async () => {
    const lista = await prisma.configuracao.findMany({ orderBy: { chave: 'asc' } });
    const obj: Record<string, string> = {};
    for (const c of lista) obj[c.chave] = c.valor;
    return obj;
  });

  app.put('/api/v1/configuracoes', { preHandler: app.exigirPerfil('ADMIN', 'GERENTE') }, async (req) => {
    const body = z.record(z.string().min(1), z.union([z.string(), z.number(), z.boolean(), z.null()])).parse(req.body);
    await prisma.$transaction(async (tx) => {
      for (const [chave, valor] of Object.entries(body)) {
        if (valor === null) {
          await tx.configuracao.deleteMany({ where: { chave } });
        } else {
          const v = typeof valor === 'string' ? valor : JSON.stringify(valor);
          await tx.configuracao.upsert({ where: { chave }, create: { chave, valor: v }, update: { valor: v } });
        }
      }
    });
    await auditar(req, 'Configuracao', null, 'ALTERAR', { chaves: Object.keys(body) });
    const lista = await prisma.configuracao.findMany({ orderBy: { chave: 'asc' } });
    const obj: Record<string, string> = {};
    for (const c of lista) obj[c.chave] = c.valor;
    return obj;
  });
}
