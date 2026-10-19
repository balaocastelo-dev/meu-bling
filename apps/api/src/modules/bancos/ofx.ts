/**
 * Parser simples de OFX (SGML/XML) sem dependências: extrai blocos <STMTTRN>.
 * Suporta OFX 1.x (SGML, tags sem fechamento) e 2.x (XML).
 */
export interface TransacaoOfx {
  externalId: string;
  data: Date;
  valor: number;
  tipo: 'CREDITO' | 'DEBITO';
  descricao: string;
  trntype: string;
}

function tag(bloco: string, nome: string): string | null {
  const m = bloco.match(new RegExp(`<${nome}>\\s*([^<\\r\\n]*)`, 'i'));
  return m ? m[1].trim() : null;
}

/** DTPOSTED: 20261019120000[-3:BRT] ou 20261019 */
function parseDataOfx(v: string | null): Date {
  if (!v) return new Date();
  const d = v.replace(/\[.*$/, '');
  const ano = Number(d.slice(0, 4));
  const mes = Number(d.slice(4, 6)) - 1;
  const dia = Number(d.slice(6, 8));
  const hh = Number(d.slice(8, 10) || '12');
  const mm = Number(d.slice(10, 12) || '0');
  const dt = new Date(ano, mes, dia, hh, mm);
  return isNaN(dt.getTime()) ? new Date() : dt;
}

function parseValor(v: string | null): number {
  if (!v) return 0;
  const n = Number(v.replace(/\s/g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

export function parseOfx(conteudo: string): { transacoes: TransacaoOfx[]; contaBanco?: string; saldo?: number; saldoEm?: Date } {
  const texto = conteudo.replace(/\r/g, '');
  const transacoes: TransacaoOfx[] = [];
  const re = /<STMTTRN>([\s\S]*?)(?:<\/STMTTRN>|(?=<STMTTRN>)|(?=<\/BANKTRANLIST>)|$)/gi;
  let m: RegExpExecArray | null;
  const vistos = new Set<string>();
  while ((m = re.exec(texto))) {
    const b = m[1];
    const valor = parseValor(tag(b, 'TRNAMT'));
    const trntype = (tag(b, 'TRNTYPE') || (valor >= 0 ? 'CREDIT' : 'DEBIT')).toUpperCase();
    const fitid = tag(b, 'FITID');
    const memo = tag(b, 'MEMO');
    const name = tag(b, 'NAME');
    const descricao = [name, memo].filter(Boolean).join(' - ') || trntype;
    const data = parseDataOfx(tag(b, 'DTPOSTED'));
    const externalId = fitid || `${data.toISOString().slice(0, 10)}-${valor}-${descricao}`.slice(0, 120);
    if (vistos.has(externalId)) continue;
    vistos.add(externalId);
    transacoes.push({ externalId, data, valor, tipo: valor >= 0 ? 'CREDITO' : 'DEBITO', descricao, trntype });
  }
  const contaBanco = tag(texto, 'ACCTID') || undefined;
  const saldo = texto.match(/<LEDGERBAL>[\s\S]*?<BALAMT>\s*([^<\n]*)/i);
  const saldoEm = texto.match(/<LEDGERBAL>[\s\S]*?<DTASOF>\s*([^<\n]*)/i);
  return {
    transacoes,
    contaBanco,
    saldo: saldo ? parseValor(saldo[1]) : undefined,
    saldoEm: saldoEm ? parseDataOfx(saldoEm[1]) : undefined,
  };
}
