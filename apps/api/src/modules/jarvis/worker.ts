/**
 * JARVIS — o worker que roda 24h na VPS, a cada 30 minutos.
 *
 * Cada rodada:
 *   1. calcula o caixa livre e grava a foto (JarvisMetrica);
 *   2. roda as regras e cria/atualiza as sugestões (sem repetir o que já está aberto);
 *   3. pede à IA, numa chamada só, que reescreva os textos novos em português;
 *   4. expira sugestões cujo problema se resolveu sozinho e mede o que as aceitas renderam.
 *
 * Desligar: JARVIS=off no ambiente, ou "ligado = false" em Configurações → JARVIS.
 */
import type { FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { gravarMetrica } from './caixa-livre.js';
import { rodarRegras, type Sugestao } from './regras.js';
import { perguntarIa, SISTEMA_SUGESTOES } from './ia.js';

export const INTERVALO_MS = 30 * 60 * 1000; // 30 minutos (pedido do Thiago)

/** Configuração do JARVIS, criando a linha única na primeira vez. */
export async function obterConfig() {
  const existe = await prisma.jarvisConfig.findUnique({ where: { id: 1 } });
  if (existe) return existe;
  return prisma.jarvisConfig.create({ data: { id: 1 } });
}

let rodando = false;

export type ResultadoRodada = {
  caixaLivre: number;
  novas: number;
  atualizadas: number;
  expiradas: number;
  comIa: boolean;
};

export async function rodarJarvis(motivo: 'agendado' | 'manual' = 'agendado'): Promise<ResultadoRodada | null> {
  if (rodando) return null;
  rodando = true;
  try {
    const cfg = await obterConfig();
    if (!cfg.ligado && motivo === 'agendado') return null;

    const { caixa, sugestoes } = await rodarRegras({
      diasEstoqueParado: cfg.diasEstoqueParado,
      metaCaixa: cfg.metaCaixa,
    });
    await gravarMetrica(caixa);

    const vivas = new Set(sugestoes.map((s) => s.chave));

    // 1) grava as sugestões da vez
    let novas = 0;
    let atualizadas = 0;
    const paraIa: Sugestao[] = [];

    for (const s of sugestoes) {
      const aberta = await prisma.jarvisSugestao.findFirst({
        where: { chave: s.chave, situacao: { in: ['ABERTA', 'ADIADA'] } },
      });

      if (!aberta) {
        // não recria o que o gestor recusou hoje
        const recusadaHoje = await prisma.jarvisSugestao.findFirst({
          where: {
            chave: s.chave,
            situacao: 'RECUSADA',
            decididaEm: { gte: new Date(Date.now() - 7 * 86_400_000) },
          },
        });
        if (recusadaHoje) continue;

        await prisma.jarvisSugestao.create({
          data: {
            regra: s.regra,
            chave: s.chave,
            perfis: s.perfis,
            titulo: s.titulo,
            texto: s.texto,
            impactoEstimado: s.impactoEstimado ?? null,
            prioridade: s.prioridade,
            dados: s.dados ? JSON.stringify(s.dados) : null,
            acao: s.acao ?? 'NENHUMA',
            link: s.link ?? null,
          },
        });
        novas++;
        paraIa.push(s);
      } else if (aberta.situacao === 'ABERTA') {
        // mesma sugestão, números novos
        await prisma.jarvisSugestao.update({
          where: { id: aberta.id },
          data: {
            titulo: s.titulo,
            impactoEstimado: s.impactoEstimado ?? null,
            prioridade: s.prioridade,
            dados: s.dados ? JSON.stringify(s.dados) : null,
            // o texto da IA só é reescrito quando o impacto muda bastante
            texto:
              Math.abs((aberta.impactoEstimado ?? 0) - (s.impactoEstimado ?? 0)) > (aberta.impactoEstimado ?? 0) * 0.2
                ? s.texto
                : aberta.texto,
          },
        });
        atualizadas++;
      }
    }

    // 2) o problema sumiu sozinho → a sugestão sai da lista
    const expiradas = await prisma.jarvisSugestao.updateMany({
      where: { situacao: 'ABERTA', chave: { notIn: [...vivas] } },
      data: { situacao: 'EXPIRADA', decididaEm: new Date(), decididaPor: 'JARVIS' },
    });

    // 3) sugestões adiadas cujo prazo passou voltam a aparecer
    await prisma.jarvisSugestao.updateMany({
      where: { situacao: 'ADIADA', adiadaAte: { lte: new Date() } },
      data: { situacao: 'ABERTA', adiadaAte: null },
    });

    // 4) a IA reescreve os textos novos (uma chamada por rodada)
    let comIa = false;
    if (paraIa.length > 0) comIa = await reescreverComIa(paraIa, caixa.caixaLivre, cfg.metaCaixa);

    await prisma.jarvisConfig.update({ where: { id: 1 }, data: { ultimaRodadaEm: new Date() } });

    return { caixaLivre: caixa.caixaLivre, novas, atualizadas, expiradas: expiradas.count, comIa };
  } finally {
    rodando = false;
  }
}

/** Pede à IA que reescreva os textos das sugestões novas. Silencioso quando não há chave. */
async function reescreverComIa(sugestoes: Sugestao[], caixaLivre: number, meta: number): Promise<boolean> {
  const contexto = {
    caixaLivreHoje: caixaLivre,
    metaDeCaixa: meta,
    faltaParaMeta: Math.max(0, meta - caixaLivre),
    sugestoes: sugestoes.map((s) => ({
      chave: s.chave,
      regra: s.regra,
      tituloAtual: s.titulo,
      textoAtual: s.texto,
      impactoEstimado: s.impactoEstimado ?? null,
      numeros: s.dados ?? null,
    })),
  };

  const r = await perguntarIa(
    SISTEMA_SUGESTOES,
    `Números da loja agora:\n${JSON.stringify(contexto, null, 1).slice(0, 24_000)}\n\n` +
      `Reescreva o título e o texto de cada sugestão acima. Devolva o JSON pedido, uma entrada por chave.`,
    { maxTokens: 3000 },
  );
  if (!r) return false;

  try {
    const bruto = r.texto.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
    const lista = JSON.parse(bruto) as { chave: string; titulo?: string; texto?: string }[];
    for (const item of lista) {
      if (!item?.chave || !item.texto) continue;
      await prisma.jarvisSugestao.updateMany({
        where: { chave: item.chave, situacao: 'ABERTA' },
        data: { titulo: item.titulo?.slice(0, 200) || undefined, texto: item.texto.slice(0, 1200) },
      });
    }
    return true;
  } catch {
    return false; // JSON inválido: ficam os textos padrão das regras
  }
}

/** Mede o que cada sugestão aceita rendeu de verdade (placar do JARVIS). */
export async function medirResultados() {
  const aceitas = await prisma.jarvisSugestao.findMany({
    where: { situacao: 'ACEITA', medidaEm: null, decididaEm: { lte: new Date(Date.now() - 7 * 86_400_000) } },
    select: { id: true, decididaEm: true, impactoEstimado: true },
  });
  for (const s of aceitas) {
    if (!s.decididaEm) continue;
    const antes = await prisma.jarvisMetrica.findFirst({
      where: { em: { lte: s.decididaEm } },
      orderBy: { em: 'desc' },
      select: { caixaLivre: true },
    });
    const agora = await prisma.jarvisMetrica.findFirst({ orderBy: { em: 'desc' }, select: { caixaLivre: true } });
    if (!antes || !agora) continue;
    await prisma.jarvisSugestao.update({
      where: { id: s.id },
      data: { resultadoReal: Math.round((agora.caixaLivre - antes.caixaLivre) * 100) / 100, medidaEm: new Date() },
    });
  }
}

export function iniciarWorker(app: FastifyInstance) {
  if (process.env.JARVIS === 'off') {
    app.log.info('[jarvis] desligado (JARVIS=off)');
    return;
  }
  const rodada = () =>
    rodarJarvis('agendado')
      .then((r) => {
        if (r) app.log.info(`[jarvis] caixa livre ${r.caixaLivre} · ${r.novas} nova(s), ${r.expiradas} resolvida(s)`);
      })
      .then(() => medirResultados())
      .catch((e) => app.log.error({ e }, '[jarvis] falha na rodada'));

  setTimeout(rodada, 60_000).unref(); // 1 min depois de subir
  setInterval(rodada, INTERVALO_MS).unref();
}
