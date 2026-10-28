/**
 * PIX "copia e cola" estático (BR Code / EMV-QRCPS-MPM do Banco Central) com valor fixo.
 * Qualquer app de banco lê o QR e já mostra recebedor (Balão da Informática / Cora), valor e identificador.
 */

const campo = (id: string, valor: string) => `${id}${String(valor.length).padStart(2, '0')}${valor}`;

/** remove acentos e caracteres fora do permitido; maiúsculas; corta no tamanho */
export function limparTexto(t: string, max: number) {
  return (t || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 $%*+\-./:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
    .slice(0, max)
    .trim();
}

/** CRC16-CCITT (polinômio 0x1021, início 0xFFFF) — exigido no campo 63 */
export function crc16(payload: string) {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** chave PIX: CNPJ/CPF/telefone só dígitos (telefone com +55), e-mail e chave aleatória como vieram */
export function normalizarChave(chave: string) {
  const c = (chave || '').trim();
  if (c.includes('@') || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(c)) return c;
  if (c.startsWith('+')) return '+' + c.slice(1).replace(/\D/g, '');
  return c.replace(/\D/g, '');
}

export interface PixParams {
  chave: string;
  nome: string;
  cidade: string;
  valor: number;
  /** identificador da cobrança (até 25 letras/números) */
  txid?: string;
  descricao?: string;
}

export function pixCopiaECola(p: PixParams) {
  const gui = campo('00', 'br.gov.bcb.pix') + campo('01', normalizarChave(p.chave)) + (p.descricao ? campo('02', limparTexto(p.descricao, 40)) : '');
  const txid = (p.txid || '***').replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***';
  const corpo =
    campo('00', '01') +
    campo('26', gui) +
    campo('52', '0000') +
    campo('53', '986') +
    (p.valor > 0 ? campo('54', p.valor.toFixed(2)) : '') +
    campo('58', 'BR') +
    campo('59', limparTexto(p.nome, 25) || 'RECEBEDOR') +
    campo('60', limparTexto(p.cidade, 15) || 'SAO PAULO') +
    campo('62', campo('05', txid)) +
    '6304';
  return corpo + crc16(corpo);
}

/** confere um copia e cola (usado nos testes e para validar o que foi impresso) */
export function pixValido(codigo: string) {
  if (!codigo || codigo.length < 30 || !codigo.startsWith('000201')) return false;
  return crc16(codigo.slice(0, -4)) === codigo.slice(-4);
}

/** lê os campos de primeiro nível (id → valor) */
export function lerPix(codigo: string) {
  const out: Record<string, string> = {};
  let i = 0;
  while (i + 4 <= codigo.length) {
    const id = codigo.slice(i, i + 2);
    const n = Number(codigo.slice(i + 2, i + 4));
    out[id] = codigo.slice(i + 4, i + 4 + n);
    i += 4 + n;
  }
  return out;
}
