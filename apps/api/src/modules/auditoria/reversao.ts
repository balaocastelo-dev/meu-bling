/**
 * REVERSÃO — desfaz uma operação inteira a partir da trilha (antes/depois), na ordem inversa,
 * numa transação só: o que foi criado é excluído, o que foi excluído volta, o que foi alterado
 * recebe de volta só os campos que a operação mudou. A reversão também fica na trilha (como uma
 * operação REVERSAO ligada à original) — e pode ser revertida de novo ("refazer").
 *
 * O que nunca é revertido daqui: numeração (Sequencia), gravações em massa resumidas, e qualquer
 * operação que tocou nota fiscal já transmitida à SEFAZ (cancela-se pela tela fiscal).
 */
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { comContexto } from './contexto.js';
import { camposEscalares, campoId, clienteSemTrilha, filhosDe, nomeDelegate, modelo } from './trilha.js';
import { descreverOperacao, lerJson, linkRegistro, nomeTabela, rotuloRegistro } from './operacoes.js';

export interface Passo {
  eventoId: number;
  tabela: string;
  registroId: number | null;
  registroChave: string | null;
  acao: 'EXCLUIR' | 'RECRIAR' | 'RESTAURAR' | 'PULAR';
  rotulo: string;
  link: string | null;
  campos: string[];
  motivo?: string;
}
export interface Previa {
  operacao: { id: string; descricao: string | null; usuario: string; inicio: Date; revertidaEm: Date | null; reverteOpId: string | null };
  passos: Passo[];
  /** impedem a reversão */
  bloqueios: string[];
  /** pedem confirmação (forcar: true) */
  avisos: { texto: string; operacaoId?: string; link?: string | null }[];
  podeReverter: boolean;
  precisaConfirmar: boolean;
}

const base = () => clienteSemTrilha();
const SITUACOES_SEFAZ = /^(AUTORIZADA|CANCELADA|DENEGADA|INUTILIZADA)$/i;

/** JSON do snapshot → dados que o Prisma aceita (datas, só campos que existem hoje, sem binários) */
function dadosDoSnapshot(tabela: string, snap: Record<string, unknown>, apenas?: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of camposEscalares(tabela)) {
    if (apenas && !apenas.includes(f.name)) continue;
    if (!(f.name in snap)) continue;
    const v = snap[f.name];
    if (v && typeof v === 'object' && '__binario' in (v as object)) continue;
    if (f.type === 'DateTime') out[f.name] = v === null ? null : new Date(String(v));
    else if (f.type === 'Int' || f.type === 'Float') out[f.name] = v === null ? null : Number(v);
    else out[f.name] = v;
  }
  return out;
}

export async function previaReversao(operacaoId: string): Promise<Previa> {
  const db = base();
  const op = await db.auditoriaOperacao.findUnique({ where: { id: operacaoId }, include: { eventos: { orderBy: { sequencia: 'desc' } } } });
  if (!op) throw new AppError('Operação não encontrada na trilha.', 404, 'NAO_ENCONTRADO');
  const bloqueios: string[] = [];
  const avisos: Previa['avisos'] = [];
  const passos: Passo[] = [];
  if (op.revertidaEm) bloqueios.push(`Esta operação já foi revertida em ${op.revertidaEm.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} por ${op.revertidaPor ?? '?'}. Para desfazer a reversão, reverta a operação de reversão.`);
  if (!op.eventos.length) bloqueios.push('Esta operação não gravou nada no banco (só leitura ou ação sem efeito) — não há o que reverter.');

  const idsDaOperacao = new Set(op.eventos.map((e) => `${e.tabela}:${e.registroId ?? e.registroChave}`));
  for (const e of op.eventos) {
    const antes = lerJson(e.antes);
    const depois = lerJson(e.depois);
    const snap = depois ?? antes;
    const rotulo = rotuloRegistro(e.tabela, e.registroId, e.registroChave, snap);
    const link = linkRegistro(e.tabela, e.registroId, snap);
    const campos: string[] = (() => {
      try {
        return e.campos ? (JSON.parse(e.campos) as string[]) : [];
      } catch {
        return [];
      }
    })();
    if (e.revertidoEm) {
      passos.push({ eventoId: e.id, tabela: e.tabela, registroId: e.registroId, registroChave: e.registroChave, acao: 'PULAR', rotulo, link, campos, motivo: 'já revertido' });
      continue;
    }
    if (!e.reversivel || !modelo(e.tabela)) {
      const motivo = e.tabela === 'Sequencia' ? 'numeração não volta (evitaria números repetidos)' : snap?.__resumo ? `gravação em massa (${snap.__resumo})` : 'não reversível';
      passos.push({ eventoId: e.id, tabela: e.tabela, registroId: e.registroId, registroChave: e.registroChave, acao: 'PULAR', rotulo, link, campos, motivo });
      continue;
    }
    // nota fiscal que já foi à SEFAZ: fora
    if (e.tabela === 'NotaFiscal' && (SITUACOES_SEFAZ.test(String(antes?.situacao ?? '')) || SITUACOES_SEFAZ.test(String(depois?.situacao ?? '')) || depois?.protocolo || antes?.protocolo)) {
      bloqueios.push(`${rotulo} já foi transmitida à SEFAZ: o sistema não pode desfazer isso pelo painel. Cancele ou corrija a nota pela tela fiscal.`);
    }
    const acao: Passo['acao'] = e.tipo === 'CRIAR' ? 'EXCLUIR' : e.tipo === 'EXCLUIR' ? 'RECRIAR' : 'RESTAURAR';
    passos.push({ eventoId: e.id, tabela: e.tabela, registroId: e.registroId, registroChave: e.registroChave, acao, rotulo, link, campos });

    // alterações posteriores no mesmo registro (outra operação): avisar
    if (e.registroId !== null || e.registroChave !== null) {
      const posteriores = await db.auditoriaEvento.findMany({
        where: { tabela: e.tabela, registroId: e.registroId, registroChave: e.registroChave, quando: { gt: e.quando }, operacaoId: { not: operacaoId }, revertidoEm: null },
        select: { operacaoId: true, operacao: { select: { descricao: true, usuario: true, inicio: true, reverteOpId: true } } },
        distinct: ['operacaoId'],
        take: 5,
      });
      for (const p of posteriores) {
        if (p.operacao.reverteOpId === operacaoId) continue; // é a reversão desta mesma operação (refazer)
        avisos.push({ texto: `${rotulo} foi mexido depois por ${p.operacao.usuario} em ${p.operacao.inicio.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}${p.operacao.descricao ? ` (${p.operacao.descricao.slice(0, 120)})` : ''} — a reversão vai sobrescrever o que esta operação mudou.`, operacaoId: p.operacaoId, link });
      }
    }
    // registro criado que outras coisas (de fora desta operação) já usam
    if (e.tipo === 'CRIAR' && e.registroId !== null) {
      for (const rel of filhosDe(e.tabela)) {
        const refValor = snap?.[rel.ref];
        if (refValor === undefined || refValor === null) continue;
        const dependentes: Record<string, unknown>[] = await (db as any)[nomeDelegate(rel.modelo)].findMany({ where: { [rel.fk]: refValor }, take: 50 }).catch(() => []);
        const idc = campoId(rel.modelo)?.name ?? 'id';
        const deFora = dependentes.filter((d) => !idsDaOperacao.has(`${rel.modelo}:${String(d[idc])}`));
        if (!deFora.length) continue;
        const lista = deFora.slice(0, 3).map((d) => rotuloRegistro(rel.modelo, Number(d[idc]), null, d)).join(', ');
        if (rel.onDelete === 'Cascade') avisos.push({ texto: `Excluir ${rotulo} apaga junto ${deFora.length} ${nomeTabela(rel.modelo, deFora.length > 1)} gravado(s) depois: ${lista}.`, link });
        else if (rel.obrigatorio) bloqueios.push(`${rotulo} não pode ser excluído: ${deFora.length} ${nomeTabela(rel.modelo, deFora.length > 1)} dependem dele (${lista}). Reverta antes as operações que os criaram.`);
        else avisos.push({ texto: `Excluir ${rotulo} desvincula ${deFora.length} ${nomeTabela(rel.modelo, deFora.length > 1)} (${lista}).`, link });
      }
    }
  }
  if (!passos.some((p) => p.acao !== 'PULAR') && !bloqueios.length) bloqueios.push('Nada reversível nesta operação.');
  return {
    operacao: { id: op.id, descricao: op.descricao, usuario: op.usuario, inicio: op.inicio, revertidaEm: op.revertidaEm, reverteOpId: op.reverteOpId },
    passos,
    bloqueios: [...new Set(bloqueios)],
    avisos,
    podeReverter: bloqueios.length === 0,
    precisaConfirmar: avisos.length > 0,
  };
}

export async function reverterOperacao(operacaoId: string, opts: { forcar: boolean; quem: { id: number | null; nome: string }; ip?: string | null; motivo?: string }) {
  const previa = await previaReversao(operacaoId);
  if (!previa.podeReverter) throw new AppError(previa.bloqueios.join(' '), 409, 'REVERSAO_BLOQUEADA', { bloqueios: previa.bloqueios });
  if (previa.precisaConfirmar && !opts.forcar) throw new AppError('Esta reversão precisa de confirmação: há alterações posteriores nos mesmos registros.', 409, 'REVERSAO_CONFIRMAR', { avisos: previa.avisos });
  const db = base();
  const eventos = await db.auditoriaEvento.findMany({ where: { operacaoId }, orderBy: { sequencia: 'desc' } });
  const feitos: string[] = [];
  const pulados: string[] = [];

  const resultado = await comContexto(
    { origem: 'REVERSAO', reverteOpId: operacaoId, usuario: opts.quem, rota: `POST /api/v1/auditoria/painel/reverter/${operacaoId}`, ip: opts.ip ?? null },
    () =>
      prisma.$transaction(
        async (tx) => {
          for (const e of eventos) {
            const passo = previa.passos.find((p) => p.eventoId === e.id);
            if (!passo || passo.acao === 'PULAR') {
              if (passo?.motivo && passo.motivo !== 'já revertido') pulados.push(`${passo.rotulo}: ${passo.motivo}`);
              continue;
            }
            const delegate = (tx as any)[nomeDelegate(e.tabela)];
            const idc = campoId(e.tabela)?.name ?? 'id';
            const chave = e.registroId ?? e.registroChave;
            const antes = lerJson(e.antes);
            if (passo.acao === 'EXCLUIR') {
              const existe = await delegate.findUnique({ where: { [idc]: chave } });
              if (!existe) {
                pulados.push(`${passo.rotulo}: já não existia`);
                continue;
              }
              await delegate.delete({ where: { [idc]: chave } });
              feitos.push(`excluído ${passo.rotulo}`);
            } else if (passo.acao === 'RECRIAR') {
              if (!antes) continue;
              const existe = await delegate.findUnique({ where: { [idc]: chave } });
              if (existe) {
                pulados.push(`${passo.rotulo}: já existe de novo`);
                continue;
              }
              await delegate.create({ data: dadosDoSnapshot(e.tabela, antes) });
              feitos.push(`recriado ${passo.rotulo}`);
            } else if (passo.acao === 'RESTAURAR') {
              if (!antes) continue;
              const existe = await delegate.findUnique({ where: { [idc]: chave } });
              if (!existe) {
                pulados.push(`${passo.rotulo}: não existe mais (foi excluído depois)`);
                continue;
              }
              const data = dadosDoSnapshot(e.tabela, antes, passo.campos.length ? passo.campos : undefined);
              delete data[idc];
              if (!Object.keys(data).length) continue;
              await delegate.update({ where: { [idc]: chave }, data });
              feitos.push(`restaurado ${passo.rotulo} (${passo.campos.join(', ')})`);
            }
          }
          const agora = new Date();
          await tx.auditoriaEvento.updateMany({ where: { operacaoId, revertidoEm: null, id: { in: previa.passos.filter((p) => p.acao !== 'PULAR').map((p) => p.eventoId) } }, data: { revertidoEm: agora } });
          await tx.auditoriaOperacao.update({ where: { id: operacaoId }, data: { revertidaEm: agora, revertidaPor: opts.quem.nome } });
          return { feitos, pulados };
        },
        { timeout: 120_000, maxWait: 20_000 },
      ),
  );

  // a operação de reversão nasceu dentro do contexto: ligamos as duas e, se foi um "refazer", reabrimos a original
  const reversao = await db.auditoriaOperacao.findFirst({ where: { reverteOpId: operacaoId }, orderBy: { inicio: 'desc' } });
  if (reversao) {
    await db.auditoriaOperacao.update({ where: { id: operacaoId }, data: { revertidaOpId: reversao.id } });
    await db.auditoriaOperacao.update({ where: { id: reversao.id }, data: { fim: new Date(), status: 200, descricao: (await descreverOperacao(reversao.id)).slice(0, 500) } });
  }
  const original = await db.auditoriaOperacao.findUnique({ where: { id: operacaoId }, select: { reverteOpId: true } });
  if (original?.reverteOpId) {
    await db.auditoriaOperacao.update({ where: { id: original.reverteOpId }, data: { revertidaEm: null, revertidaPor: null, revertidaOpId: null } }).catch(() => undefined);
    await db.auditoriaEvento.updateMany({ where: { operacaoId: original.reverteOpId }, data: { revertidoEm: null } });
  }
  return { ...resultado, reversaoId: reversao?.id ?? null, previa };
}
