/**
 * ANALISTA (Claude) — o agente de IA de verdade do painel. Opcional: precisa de uma chave da API da
 * Anthropic (Painel → Agentes → Analista). Uma vez por dia (e quando o ADMIN pede) ele recebe um
 * resumo do que aconteceu nas últimas 24 h (quem fez o quê, por categoria), os achados abertos dos
 * agentes e os acontecimentos mais relevantes, e devolve em português: padrões, inconsistências,
 * coisas suspeitas e perguntas para investigar. Os pontos viram achados (agente "analista").
 *
 * Nenhum dado pessoal sensível vai para a IA: só nomes de funcionários, números de pedidos e valores.
 */
import { decrypt, encrypt } from '../../lib/crypto.js';
import { prisma } from '../../lib/prisma.js';
import { clienteSemTrilha } from './trilha.js';
import { lerConfig } from './agentes.js';

const CHAVE_API = 'auditoria.analista.chave';
const CHAVE_ULTIMO = 'auditoria.analista.ultimo';
const db = () => clienteSemTrilha();

export interface RelatorioAnalista {
  geradoEm: string;
  modelo: string;
  resumo: string;
  pontos: { nivel: 'alto' | 'medio' | 'baixo'; titulo: string; explicacao: string; usuario?: string | null }[];
  perguntas: string[];
  erro?: string | null;
}

export async function chaveConfigurada(): Promise<boolean> {
  if (process.env.ANTHROPIC_API_KEY) return true;
  const c = await db().configuracao.findUnique({ where: { chave: CHAVE_API } }).catch(() => null);
  return !!c?.valor;
}
async function chave(): Promise<string | null> {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  const c = await db().configuracao.findUnique({ where: { chave: CHAVE_API } }).catch(() => null);
  return c?.valor ? decrypt(c.valor) : null;
}
export async function gravarChave(valor: string | null) {
  if (!valor) {
    await prisma.configuracao.deleteMany({ where: { chave: CHAVE_API } });
    return;
  }
  const enc = encrypt(valor.trim())!;
  await prisma.configuracao.upsert({ where: { chave: CHAVE_API }, create: { chave: CHAVE_API, valor: enc }, update: { valor: enc } });
}
export async function ultimoRelatorio(): Promise<RelatorioAnalista | null> {
  const c = await db().configuracao.findUnique({ where: { chave: CHAVE_ULTIMO } }).catch(() => null);
  if (!c) return null;
  try {
    return JSON.parse(c.valor) as RelatorioAnalista;
  } catch {
    return null;
  }
}

const fmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** O que a IA recebe: resumo compacto das últimas 24 h (texto, poucos KB). */
export async function montarDigesto(horas = 24): Promise<string> {
  const desde = new Date(Date.now() - horas * 3600_000);
  const d = db();
  const [ops, achados, eventosGrandes, logins] = await Promise.all([
    d.auditoriaOperacao.findMany({ where: { inicio: { gte: desde }, origem: { in: ['TELA', 'API', 'MCP', 'SITE', 'REVERSAO'] } }, select: { usuario: true, categoria: true, descricao: true, inicio: true, status: true, revertidaEm: true }, orderBy: { inicio: 'asc' }, take: 3000 }),
    d.auditoriaAchado.findMany({ where: { status: { in: ['ABERTO', 'VISTO'] }, agente: { not: 'analista' } }, orderBy: [{ nivel: 'asc' }, { atualizadoEm: 'desc' }], take: 40, select: { agente: true, nivel: true, titulo: true, usuario: true } }),
    d.auditoriaEvento.findMany({ where: { quando: { gte: desde }, tabela: { in: ['Venda', 'OrdemServico', 'Compra', 'MovimentoFinanceiro', 'ContaReceber', 'ContaPagar'] }, modo: 'DIRETO' }, select: { tabela: true, tipo: true, depois: true, antes: true, operacao: { select: { usuario: true } } }, take: 3000 }),
    d.auditoria.count({ where: { acao: 'LOGIN', data: { gte: desde } } }),
  ]);
  const porUsuario = new Map<string, Record<string, number>>();
  for (const o of ops) {
    const r = porUsuario.get(o.usuario) ?? {};
    r[o.categoria] = (r[o.categoria] ?? 0) + 1;
    porUsuario.set(o.usuario, r);
  }
  const linhas: string[] = [];
  linhas.push(`Período: últimas ${horas} h (até ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}). Operações: ${ops.length}. Logins: ${logins}.`);
  linhas.push('Operações por pessoa e categoria:');
  for (const [u, cats] of porUsuario) linhas.push(`- ${u}: ${Object.entries(cats).map(([c, n]) => `${c} ${n}`).join(', ')}`);
  const dinheiro = eventosGrandes
    .map((e) => {
      const s = (() => {
        try {
          return JSON.parse(e.depois ?? e.antes ?? '{}');
        } catch {
          return {};
        }
      })();
      const v = Number(s.total ?? s.valor ?? 0);
      return { e, v, s };
    })
    .filter((x) => x.v >= 500 || x.e.tipo === 'EXCLUIR')
    .sort((a, b) => b.v - a.v)
    .slice(0, 40);
  if (dinheiro.length) {
    linhas.push('Movimentos relevantes (≥ R$ 500 ou exclusões):');
    for (const x of dinheiro) linhas.push(`- ${x.e.operacao.usuario}: ${x.e.tipo} ${x.e.tabela} ${x.s.numero ? 'nº ' + x.s.numero : ''} ${fmt.format(x.v)}${x.s.descricao ? ' "' + String(x.s.descricao).slice(0, 40) + '"' : ''}`);
  }
  const comErro = ops.filter((o) => (o.status ?? 200) >= 500).length;
  const revertidas = ops.filter((o) => o.revertidaEm).length;
  if (comErro || revertidas) linhas.push(`Operações com erro 5xx: ${comErro}. Operações revertidas: ${revertidas}.`);
  if (achados.length) {
    linhas.push('Achados abertos dos agentes de regras:');
    for (const a of achados) linhas.push(`- [${a.nivel}] (${a.agente}) ${a.titulo}`);
  }
  linhas.push('Últimas 25 operações:');
  for (const o of ops.slice(-25)) linhas.push(`- ${o.inicio.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })} ${o.usuario} [${o.categoria}] ${o.descricao?.slice(0, 140) ?? ''}`);
  return linhas.join('\n').slice(0, 24000);
}

const SISTEMA = `Você é o analista de auditoria interna do MEU BLING, o sistema de gestão da loja Balão da Informática (Campinas-SP): vendas, assistência técnica (OS), compras, estoque, financeiro e NF-e. Você recebe um resumo do que os funcionários fizeram no sistema nas últimas horas e os achados já levantados por agentes de regras. Sua tarefa é a de um auditor experiente e justo: apontar padrões, inconsistências e coisas que merecem investigação — sem acusar ninguém, sem inventar fatos que não estão no resumo, e dizendo quando algo provavelmente é normal. Escreva em português do Brasil, direto, para o dono da loja. Responda SOMENTE com JSON válido neste formato:
{"resumo": "2 a 4 frases com o panorama", "pontos": [{"nivel": "alto|medio|baixo", "titulo": "frase curta", "explicacao": "o que viu, por que importa e o que conferir", "usuario": "nome ou null"}], "perguntas": ["pergunta objetiva para investigar", "..."]}
No máximo 8 pontos e 5 perguntas. Se não houver nada relevante, diga isso no resumo e devolva listas vazias.`;

export async function analisar(motivo: string): Promise<RelatorioAnalista> {
  const k = await chave();
  const cfg = await lerConfig();
  const base: RelatorioAnalista = { geradoEm: new Date().toISOString(), modelo: cfg.modeloIa, resumo: '', pontos: [], perguntas: [], erro: null };
  if (!k) {
    base.erro = 'Sem chave da API da Anthropic. Cole a chave no Painel → Agentes → Analista.';
    return base;
  }
  const digesto = await montarDigesto(24);
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 90_000);
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': k, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: cfg.modeloIa, max_tokens: 2000, system: SISTEMA, messages: [{ role: 'user', content: `Motivo da análise: ${motivo}\n\n${digesto}` }] }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    const corpo: any = await r.json().catch(() => ({}));
    if (!r.ok) {
      base.erro = `A API da Anthropic respondeu ${r.status}: ${corpo?.error?.message ?? 'erro'}`;
    } else {
      const texto: string = (corpo?.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
      const json = texto.slice(texto.indexOf('{'), texto.lastIndexOf('}') + 1);
      const parsed = JSON.parse(json);
      base.resumo = String(parsed.resumo ?? '').slice(0, 2000);
      base.pontos = (Array.isArray(parsed.pontos) ? parsed.pontos : []).slice(0, 8).map((p: any) => ({ nivel: ['alto', 'medio', 'baixo'].includes(p.nivel) ? p.nivel : 'baixo', titulo: String(p.titulo ?? '').slice(0, 200), explicacao: String(p.explicacao ?? '').slice(0, 1000), usuario: p.usuario ? String(p.usuario).slice(0, 80) : null }));
      base.perguntas = (Array.isArray(parsed.perguntas) ? parsed.perguntas : []).slice(0, 5).map((q: any) => String(q).slice(0, 300));
    }
  } catch (e) {
    base.erro = `Falha ao falar com a IA: ${(e as Error)?.message ?? e}`;
  }
  // pontos viram achados (para ficarem junto dos outros, com status)
  if (!base.erro) {
    const dia = base.geradoEm.slice(0, 10);
    for (let i = 0; i < base.pontos.length; i++) {
      const p = base.pontos[i];
      const chaveAchado = `analista:${dia}:${i}`;
      await db()
        .auditoriaAchado.upsert({
          where: { chave: chaveAchado },
          create: { chave: chaveAchado, agente: 'analista', nivel: p.nivel, categoria: 'analista', titulo: p.titulo, explicacao: p.explicacao, usuario: p.usuario ?? null, evidencias: '[]' },
          update: { nivel: p.nivel, titulo: p.titulo, explicacao: p.explicacao, usuario: p.usuario ?? null },
        })
        .catch(() => undefined);
    }
  }
  await db().configuracao.upsert({ where: { chave: CHAVE_ULTIMO }, create: { chave: CHAVE_ULTIMO, valor: JSON.stringify(base) }, update: { valor: JSON.stringify(base) } }).catch(() => undefined);
  return base;
}
