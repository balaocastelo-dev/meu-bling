/**
 * TRILHA DE AUDITORIA — grava o ANTES e o DEPOIS de toda gravação do banco.
 *
 * É uma extensão do Prisma (lib/prisma.ts aplica em cima do cliente): create, update, upsert,
 * delete, createMany, updateMany e deleteMany de qualquer tabela viram AuditoriaEvento, agrupados
 * numa AuditoriaOperacao (a requisição da tela/API, ou a rajada de um robô). Nenhum módulo precisa
 * chamar nada — e é isso que permite ao Painel de auditoria reverter qualquer coisa que o sistema fez.
 *
 * Cobre também o que a gravação faz "por tabela": itens gravados dentro do pai (venda.update com
 * itens: { create/deleteMany }), o que o banco apaga em cascata ao excluir (itens, parcelas…) e os
 * vínculos que viram nulos (onDelete SetNull). Tudo dentro da mesma transação da gravação original,
 * então se a gravação falha, a trilha também não fica.
 *
 * Fora da trilha (puro registro): Auditoria (legível), LogApi, EntregaWebhook e as tabelas do painel.
 * Fica no histórico mas a reversão pula: Sequencia (numeração) — restaurar número antigo duplicaria.
 */
import type { PrismaClient } from '@prisma/client';
import { autorDoContexto, contextoAtual, novoId, rotacionarSeRajada, type ContextoOperacao } from './contexto.js';

export const IGNORAR = new Set(['Auditoria', 'AuditoriaOperacao', 'AuditoriaEvento', 'AuditoriaAchado', 'LogApi', 'EntregaWebhook']);

/**
 * FALHAS DA TRILHA — quando o histórico não consegue ser gravado, a gravação original segue
 * (nunca derrubamos a tela do vendedor por causa da auditoria). Mas o buraco não pode ficar
 * invisível: aquela operação some do histórico E deixa de ser reversível. Guardamos aqui para
 * o Robô da Saúde avisar no painel. Memória + melhor esforço no banco (sobrevive a reinício).
 */
export const CHAVE_FALHAS_TRILHA = 'auditoria.falhasTrilha';
let falhas = { total: 0, ultima: null as string | null, quando: null as string | null };

export function falhasDaTrilha() {
  return { ...falhas };
}
export function zerarFalhasDaTrilha() {
  falhas = { total: 0, ultima: null, quando: null };
}

function anotarFalha(model: string, op: string, causa: unknown) {
  falhas = { total: falhas.total + 1, ultima: `${model}.${op}: ${String(causa).slice(0, 300)}`, quando: new Date().toISOString() };
  // melhor esforço: se o banco estiver de pé, deixa registrado para depois do reinício
  void clienteSemTrilha()
    .configuracao.upsert({
      where: { chave: CHAVE_FALHAS_TRILHA },
      create: { chave: CHAVE_FALHAS_TRILHA, valor: JSON.stringify(falhas) },
      update: { valor: JSON.stringify(falhas) },
    })
    .catch(() => undefined);
}
export const NAO_REVERTER = new Set(['Sequencia']);
/** campos que mudam sozinhos (carimbos): se só eles mudaram, não é um acontecimento */
const CARIMBOS = new Set(['atualizadoEm', 'siteSincronizadoEm', 'ultimaSincronizacao', 'saldoBancoEm', 'ultimoLogin', 'ultimoUsoEm', 'ultimoIp', 'totalChamadas']);
/** gravações em massa acima disto viram um evento-resumo (não reversível) em vez de uma linha por registro */
const MAX_LINHAS = 500;
const MAX_CASCATA = 400;
const OPERACOES_NESTED = ['create', 'createMany', 'connectOrCreate', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany', 'set', 'connect', 'disconnect'];

export type TipoEvento = 'CRIAR' | 'ALTERAR' | 'EXCLUIR';
export type ModoEvento = 'DIRETO' | 'ANINHADO' | 'CASCATA';

interface CampoModelo {
  name: string;
  kind: 'scalar' | 'object' | 'enum' | 'unsupported';
  type: string;
  isId: boolean;
  isList: boolean;
  isRequired: boolean;
  isUnique: boolean;
  relationName?: string;
  relationFromFields?: string[];
  relationToFields?: string[];
  relationOnDelete?: string;
}
interface Modelo {
  fields: CampoModelo[];
}

export interface EventoNovo {
  tabela: string;
  registroId: number | null;
  registroChave: string | null;
  tipo: TipoEvento;
  antes: Record<string, unknown> | null;
  depois: Record<string, unknown> | null;
  campos: string[] | null;
  modo: ModoEvento;
  reversivel: boolean;
}

/** contexto de fallback (scripts, seed, gravações sem requisição e sem serviço) */
const fallback: ContextoOperacao = { operacaoId: novoId(), origem: 'SISTEMA', eventos: 0, descricoes: [] };

let modelos: Record<string, Modelo> = {};
let baseCliente: PrismaClient;

// ------------------------------------------------------------------------------------------------
// metadados do schema (vêm do próprio cliente gerado)
// ------------------------------------------------------------------------------------------------
export function modelo(nome: string): Modelo | undefined {
  return modelos[nome];
}
export function nomeDelegate(modeloNome: string) {
  return modeloNome.charAt(0).toLowerCase() + modeloNome.slice(1);
}
export function campoId(modeloNome: string): CampoModelo | undefined {
  return modelos[modeloNome]?.fields.find((f) => f.isId);
}
export function camposEscalares(modeloNome: string): CampoModelo[] {
  return (modelos[modeloNome]?.fields ?? []).filter((f) => f.kind !== 'object' && f.type !== 'Bytes');
}
/** relações em que OUTRA tabela aponta para esta (filhos): [{ modelo filho, campo fk no filho, campo referenciado aqui, onDelete }] */
export function filhosDe(modeloNome: string) {
  const out: { modelo: string; fk: string; ref: string; onDelete: string | undefined; obrigatorio: boolean }[] = [];
  for (const [nome, m] of Object.entries(modelos)) {
    if (IGNORAR.has(nome)) continue;
    for (const f of m.fields) {
      if (f.kind !== 'object' || f.type !== modeloNome || !f.relationFromFields?.length) continue;
      out.push({ modelo: nome, fk: f.relationFromFields[0], ref: f.relationToFields?.[0] ?? 'id', onDelete: f.relationOnDelete, obrigatorio: f.isRequired });
    }
  }
  return out;
}
/** dado um campo de relação deste modelo, qual tabela/campo fk guarda o vínculo */
function vinculoDaRelacao(modeloNome: string, campo: CampoModelo): { ladoFilho: boolean; modelo: string; fk: string; ref: string } | null {
  if (campo.relationFromFields?.length) {
    // este modelo guarda a chave (ex.: venda.contato → Venda.contatoId)
    return { ladoFilho: false, modelo: campo.type, fk: campo.relationFromFields[0], ref: campo.relationToFields?.[0] ?? 'id' };
  }
  const outro = modelos[campo.type];
  const f = outro?.fields.find((x) => x.kind === 'object' && x.relationName === campo.relationName && x.relationFromFields?.length);
  if (!f) return null;
  return { ladoFilho: true, modelo: campo.type, fk: f.relationFromFields![0], ref: f.relationToFields?.[0] ?? 'id' };
}

// ------------------------------------------------------------------------------------------------
// snapshots
// ------------------------------------------------------------------------------------------------
export function serializar(modeloNome: string, linha: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!linha) return null;
  const out: Record<string, unknown> = {};
  for (const f of modelos[modeloNome]?.fields ?? []) {
    if (f.kind === 'object') continue;
    const v = linha[f.name];
    if (v === undefined) continue;
    if (f.type === 'Bytes') {
      out[f.name] = v === null ? null : { __binario: Buffer.isBuffer(v) ? v.length : -1 };
      continue;
    }
    out[f.name] = v instanceof Date ? v.toISOString() : v;
  }
  return out;
}
export function diferencas(antes: Record<string, unknown>, depois: Record<string, unknown>): string[] {
  const campos = new Set([...Object.keys(antes), ...Object.keys(depois)]);
  const out: string[] = [];
  for (const c of campos) if (JSON.stringify(antes[c] ?? null) !== JSON.stringify(depois[c] ?? null)) out.push(c);
  return out;
}
function chaveDe(modeloNome: string, linha: Record<string, unknown>): { registroId: number | null; registroChave: string | null } {
  const idc = campoId(modeloNome);
  if (!idc) return { registroId: null, registroChave: null };
  const v = linha[idc.name];
  return typeof v === 'number' ? { registroId: v, registroChave: null } : { registroId: null, registroChave: v === null || v === undefined ? null : String(v) };
}
function ehNoOp(campos: string[]) {
  return campos.every((c) => CARIMBOS.has(c));
}

// ------------------------------------------------------------------------------------------------
// gravação dos eventos
// ------------------------------------------------------------------------------------------------
function categoriaDaTabela(tabela: string): string {
  return CATEGORIA_TABELA[tabela] ?? 'sistema';
}
export const CATEGORIA_TABELA: Record<string, string> = {
  Venda: 'vendas', VendaItem: 'vendas', VendaParcela: 'vendas', VendaRoboNf: 'vendas', AlocacaoCompra: 'vendas',
  Comissao: 'comissoes', Desafio: 'comissoes', DesafioConquista: 'comissoes', MetaVendedor: 'comissoes', MetaTecnico: 'comissoes', Vendedor: 'cadastros', Tecnico: 'cadastros',
  OrdemServico: 'os', OrdemServicoItem: 'os', OrdemServicoParcela: 'os', OrdemServicoAnexo: 'os',
  Compra: 'compras', CompraItem: 'compras', CompraParcela: 'compras',
  Produto: 'estoque', EstoqueSaldo: 'estoque', MovimentoEstoque: 'estoque', CategoriaProduto: 'estoque', Deposito: 'estoque',
  ContaReceber: 'financeiro', ContaPagar: 'financeiro', MovimentoFinanceiro: 'financeiro', ContaFinanceira: 'financeiro', TransacaoBancaria: 'financeiro',
  FormaPagamento: 'financeiro', CategoriaFinanceira: 'financeiro', Caixinha: 'financeiro', Emprestimo: 'financeiro', Carne: 'financeiro',
  NotaFiscal: 'fiscal', NotaFiscalItem: 'fiscal', NotaFiscalEvento: 'fiscal',
  Consignacao: 'consignacao', ConsignacaoDesconto: 'consignacao', ConsignacaoEvento: 'consignacao',
  Contato: 'cadastros',
  Notificacao: 'comunicacao', TemplateNotificacao: 'comunicacao',
  Usuario: 'acessos', ChaveApi: 'acessos',
  Empresa: 'configuracoes', Configuracao: 'configuracoes', Situacao: 'configuracoes', SituacaoTransicao: 'configuracoes', Sequencia: 'configuracoes', WebhookSaida: 'configuracoes',
  RoboSaudeAviso: 'sistema', Lembrete: 'sistema', HistoricoSituacao: 'sistema',
};
/** a categoria da operação é a da tabela mais "importante" tocada */
const PESO_CATEGORIA: Record<string, number> = { fiscal: 10, vendas: 9, financeiro: 8, os: 7, compras: 6, consignacao: 5, estoque: 4, comissoes: 3, cadastros: 2, acessos: 2, configuracoes: 1, comunicacao: 1, sistema: 0 };

/** Grava o cabeçalho da operação (uma vez) e o evento. `db` é o cliente da transação atual ou o base. */
async function gravar(db: any, ctx: ContextoOperacao, eventos: EventoNovo[]) {
  if (!eventos.length) return;
  // serviço de fundo / fallback: cada rajada é uma operação
  rotacionarSeRajada(ctx);
  const autor = autorDoContexto(ctx);
  const categoria = eventos.map((e) => categoriaDaTabela(e.tabela)).sort((a, b) => (PESO_CATEGORIA[b] ?? 0) - (PESO_CATEGORIA[a] ?? 0))[0] ?? 'sistema';
  if (!ctx.cabecalhoGravado) {
    await db.auditoriaOperacao.upsert({
      where: { id: ctx.operacaoId },
      create: { id: ctx.operacaoId, usuarioId: autor.id, usuario: autor.nome, origem: ctx.reverteOpId ? 'REVERSAO' : autor.origem, rota: autor.rota, ip: autor.ip, categoria, reverteOpId: ctx.reverteOpId ?? null },
      update: {},
    });
    ctx.cabecalhoGravado = true;
  } else if ((PESO_CATEGORIA[categoria] ?? 0) > 0) {
    // sobe a categoria da operação se apareceu uma tabela mais importante
    await db.auditoriaOperacao.updateMany({ where: { id: ctx.operacaoId, categoria: { in: Object.keys(PESO_CATEGORIA).filter((c) => (PESO_CATEGORIA[c] ?? 0) < (PESO_CATEGORIA[categoria] ?? 0)) } }, data: { categoria } });
  }
  const linhas = eventos.map((e) => ({
    operacaoId: ctx.operacaoId,
    sequencia: ++ctx.eventos,
    tabela: e.tabela,
    registroId: e.registroId,
    registroChave: e.registroChave,
    tipo: e.tipo,
    antes: e.antes ? JSON.stringify(e.antes) : null,
    depois: e.depois ? JSON.stringify(e.depois) : null,
    campos: e.campos ? JSON.stringify(e.campos) : null,
    modo: e.modo,
    reversivel: e.reversivel && !NAO_REVERTER.has(e.tabela),
  }));
  await db.auditoriaEvento.createMany({ data: linhas });
}

// ------------------------------------------------------------------------------------------------
// leitura de filhos / cascata
// ------------------------------------------------------------------------------------------------
async function lerFilhos(db: any, modeloNome: string, fk: string, valor: unknown): Promise<Record<string, unknown>[]> {
  if (valor === null || valor === undefined) return [];
  return db[nomeDelegate(modeloNome)].findMany({ where: { [fk]: valor }, take: MAX_CASCATA + 1 });
}

/** o que o banco vai apagar/zerar em cascata ao excluir `linha` de `modeloNome` */
async function cascataDe(db: any, modeloNome: string, linha: Record<string, unknown>, profundidade: number, acumulado: EventoNovo[], visitados: Set<string>): Promise<boolean> {
  if (profundidade > 3) return true;
  let completo = true;
  for (const rel of filhosDe(modeloNome)) {
    const cascata = rel.onDelete === 'Cascade';
    const zera = !cascata && !rel.obrigatorio && (!rel.onDelete || rel.onDelete === 'SetNull');
    if (!cascata && !zera) continue;
    const filhos = await lerFilhos(db, rel.modelo, rel.fk, linha[rel.ref]);
    if (filhos.length > MAX_CASCATA) {
      completo = false;
      acumulado.push({ tabela: rel.modelo, registroId: null, registroChave: null, tipo: cascata ? 'EXCLUIR' : 'ALTERAR', antes: null, depois: { __resumo: `mais de ${MAX_CASCATA} registros ${cascata ? 'apagados' : 'desvinculados'} em cascata (${rel.fk})` }, campos: null, modo: 'CASCATA', reversivel: false });
      continue;
    }
    for (const filho of filhos) {
      const marca = `${rel.modelo}:${String(filho[campoId(rel.modelo)?.name ?? 'id'])}`;
      if (visitados.has(marca)) continue;
      visitados.add(marca);
      const antes = serializar(rel.modelo, filho)!;
      if (cascata) {
        if (!(await cascataDe(db, rel.modelo, filho, profundidade + 1, acumulado, visitados))) completo = false;
        acumulado.push({ tabela: rel.modelo, ...chaveDe(rel.modelo, filho), tipo: 'EXCLUIR', antes, depois: null, campos: null, modo: 'CASCATA', reversivel: true });
      } else {
        acumulado.push({ tabela: rel.modelo, ...chaveDe(rel.modelo, filho), tipo: 'ALTERAR', antes, depois: { ...antes, [rel.fk]: null }, campos: [rel.fk], modo: 'CASCATA', reversivel: true });
      }
    }
  }
  return completo;
}

/** relações com gravação aninhada em `data` (venda.update({ data: { itens: { create… } } })) */
function relacoesAninhadas(modeloNome: string, data: unknown): CampoModelo[] {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
  const m = modelos[modeloNome];
  if (!m) return [];
  const out: CampoModelo[] = [];
  for (const f of m.fields) {
    if (f.kind !== 'object') continue;
    const v = (data as Record<string, unknown>)[f.name];
    if (!v || typeof v !== 'object') continue;
    if (OPERACOES_NESTED.some((op) => op in (v as object))) out.push(f);
  }
  return out;
}

/** eventos dos itens aninhados: compara os filhos antes e depois da gravação do pai */
function diffFilhos(modeloFilho: string, antes: Record<string, unknown>[], depois: Record<string, unknown>[], modo: ModoEvento): EventoNovo[] {
  const idc = campoId(modeloFilho)?.name ?? 'id';
  const mapaAntes = new Map(antes.map((r) => [String(r[idc]), r]));
  const mapaDepois = new Map(depois.map((r) => [String(r[idc]), r]));
  const out: EventoNovo[] = [];
  for (const [id, r] of mapaAntes) {
    if (!mapaDepois.has(id)) out.push({ tabela: modeloFilho, ...chaveDe(modeloFilho, r), tipo: 'EXCLUIR', antes: serializar(modeloFilho, r), depois: null, campos: null, modo, reversivel: true });
  }
  for (const [id, r] of mapaDepois) {
    const a = mapaAntes.get(id);
    const sd = serializar(modeloFilho, r)!;
    if (!a) {
      out.push({ tabela: modeloFilho, ...chaveDe(modeloFilho, r), tipo: 'CRIAR', antes: null, depois: sd, campos: null, modo, reversivel: true });
      continue;
    }
    const sa = serializar(modeloFilho, a)!;
    const campos = diferencas(sa, sd);
    if (!campos.length || ehNoOp(campos)) continue;
    out.push({ tabela: modeloFilho, ...chaveDe(modeloFilho, r), tipo: 'ALTERAR', antes: sa, depois: sd, campos, modo, reversivel: true });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------
// a extensão
// ------------------------------------------------------------------------------------------------
type Params = { model?: string; operation: string; args: any; query: (args: any) => Promise<any>; __internalParams?: any };

const DESLIGADA = process.env.TRILHA_AUDITORIA === 'off';

export function comTrilha(base: PrismaClient) {
  baseCliente = base;
  modelos = (base as any)._runtimeDataModel?.models ?? {};
  return base.$extends({
    name: 'trilha-auditoria',
    query: {
      $allModels: {
        async $allOperations(p: any) {
          const { model, operation, args, query } = p as Params;
          if (DESLIGADA || !model || IGNORAR.has(model) || !modelos[model]) return query(args);
          const op = operation;
          if (!['create', 'createMany', 'createManyAndReturn', 'update', 'updateMany', 'updateManyAndReturn', 'upsert', 'delete', 'deleteMany'].includes(op)) return query(args);
          try {
            return await interceptar(model, op, args, query, (p as Params).__internalParams);
          } catch (e) {
            if (e && typeof e === 'object' && (e as any).__trilhaFalhou) {
              console.error('[trilha] falha ao registrar', model, op, (e as any).causa);
              anotarFalha(model, op, (e as any).causa);
              return (e as any).resultado;
            }
            throw e;
          }
        },
      },
    },
  });
}

/** cliente para ler/gravar DENTRO da mesma transação da gravação original (ou o base, fora de transação) */
function clienteDa(internal: any): any {
  const tx = internal?.transaction;
  if (tx && tx.kind === 'itx' && typeof (baseCliente as any)._createItxClient === 'function') return (baseCliente as any)._createItxClient(tx);
  return baseCliente;
}

async function interceptar(model: string, op: string, args: any, query: (a: any) => Promise<any>, internal: any) {
  const db = clienteDa(internal);
  const delegate = db[nomeDelegate(model)];
  const ctx = contextoAtual() ?? fallback;
  const idc = campoId(model);
  const idNome = idc?.name ?? 'id';
  const eventos: EventoNovo[] = [];
  const precisaReler = !!(args?.select || args?.include || args?.omit);

  // ---------- ANTES
  let antes: Record<string, unknown> | null = null;
  let antesMuitos: Record<string, unknown>[] | null = null;
  let filhosAntes: { rel: CampoModelo; vinc: NonNullable<ReturnType<typeof vinculoDaRelacao>>; linhas: Record<string, unknown>[] }[] = [];
  let resumoMassa: string | null = null;
  let cascataCompleta = true;
  const dataAninhada = op === 'upsert' ? { ...(args?.create ?? {}), ...(args?.update ?? {}) } : args?.data;
  const aninhadas = ['create', 'update', 'upsert'].includes(op) ? relacoesAninhadas(model, dataAninhada) : [];

  try {
    if (op === 'update' || op === 'delete' || op === 'upsert') {
      antes = args?.where ? await delegate.findUnique({ where: args.where }) : null;
      if (antes && (op === 'update' || op === 'upsert')) {
        for (const rel of aninhadas) {
          const vinc = vinculoDaRelacao(model, rel);
          if (!vinc || !vinc.ladoFilho) continue;
          filhosAntes.push({ rel, vinc, linhas: await lerFilhos(db, vinc.modelo, vinc.fk, antes[vinc.ref]) });
        }
      }
      if (antes && op === 'delete') {
        cascataCompleta = await cascataDe(db, model, antes, 0, eventos, new Set([`${model}:${String(antes[idNome])}`]));
      }
    } else if (op === 'updateMany' || op === 'updateManyAndReturn' || op === 'deleteMany') {
      const linhas: Record<string, unknown>[] = await delegate.findMany({ where: args?.where ?? {}, take: MAX_LINHAS + 1 });
      if (linhas.length > MAX_LINHAS) {
        resumoMassa = `${op === 'deleteMany' ? 'exclusão' : 'alteração'} em massa de mais de ${MAX_LINHAS} registros`;
      } else {
        antesMuitos = linhas;
        if (op === 'deleteMany') {
          const visitados = new Set(linhas.map((l) => `${model}:${String(l[idNome])}`));
          for (const l of linhas) if (!(await cascataDe(db, model, l, 0, eventos, visitados))) cascataCompleta = false;
        }
      }
    }
  } catch (e) {
    // leitura prévia falhou (ex.: where inválido): deixa a gravação original decidir
    antes = null;
    antesMuitos = null;
    filhosAntes = [];
    eventos.length = 0;
    console.error('[trilha] leitura prévia falhou', model, op, (e as Error)?.message);
  }

  // ---------- A GRAVAÇÃO ORIGINAL
  // createMany não devolve as linhas: pedimos a versão que devolve e entregamos { count } igual
  let resultado: any;
  let criadosEmMassa: Record<string, unknown>[] | null = null;
  if (op === 'createMany' && typeof delegate.createManyAndReturn === 'function') {
    criadosEmMassa = await delegate.createManyAndReturn({ data: args?.data });
    resultado = { count: criadosEmMassa!.length };
  } else {
    // garante o id no resultado (select/omit podem tirá-lo) para a releitura
    let argsFinais = args;
    if (args?.select && typeof args.select === 'object' && !args.select[idNome]) argsFinais = { ...args, select: { ...args.select, [idNome]: true } };
    else if (args?.omit && typeof args.omit === 'object' && args.omit[idNome]) argsFinais = { ...args, omit: { ...args.omit, [idNome]: false } };
    resultado = await query(argsFinais);
  }

  // ---------- DEPOIS
  try {
    const serie = (l: Record<string, unknown> | null) => serializar(model, l);
    if (op === 'create' || op === 'upsert') {
      const linha: Record<string, unknown> | null = precisaReler || !resultado || typeof resultado !== 'object' ? await delegate.findUnique({ where: { [idNome]: resultado?.[idNome] ?? args?.where?.[idNome] } }).catch(() => null) : resultado;
      const depois = serie(linha);
      if (depois) {
        if (antes) {
          const sa = serie(antes)!;
          const campos = diferencas(sa, depois);
          if (campos.length && !ehNoOp(campos)) eventos.push({ tabela: model, ...chaveDe(model, linha!), tipo: 'ALTERAR', antes: sa, depois, campos, modo: 'DIRETO', reversivel: true });
        } else {
          eventos.push({ tabela: model, ...chaveDe(model, linha!), tipo: 'CRIAR', antes: null, depois, campos: null, modo: 'DIRETO', reversivel: true });
        }
        // itens aninhados (criados/alterados/excluídos dentro do pai) e pai criado junto (contato: { create })
        for (const rel of aninhadas) {
          const vinc = vinculoDaRelacao(model, rel);
          if (!vinc) continue;
          if (vinc.ladoFilho) {
            const antesLinhas = filhosAntes.find((f) => f.rel.name === rel.name)?.linhas ?? [];
            const depoisLinhas = await lerFilhos(db, vinc.modelo, vinc.fk, linha![vinc.ref]);
            eventos.push(...diffFilhos(vinc.modelo, antesLinhas, depoisLinhas, 'ANINHADO'));
          } else if ('create' in ((dataAninhada as any)?.[rel.name] ?? {})) {
            const pai = await db[nomeDelegate(vinc.modelo)].findUnique({ where: { [vinc.ref]: linha![vinc.fk] } }).catch(() => null);
            if (pai) eventos.push({ tabela: vinc.modelo, ...chaveDe(vinc.modelo, pai), tipo: 'CRIAR', antes: null, depois: serializar(vinc.modelo, pai), campos: null, modo: 'ANINHADO', reversivel: true });
          }
        }
      }
    } else if (op === 'update') {
      if (antes) {
        const linha: Record<string, unknown> | null = precisaReler || !resultado || typeof resultado !== 'object' ? await delegate.findUnique({ where: { [idNome]: antes[idNome] } }).catch(() => null) : resultado;
        const sa = serie(antes)!;
        const depois = serie(linha);
        if (depois) {
          const campos = diferencas(sa, depois);
          if (campos.length && !ehNoOp(campos)) eventos.push({ tabela: model, ...chaveDe(model, antes), tipo: 'ALTERAR', antes: sa, depois, campos, modo: 'DIRETO', reversivel: true });
          for (const f of filhosAntes) {
            const depoisLinhas = await lerFilhos(db, f.vinc.modelo, f.vinc.fk, linha![f.vinc.ref]);
            eventos.push(...diffFilhos(f.vinc.modelo, f.linhas, depoisLinhas, 'ANINHADO'));
          }
          for (const rel of aninhadas) {
            const vinc = vinculoDaRelacao(model, rel);
            if (!vinc || vinc.ladoFilho || !('create' in ((dataAninhada as any)?.[rel.name] ?? {}))) continue;
            const pai = await db[nomeDelegate(vinc.modelo)].findUnique({ where: { [vinc.ref]: linha![vinc.fk] } }).catch(() => null);
            if (pai) eventos.push({ tabela: vinc.modelo, ...chaveDe(vinc.modelo, pai), tipo: 'CRIAR', antes: null, depois: serializar(vinc.modelo, pai), campos: null, modo: 'ANINHADO', reversivel: true });
          }
        }
      }
    } else if (op === 'delete') {
      if (antes) eventos.push({ tabela: model, ...chaveDe(model, antes), tipo: 'EXCLUIR', antes: serie(antes), depois: null, campos: null, modo: 'DIRETO', reversivel: cascataCompleta });
    } else if (op === 'deleteMany') {
      if (resumoMassa) eventos.push({ tabela: model, registroId: null, registroChave: null, tipo: 'EXCLUIR', antes: null, depois: { __resumo: resumoMassa, where: args?.where ?? null, count: resultado?.count ?? null }, campos: null, modo: 'DIRETO', reversivel: false });
      else for (const l of antesMuitos ?? []) eventos.push({ tabela: model, ...chaveDe(model, l), tipo: 'EXCLUIR', antes: serie(l), depois: null, campos: null, modo: 'DIRETO', reversivel: cascataCompleta });
    } else if (op === 'updateMany' || op === 'updateManyAndReturn') {
      if (resumoMassa) eventos.push({ tabela: model, registroId: null, registroChave: null, tipo: 'ALTERAR', antes: null, depois: { __resumo: resumoMassa, where: args?.where ?? null, data: args?.data ?? null, count: resultado?.count ?? null }, campos: null, modo: 'DIRETO', reversivel: false });
      else if (antesMuitos?.length) {
        const ids = antesMuitos.map((l) => l[idNome]);
        const depoisLinhas: Record<string, unknown>[] = await delegate.findMany({ where: { [idNome]: { in: ids } } });
        const mapa = new Map(depoisLinhas.map((l) => [String(l[idNome]), l]));
        for (const l of antesMuitos) {
          const d = mapa.get(String(l[idNome]));
          if (!d) continue;
          const sa = serie(l)!;
          const sd = serie(d)!;
          const campos = diferencas(sa, sd);
          if (campos.length && !ehNoOp(campos)) eventos.push({ tabela: model, ...chaveDe(model, l), tipo: 'ALTERAR', antes: sa, depois: sd, campos, modo: 'DIRETO', reversivel: true });
        }
      }
    } else if (op === 'createMany' || op === 'createManyAndReturn') {
      const linhas: Record<string, unknown>[] | null = criadosEmMassa ?? (Array.isArray(resultado) ? resultado : null);
      if (linhas) {
        if (linhas.length > MAX_LINHAS) eventos.push({ tabela: model, registroId: null, registroChave: null, tipo: 'CRIAR', antes: null, depois: { __resumo: `criação em massa de ${linhas.length} registros` }, campos: null, modo: 'DIRETO', reversivel: false });
        else for (const l of linhas) eventos.push({ tabela: model, ...chaveDe(model, l), tipo: 'CRIAR', antes: null, depois: serie(l), campos: null, modo: 'DIRETO', reversivel: true });
      } else {
        eventos.push({ tabela: model, registroId: null, registroChave: null, tipo: 'CRIAR', antes: null, depois: { __resumo: `criação em massa (${resultado?.count ?? '?'} registros)` }, campos: null, modo: 'DIRETO', reversivel: false });
      }
    }
    if (eventos.length) await gravar(db, ctx, eventos);
  } catch (e) {
    // a gravação original já aconteceu: nunca derruba a tela por causa da trilha
    throw { __trilhaFalhou: true, causa: (e as Error)?.message ?? e, resultado };
  }
  return resultado;
}

/**
 * Gravação SEM trilha (usada pelo próprio painel ao marcar reversões etc.).
 * Qualquer outro módulo deve usar o `prisma` normal.
 */
export function clienteSemTrilha(): PrismaClient {
  return baseCliente;
}
