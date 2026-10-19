/**
 * NOTIFICAÇÕES — montagem de variáveis, renderização de templates, regras de disparo
 * (listeners de eventos), fila/worker de envio e lembretes de contas a vencer.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { addDays, addMinutes, endOfDay, startOfDay, format } from 'date-fns';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../lib/env.js';
import { AppError, NotFound } from '../../lib/errors.js';
import { renderTemplate, formatarMoeda, formatarData } from '../../lib/util.js';
import { eventos } from '../../core/eventos.js';
import { registrarServico } from '../../core/servicos.js';
import { enviarEmail, smtpConfigurado } from '../../integracoes/email/servico.js';
import { enviarTexto, status as statusWhatsApp } from '../../integracoes/whatsapp/servico.js';

export type OrigemTipo = 'VENDA' | 'COMPRA' | 'OS' | 'NFE' | 'CONTA' | 'MANUAL';
export type Canal = 'EMAIL' | 'WHATSAPP';

export const EVENTOS_TEMPLATE = ['VENDA_SITUACAO', 'COMPRA_SITUACAO', 'OS_SITUACAO', 'VENDA_CRIADA', 'OS_CRIADA', 'NFE_AUTORIZADA', 'CONTA_VENCENDO', 'ORCAMENTO_OS'] as const;

/** Variáveis disponíveis por evento (documentação para a UI). */
export const VARIAVEIS_POR_EVENTO: Record<string, { nome: string; descricao: string }[]> = (() => {
  const comuns = [
    { nome: 'cliente.nome', descricao: 'Nome completo do cliente/fornecedor' },
    { nome: 'cliente.primeiroNome', descricao: 'Primeiro nome' },
    { nome: 'cliente.celular', descricao: 'Celular (WhatsApp)' },
    { nome: 'cliente.email', descricao: 'E-mail' },
    { nome: 'empresa.nome', descricao: 'Nome da empresa' },
    { nome: 'empresa.telefone', descricao: 'Telefone da empresa' },
    { nome: 'empresa.endereco', descricao: 'Endereço da empresa' },
    { nome: 'empresa.email', descricao: 'E-mail da empresa' },
    { nome: 'empresa.site', descricao: 'Site da empresa' },
    { nome: 'data', descricao: 'Data (dd/mm/aaaa)' },
    { nome: 'hora', descricao: 'Hora atual (hh:mm)' },
  ];
  const documento = [
    { nome: 'numero', descricao: 'Número do documento' },
    { nome: 'situacao', descricao: 'Situação atual' },
    { nome: 'total', descricao: 'Total formatado (R$)' },
    { nome: 'itens', descricao: 'Lista de itens (qtd x descrição — R$ total)' },
    { nome: 'vendedor', descricao: 'Nome do vendedor' },
    { nome: 'link', descricao: 'Link público de acompanhamento' },
    { nome: 'observacoes', descricao: 'Observações do documento' },
  ];
  const os = [
    { nome: 'equipamento', descricao: 'Equipamento (tipo marca modelo)' },
    { nome: 'marca', descricao: 'Marca' },
    { nome: 'modelo', descricao: 'Modelo' },
    { nome: 'numeroSerie', descricao: 'Número de série' },
    { nome: 'defeito', descricao: 'Defeito relatado' },
    { nome: 'diagnostico', descricao: 'Diagnóstico técnico' },
    { nome: 'servicoExecutado', descricao: 'Serviço executado' },
    { nome: 'tecnico', descricao: 'Nome do técnico' },
    { nome: 'garantiaDias', descricao: 'Garantia (dias)' },
    { nome: 'dataPrevista', descricao: 'Previsão de entrega' },
    { nome: 'totalServicos', descricao: 'Total de serviços (R$)' },
    { nome: 'totalPecas', descricao: 'Total de peças (R$)' },
  ];
  const nfe = [
    { nome: 'numero', descricao: 'Número da NF-e' },
    { nome: 'serie', descricao: 'Série' },
    { nome: 'chave', descricao: 'Chave de acesso (44 dígitos)' },
    { nome: 'total', descricao: 'Valor total (R$)' },
    { nome: 'protocolo', descricao: 'Protocolo de autorização' },
    { nome: 'dataEmissao', descricao: 'Data de emissão' },
  ];
  const conta = [
    { nome: 'descricao', descricao: 'Descrição da conta' },
    { nome: 'total', descricao: 'Valor em aberto (R$)' },
    { nome: 'vencimento', descricao: 'Data de vencimento' },
    { nome: 'diasParaVencer', descricao: 'Dias até o vencimento (0 = hoje)' },
    { nome: 'numero', descricao: 'Número do documento de origem' },
  ];
  return {
    VENDA_SITUACAO: [...comuns, ...documento],
    VENDA_CRIADA: [...comuns, ...documento],
    COMPRA_SITUACAO: [...comuns, ...documento],
    OS_SITUACAO: [...comuns, ...documento, ...os],
    OS_CRIADA: [...comuns, ...documento, ...os],
    ORCAMENTO_OS: [...comuns, ...documento, ...os],
    NFE_AUTORIZADA: [...comuns, ...nfe, { nome: 'link', descricao: 'Link do pedido/OS de origem' }],
    CONTA_VENCENDO: [...comuns, ...conta],
  };
})();

/** Token público (mesmo cálculo do módulo publico): primeiros 24 chars de sha256(`${id}:${APP_SECRET}`). */
export function tokenPublico(id: number): string {
  return crypto.createHash('sha256').update(`${id}:${env.APP_SECRET}`).digest('hex').slice(0, 24);
}

function primeiroNome(nome?: string | null) {
  return (nome || '').trim().split(/\s+/)[0] || '';
}

function enderecoEmpresa(e: { logradouro?: string | null; numero?: string | null; complemento?: string | null; bairro?: string | null; municipio?: string | null; uf?: string | null }) {
  const l1 = [e.logradouro, e.numero].filter(Boolean).join(', ');
  const l2 = [e.complemento, e.bairro].filter(Boolean).join(' - ');
  const l3 = [e.municipio, e.uf].filter(Boolean).join('/');
  return [l1, l2, l3].filter(Boolean).join(' — ');
}

async function variaveisEmpresa() {
  const e = await prisma.empresa.findUnique({ where: { id: 1 } });
  if (!e) throw new AppError('Empresa não configurada.', 500);
  return {
    nome: e.nomeFantasia || e.razaoSocial,
    razaoSocial: e.razaoSocial,
    telefone: e.telefone || '',
    endereco: enderecoEmpresa(e),
    email: e.email || '',
    site: e.site || '',
    cnpj: e.cnpj,
  };
}

function formatarItens(itens: { quantidade: number; descricao: string; total: number }[], canal: Canal): string {
  const linhas = itens.map((i) => `${Number.isInteger(i.quantidade) ? i.quantidade : i.quantidade.toFixed(2)} x ${i.descricao} — ${formatarMoeda(i.total)}`);
  return canal === 'EMAIL' ? linhas.join('<br>') : linhas.join('\n');
}

export interface VariaveisMontadas {
  vars: Record<string, any>;
  contato: { id: number; nome: string; email: string | null; celular: string | null } | null;
  /** itens brutos (para formatar por canal) */
  itens: { quantidade: number; descricao: string; total: number }[];
  anexos?: { filename: string; path: string; contentType?: string }[];
}

/**
 * Carrega a entidade de origem e monta o dicionário de variáveis do template.
 * `{{itens}}` é formatado depois por canal (quebra de linha vs <br>).
 */
export async function montarVariaveis(origemTipo: OrigemTipo, origemId: number): Promise<VariaveisMontadas> {
  const empresa = await variaveisEmpresa();
  const agora = new Date();
  const base = { empresa, data: formatarData(agora), hora: format(agora, 'HH:mm') };
  const contatoVars = (c: { nome: string; email?: string | null; celular?: string | null; telefone?: string | null } | null | undefined) => ({
    nome: c?.nome || '',
    primeiroNome: primeiroNome(c?.nome),
    email: c?.email || '',
    celular: c?.celular || c?.telefone || '',
  });

  if (origemTipo === 'VENDA') {
    const v = await prisma.venda.findUnique({
      where: { id: origemId },
      include: { contato: true, vendedor: true, situacao: true, itens: { orderBy: { ordem: 'asc' } }, parcelas: { include: { formaPagamento: true } } },
    });
    if (!v) throw new NotFound('Venda');
    const itens = v.itens.map((i) => ({ quantidade: i.quantidade, descricao: i.descricao, total: i.total }));
    return {
      contato: { id: v.contato.id, nome: v.contato.nome, email: v.contato.email, celular: v.contato.celular },
      itens,
      vars: {
        ...base,
        cliente: contatoVars(v.contato),
        numero: v.numero,
        situacao: v.situacao.nome,
        total: formatarMoeda(v.total),
        totalProdutos: formatarMoeda(v.totalProdutos),
        desconto: formatarMoeda(v.descontoValor),
        frete: formatarMoeda(v.frete),
        data: formatarData(v.data),
        dataPrevista: formatarData(v.dataPrevista),
        vendedor: v.vendedor?.nome || '',
        observacoes: v.observacoes || '',
        formaPagamento: v.parcelas[0]?.formaPagamento?.nome || '',
        parcelas: v.parcelas.length,
        link: `${env.APP_URL.replace(/\/$/, '')}/p/venda/${tokenPublico(v.id)}`,
      },
    };
  }

  if (origemTipo === 'COMPRA') {
    const c = await prisma.compra.findUnique({ where: { id: origemId }, include: { fornecedor: true, situacao: true, itens: { orderBy: { ordem: 'asc' } } } });
    if (!c) throw new NotFound('Compra');
    const itens = c.itens.map((i) => ({ quantidade: i.quantidade, descricao: i.descricao, total: i.total }));
    return {
      contato: { id: c.fornecedor.id, nome: c.fornecedor.nome, email: c.fornecedor.email, celular: c.fornecedor.celular },
      itens,
      vars: {
        ...base,
        cliente: contatoVars(c.fornecedor),
        fornecedor: contatoVars(c.fornecedor),
        numero: c.numero,
        situacao: c.situacao.nome,
        total: formatarMoeda(c.total),
        data: formatarData(c.data),
        dataPrevista: formatarData(c.dataPrevista),
        ordemCompra: c.ordemCompra || '',
        observacoes: c.observacoes || '',
        vendedor: '',
        link: '',
      },
    };
  }

  if (origemTipo === 'OS') {
    const o = await prisma.ordemServico.findUnique({
      where: { id: origemId },
      include: { contato: true, vendedor: true, tecnico: true, situacao: true, itens: { orderBy: { ordem: 'asc' } } },
    });
    if (!o) throw new NotFound('Ordem de serviço');
    const itens = o.itens.map((i) => ({ quantidade: i.quantidade, descricao: i.descricao, total: i.total }));
    return {
      contato: { id: o.contato.id, nome: o.contato.nome, email: o.contato.email, celular: o.contato.celular },
      itens,
      vars: {
        ...base,
        cliente: contatoVars(o.contato),
        numero: o.numero,
        situacao: o.situacao.nome,
        total: formatarMoeda(o.total),
        totalServicos: formatarMoeda(o.totalServicos),
        totalPecas: formatarMoeda(o.totalPecas),
        desconto: formatarMoeda(o.descontoValor),
        data: formatarData(o.dataEntrada),
        dataEntrada: formatarData(o.dataEntrada),
        dataPrevista: formatarData(o.dataPrevista),
        dataConclusao: formatarData(o.dataConclusao),
        equipamento: [o.equipamento, o.marca, o.modelo].filter(Boolean).join(' '),
        marca: o.marca || '',
        modelo: o.modelo || '',
        numeroSerie: o.numeroSerie || '',
        defeito: o.defeitoRelatado || '',
        diagnostico: o.diagnostico || '',
        servicoExecutado: o.servicoExecutado || '',
        tecnico: o.tecnico?.nome || '',
        vendedor: o.vendedor?.nome || '',
        garantiaDias: o.garantiaDias,
        prioridade: o.prioridade,
        observacoes: o.observacoes || '',
        orcamentoAprovado: o.orcamentoAprovado ? 'Sim' : 'Não',
        link: `${env.APP_URL.replace(/\/$/, '')}/p/os/${tokenPublico(o.id)}`,
      },
    };
  }

  if (origemTipo === 'NFE') {
    const n = await prisma.notaFiscal.findUnique({ where: { id: origemId }, include: { contato: true, venda: { select: { id: true, numero: true } }, os: { select: { id: true, numero: true } }, itens: true } });
    if (!n) throw new NotFound('Nota fiscal');
    const anexos: { filename: string; path: string; contentType?: string }[] = [];
    if (n.chave) {
      const xml = path.join(env.STORAGE_DIR, 'nfe', `${n.chave}.xml`);
      const pdf = path.join(env.STORAGE_DIR, 'danfe', `${n.chave}.pdf`);
      if (fs.existsSync(xml)) anexos.push({ filename: `NFe-${n.chave}.xml`, path: xml, contentType: 'application/xml' });
      if (fs.existsSync(pdf)) anexos.push({ filename: `DANFE-${n.numero}.pdf`, path: pdf, contentType: 'application/pdf' });
      else if (n.danfePath && fs.existsSync(n.danfePath)) anexos.push({ filename: `DANFE-${n.numero}.pdf`, path: n.danfePath, contentType: 'application/pdf' });
    }
    const link = n.venda ? `${env.APP_URL.replace(/\/$/, '')}/p/venda/${tokenPublico(n.venda.id)}` : n.os ? `${env.APP_URL.replace(/\/$/, '')}/p/os/${tokenPublico(n.os.id)}` : '';
    return {
      contato: n.contato ? { id: n.contato.id, nome: n.contato.nome, email: n.contato.email, celular: n.contato.celular } : null,
      itens: n.itens.map((i) => ({ quantidade: i.quantidade, descricao: i.descricao, total: i.valorTotal })),
      anexos,
      vars: {
        ...base,
        cliente: contatoVars(n.contato),
        numero: n.numero,
        serie: n.serie,
        modelo: n.modelo,
        chave: n.chave || '',
        protocolo: n.protocolo || '',
        situacao: n.situacao,
        total: formatarMoeda(n.valorTotal),
        dataEmissao: formatarData(n.dataEmissao),
        data: formatarData(n.dataEmissao),
        pedido: n.venda?.numero || n.os?.numero || '',
        link,
      },
    };
  }

  if (origemTipo === 'CONTA') {
    const c = await prisma.contaReceber.findUnique({ where: { id: origemId }, include: { contato: true } });
    if (!c) throw new NotFound('Conta a receber');
    const hoje = startOfDay(new Date());
    const dias = Math.round((startOfDay(c.vencimento).getTime() - hoje.getTime()) / 86400000);
    let numero: number | string = '';
    if (c.origemTipo === 'VENDA' && c.origemId) numero = (await prisma.venda.findUnique({ where: { id: c.origemId }, select: { numero: true } }))?.numero ?? '';
    if (c.origemTipo === 'OS' && c.origemId) numero = (await prisma.ordemServico.findUnique({ where: { id: c.origemId }, select: { numero: true } }))?.numero ?? '';
    return {
      contato: c.contato ? { id: c.contato.id, nome: c.contato.nome, email: c.contato.email, celular: c.contato.celular } : null,
      itens: [],
      vars: {
        ...base,
        cliente: contatoVars(c.contato),
        descricao: c.descricao,
        numero,
        parcela: c.parcela || '',
        total: formatarMoeda(Math.max(0, c.valor - c.valorRecebido - c.desconto)),
        valor: formatarMoeda(c.valor),
        vencimento: formatarData(c.vencimento),
        diasParaVencer: dias,
        situacao: c.situacao,
        link: '',
      },
    };
  }

  return { contato: null, itens: [], vars: { ...base, cliente: contatoVars(null), link: '' } };
}

/** Renderiza assunto/corpo de um template para uma origem. */
export async function renderizarTemplate(templateId: number, origemTipo: OrigemTipo, origemId: number) {
  const t = await prisma.templateNotificacao.findUnique({ where: { id: templateId } });
  if (!t) throw new NotFound('Template');
  const m = await montarVariaveis(origemTipo, origemId);
  const vars = { ...m.vars, itens: formatarItens(m.itens, t.canal as Canal) };
  return {
    assunto: t.assunto ? renderTemplate(t.assunto, vars) : null,
    corpo: renderTemplate(t.corpo, vars),
    destinatario: t.canal === 'EMAIL' ? m.contato?.email || null : m.contato?.celular || null,
    contatoId: m.contato?.id ?? null,
    anexos: t.anexarPdf ? m.anexos || [] : [],
    template: { id: t.id, nome: t.nome, canal: t.canal, evento: t.evento },
  };
}

/** Renderiza um texto livre (mensagem manual) com as variáveis da origem. */
export async function renderizarTexto(texto: string, canal: Canal, origemTipo: OrigemTipo, origemId: number) {
  const m = await montarVariaveis(origemTipo, origemId);
  return { texto: renderTemplate(texto, { ...m.vars, itens: formatarItens(m.itens, canal) }), contato: m.contato };
}

// ---------------------------------------------------------------------
// Criação de notificações (fila)
// ---------------------------------------------------------------------
export async function enfileirar(p: {
  canal: Canal;
  destinatario?: string | null;
  assunto?: string | null;
  corpo: string;
  contatoId?: number | null;
  origemTipo?: OrigemTipo | null;
  origemId?: number | null;
  anexoPath?: string | null;
  agendadaPara?: Date | null;
}) {
  const dest = (p.destinatario || '').trim();
  const valido = p.canal === 'EMAIL' ? /\S+@\S+\.\S+/.test(dest) : dest.replace(/\D/g, '').length >= 10;
  return prisma.notificacao.create({
    data: {
      canal: p.canal,
      destinatario: dest,
      assunto: p.assunto ?? null,
      corpo: p.corpo,
      contatoId: p.contatoId ?? null,
      origemTipo: p.origemTipo ?? 'MANUAL',
      origemId: p.origemId ?? null,
      anexoPath: p.anexoPath ?? null,
      agendadaPara: p.agendadaPara ?? new Date(),
      status: valido ? 'PENDENTE' : 'CANCELADA',
      erro: valido ? null : p.canal === 'EMAIL' ? 'Contato sem e-mail' : 'Contato sem celular',
    },
  });
}

/** Cria notificação(ões) a partir dos templates de um evento para uma origem. */
export async function dispararTemplates(
  evento: string,
  origemTipo: OrigemTipo,
  origemId: number,
  filtro: { situacaoId?: number | null; incluirGenericos?: boolean; canal?: Canal } = {},
) {
  const templates = await prisma.templateNotificacao.findMany({ where: { evento, ativo: true, ...(filtro.canal ? { canal: filtro.canal } : {}) } });
  const selecionados = templates.filter((t) => {
    if (filtro.situacaoId === undefined) return true; // eventos sem situação (criada, nfe, orçamento)
    if (t.situacaoId === filtro.situacaoId) return true;
    return t.situacaoId === null && !!filtro.incluirGenericos;
  });
  if (!selecionados.length) return [];
  // evita duplicar: se há template específico para a situação em um canal, não dispara o genérico do mesmo canal
  const porCanal = new Map<string, typeof selecionados>();
  for (const t of selecionados) {
    const lista = porCanal.get(t.canal) || [];
    lista.push(t);
    porCanal.set(t.canal, lista);
  }
  const finais: typeof selecionados = [];
  for (const lista of porCanal.values()) {
    const especificos = lista.filter((t) => t.situacaoId !== null);
    finais.push(...(especificos.length ? especificos : lista));
  }

  const m = await montarVariaveis(origemTipo, origemId);
  const criadas = [];
  for (const t of finais) {
    const vars = { ...m.vars, itens: formatarItens(m.itens, t.canal as Canal) };
    const anexo = t.anexarPdf ? (m.anexos || []).find((a) => a.filename.endsWith('.pdf'))?.path || null : null;
    const n = await enfileirar({
      canal: t.canal as Canal,
      destinatario: t.canal === 'EMAIL' ? m.contato?.email : m.contato?.celular,
      assunto: t.assunto ? renderTemplate(t.assunto, vars) : null,
      corpo: renderTemplate(t.corpo, vars),
      contatoId: m.contato?.id ?? null,
      origemTipo,
      origemId,
      anexoPath: anexo,
    });
    criadas.push(n);
  }
  return criadas;
}

// ---------------------------------------------------------------------
// Listeners dos eventos do sistema
// ---------------------------------------------------------------------
let listenersRegistrados = false;
export function registrarListeners() {
  if (listenersRegistrados) return;
  listenersRegistrados = true;

  eventos.ouvir('situacao.alterada', async (d) => {
    const evento = `${d.modulo}_SITUACAO`;
    await dispararTemplates(evento, d.modulo, d.entidadeId, { situacaoId: d.paraSituacaoId, incluirGenericos: d.notificarCliente });
  });
  eventos.ouvir('venda.criada', async (d) => {
    await dispararTemplates('VENDA_CRIADA', 'VENDA', d.vendaId);
  });
  eventos.ouvir('os.criada', async (d) => {
    await dispararTemplates('OS_CRIADA', 'OS', d.osId);
  });
  eventos.ouvir('os.orcamento', async (d) => {
    await dispararTemplates('ORCAMENTO_OS', 'OS', d.osId);
  });
  eventos.ouvir('nfe.autorizada', async (d) => {
    // e-mail com XML + DANFE anexos (os anexos são montados em montarVariaveis/NFE)
    const nota = await prisma.notaFiscal.findUnique({ where: { id: d.notaId }, select: { contatoId: true, chave: true, numero: true } });
    if (!nota) return;
    const criadas = await dispararTemplates('NFE_AUTORIZADA', 'NFE', d.notaId);
    // garante os dois anexos no e-mail (anexoPath guarda só o PDF; o XML é anexado no envio)
    void criadas;
  });
}

// ---------------------------------------------------------------------
// Worker da fila
// ---------------------------------------------------------------------
let processando = false;
export async function processarFila(limite = 10) {
  if (processando) return { processadas: 0 };
  processando = true;
  let processadas = 0;
  try {
    const pendentes = await prisma.notificacao.findMany({
      where: { status: 'PENDENTE', agendadaPara: { lte: new Date() } },
      orderBy: { agendadaPara: 'asc' },
      take: limite,
    });
    for (const n of pendentes) {
      processadas += 1;
      try {
        if (n.canal === 'WHATSAPP') {
          if (statusWhatsApp().status !== 'CONECTADO') {
            // não conta tentativa: fica pendente até conectar
            await prisma.notificacao.update({ where: { id: n.id }, data: { erro: 'WhatsApp desconectado' } });
            continue;
          }
          await prisma.notificacao.update({ where: { id: n.id }, data: { status: 'ENVIANDO' } });
          const r = await enviarTexto(n.destinatario, n.corpo);
          await prisma.notificacao.update({ where: { id: n.id }, data: { status: 'ENVIADA', enviadaEm: new Date(), erro: null, externalId: r.id } });
        } else {
          if (!(await smtpConfigurado())) {
            await prisma.notificacao.update({ where: { id: n.id }, data: { erro: 'SMTP não configurado' } });
            continue;
          }
          await prisma.notificacao.update({ where: { id: n.id }, data: { status: 'ENVIANDO' } });
          const anexos = await anexosDaNotificacao(n);
          const r = await enviarEmail({ para: n.destinatario, assunto: n.assunto || 'Mensagem', html: n.corpo, anexos });
          await prisma.notificacao.update({ where: { id: n.id }, data: { status: 'ENVIADA', enviadaEm: new Date(), erro: null, externalId: r.messageId } });
        }
      } catch (e: any) {
        const tentativas = n.tentativas + 1;
        const erro = String(e?.message || e).slice(0, 500);
        await prisma.notificacao.update({
          where: { id: n.id },
          data: tentativas >= 3 ? { status: 'ERRO', tentativas, erro } : { status: 'PENDENTE', tentativas, erro, agendadaPara: addMinutes(new Date(), 2 * tentativas) },
        });
      }
    }
  } finally {
    processando = false;
  }
  return { processadas };
}

async function anexosDaNotificacao(n: { anexoPath: string | null; origemTipo: string | null; origemId: number | null }) {
  const anexos: { filename: string; path: string; contentType?: string }[] = [];
  if (n.anexoPath && fs.existsSync(n.anexoPath)) anexos.push({ filename: path.basename(n.anexoPath), path: n.anexoPath });
  if (n.origemTipo === 'NFE' && n.origemId) {
    try {
      const m = await montarVariaveis('NFE', n.origemId);
      for (const a of m.anexos || []) if (!anexos.some((x) => x.path === a.path)) anexos.push(a);
    } catch {
      /* nota pode ter sido excluída */
    }
  }
  return anexos;
}

/** Processa imediatamente uma notificação específica (reenviar). */
export async function enviarAgora(id: number) {
  const n = await prisma.notificacao.findUnique({ where: { id } });
  if (!n) throw new NotFound('Notificação');
  await prisma.notificacao.update({ where: { id }, data: { status: 'PENDENTE', tentativas: 0, erro: null, agendadaPara: new Date() } });
  await processarFila(50);
  return prisma.notificacao.findUnique({ where: { id } });
}

// ---------------------------------------------------------------------
// Lembrete de contas a receber vencendo hoje/amanhã (WhatsApp)
// ---------------------------------------------------------------------
let ultimoLembrete: string | null = null;
export async function gerarLembretesContas(forcar = false) {
  const hojeStr = format(new Date(), 'yyyy-MM-dd');
  if (!forcar && ultimoLembrete === hojeStr) return { criadas: 0, jaRodou: true };
  const templates = await prisma.templateNotificacao.findMany({ where: { evento: 'CONTA_VENCENDO', ativo: true } });
  ultimoLembrete = hojeStr;
  if (!templates.length) return { criadas: 0, semTemplate: true };
  const ini = startOfDay(new Date());
  const fim = endOfDay(addDays(new Date(), 1));
  const contas = await prisma.contaReceber.findMany({
    where: { situacao: { in: ['ABERTO', 'PARCIAL'] }, vencimento: { gte: ini, lte: fim }, contatoId: { not: null } },
    include: { contato: { select: { id: true, nome: true, celular: true, email: true } } },
  });
  let criadas = 0;
  for (const c of contas) {
    // evita repetir lembrete do mesmo dia
    const jaEnviada = await prisma.notificacao.findFirst({ where: { origemTipo: 'CONTA', origemId: c.id, criadoEm: { gte: ini } } });
    if (jaEnviada) continue;
    const m = await montarVariaveis('CONTA', c.id);
    for (const t of templates) {
      const vars = { ...m.vars, itens: '' };
      const dest = t.canal === 'EMAIL' ? c.contato?.email : c.contato?.celular;
      if (!dest) continue;
      await enfileirar({ canal: t.canal as Canal, destinatario: dest, assunto: t.assunto ? renderTemplate(t.assunto, vars) : null, corpo: renderTemplate(t.corpo, vars), contatoId: c.contatoId, origemTipo: 'CONTA', origemId: c.id });
      criadas += 1;
    }
  }
  return { criadas };
}

// ---------------------------------------------------------------------
// Serviços de fundo
// ---------------------------------------------------------------------
registrarServico('fila-notificacoes', (app) => {
  registrarListeners();
  const timer = setInterval(() => {
    processarFila(10).catch((e) => app.log.warn({ e }, '[notificacoes] falha ao processar fila'));
  }, 5000);
  timer.unref();
});

registrarServico('lembrete-contas', (app) => {
  const rodar = () => gerarLembretesContas().then((r) => r.criadas && app.log.info(r, '[lembrete-contas] notificações criadas')).catch((e) => app.log.warn({ e }, '[lembrete-contas] falha'));
  const timer = setInterval(rodar, 60 * 60 * 1000);
  timer.unref();
  setTimeout(rodar, 30000).unref();
});
