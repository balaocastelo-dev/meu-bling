/**
 * Nome público dos documentos (PDF, anexo de e-mail/WhatsApp e título da impressão).
 * Manter esta implementação IGUAL à de apps/web/src/lib/nome-arquivo.ts
 * (o monorepo não tem pacote compartilhado — as duas cópias precisam andar juntas).
 */

const LIMITE = 80;

/** "José da Silva" → "Jose-da-Silva". Vazio se não der nada utilizável. No máximo `max` caracteres. */
export function trechoNome(nome?: string | null, max = 40): string {
  if (nome == null) return '';
  const semAcento = String(nome).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const slug = semAcento.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!slug) return '';
  if (slug.length <= max) return slug;
  return slug.slice(0, Math.max(0, max)).replace(/-+$/g, '');
}

export type PartesNomeArquivo = {
  tipo: string;
  numero?: string | number | null;
  nomePessoa?: string | null;
  /** Entram antes do nome da pessoa, em pares quando fizer sentido (ex.: "Pedido", 25070). */
  extras?: Array<string | number | null | undefined>;
  /** Entra depois do nome da pessoa (ex.: "tecnico", "etiqueta", "2via"). */
  sufixo?: string | null;
  /** Padrão "pdf". String vazia = sem extensão (título de janela). */
  ext?: string;
};

/** Só ASCII seguro para nome de arquivo. Não corta: tipo e número não podem ser encurtados aqui. */
function pedaco(v: string | number | null | undefined): string {
  if (v === undefined || v === null) return '';
  const s = String(v).trim();
  if (!s) return '';
  return trechoNome(s, 10_000);
}

/**
 * Monta o basename com extensão.
 * Partes vazias são omitidas. O nome da pessoa é o que se corta para caber em 80 caracteres
 * (arquivo inteiro, com a extensão). Sem cliente utilizável: "Pedido-25070.pdf", nunca "Pedido-25070-.pdf".
 */
export function nomeArquivoDocumento(p: PartesNomeArquivo): string {
  const ext = (p.ext === undefined ? 'pdf' : p.ext).replace(/^\./, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const limite = Math.max(1, ext ? LIMITE - ext.length - 1 : LIMITE);

  const fixo = [pedaco(p.tipo), pedaco(p.numero)].filter(Boolean);
  let extras = (p.extras ?? []).map((e) => pedaco(e)).filter(Boolean);
  const sufixo = pedaco(p.sufixo);

  const montar = (pessoa: string, ex: string[], comSufixo: boolean) => {
    const partes = [...fixo, ...ex];
    if (pessoa) partes.push(pessoa);
    let base = partes.join('-');
    if (comSufixo && sufixo) base = base ? `${base}-${sufixo}` : sufixo;
    return base.replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  };

  while (extras.length && montar('', extras, true).length > limite) extras.pop();

  let pessoa = trechoNome(p.nomePessoa, 40);
  let stem = montar(pessoa, extras, true);
  if (stem.length > limite) {
    const semPessoa = montar('', extras, true);
    const maxPessoa = limite - semPessoa.length - (semPessoa ? 1 : 0);
    pessoa = maxPessoa > 0 ? trechoNome(p.nomePessoa, Math.min(40, maxPessoa)) : '';
    stem = montar(pessoa, extras, true);
  }
  if (stem.length > limite) stem = montar('', extras, false);
  if (stem.length > limite) stem = montar('', [], false);
  if (!stem) stem = 'documento';

  return ext ? `${stem}.${ext}` : stem;
}

/** Basename sem ".pdf" — é o <title> que o navegador usa em "Salvar como PDF". */
export function tituloDocumento(p: Omit<PartesNomeArquivo, 'ext'>): string {
  return nomeArquivoDocumento({ ...p, ext: 'pdf' }).replace(/\.pdf$/i, '');
}

/** DANFE: NF-{n}-Pedido-{venda}-{Cliente}.pdf, NFCe-…, -OS-…, ou só NF-{n}-{Cliente}.pdf. */
export function nomeArquivoDanfe(n: {
  numero?: string | number | null;
  modelo?: number | string | null;
  contato?: { nome?: string | null } | null;
  venda?: { numero?: string | number | null } | null;
  os?: { numero?: string | number | null } | null;
}): string {
  const extras: Array<string | number> = [];
  if (n.venda?.numero) extras.push('Pedido', n.venda.numero);
  else if (n.os?.numero) extras.push('OS', n.os.numero);
  return nomeArquivoDocumento({
    tipo: Number(n.modelo) === 65 ? 'NFCe' : 'NF',
    numero: n.numero,
    extras,
    nomePessoa: n.contato?.nome,
  });
}
