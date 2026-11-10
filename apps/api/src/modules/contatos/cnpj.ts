/**
 * Consulta de CNPJ no cadastro público da Receita Federal — é o que o Bling chama
 * de "Importar do SEFAZ": digita o CNPJ, clica e o cadastro vem preenchido.
 *
 * Fonte principal: BrasilAPI (espelho oficial do cadastro da Receita, sem chave).
 * Reserva: ReceitaWS (gratuita, com limite por minuto) — só é usada se a primeira falhar.
 *
 * A Inscrição Estadual nem sempre vem nessas bases (a Receita não publica IE).
 * Quando vier, é devolvida; quando não vier, o campo volta vazio e quem cadastra
 * preenche à mão — por isso `ieEncontrada` diz se deu para trazer.
 */
import { AppError } from '../../lib/errors.js';
import { somenteDigitos } from '../../lib/util.js';
import { cnpjValido } from '../comum/nfe-checagem.js';

export interface DadosCnpj {
  documento: string;
  nome: string;
  fantasia: string;
  ie: string;
  ieEncontrada: boolean;
  email: string;
  telefone: string;
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  municipio: string;
  uf: string;
  codigoMunicipio: string;
  situacaoCadastral: string;
  /** true quando a Receita mostra a empresa como BAIXADA/INAPTA/SUSPENSA */
  irregular: boolean;
  fonte: string;
}

function texto(v: unknown): string {
  return v === null || v === undefined ? '' : String(v).trim();
}

/** "RUA DAS FLORES" → "Rua das Flores" (as bases devolvem tudo em caixa alta). */
function capitalizar(v: string): string {
  const miudas = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'em', 'para']);
  return v
    .toLocaleLowerCase('pt-BR')
    .split(/\s+/)
    .filter(Boolean)
    .map((p, i) => (i > 0 && miudas.has(p) ? p : p.charAt(0).toLocaleUpperCase('pt-BR') + p.slice(1)))
    .join(' ');
}

function telefoneDe(...partes: string[]): string {
  for (const p of partes) {
    const d = somenteDigitos(p);
    if (d.length >= 10) return d.slice(0, 11);
  }
  return '';
}

const IRREGULARES = ['BAIXADA', 'INAPTA', 'SUSPENSA', 'NULA'];

async function pegarJson(url: string, ms = 8000): Promise<any | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms), headers: { accept: 'application/json' } });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

/** BrasilAPI — /api/cnpj/v1/{cnpj} */
function daBrasilApi(j: any, cnpj: string): DadosCnpj | null {
  if (!j || (!j.razao_social && !j.nome_fantasia)) return null;
  // a BrasilAPI traz `inscricoes_estaduais` quando a UF publica o dado
  const insc = Array.isArray(j.inscricoes_estaduais) ? j.inscricoes_estaduais : [];
  const ativa = insc.find((i: any) => i?.ativo) || insc[0];
  const ie = somenteDigitos(texto(ativa?.inscricao_estadual));
  const situacao = texto(j.descricao_situacao_cadastral).toUpperCase();
  return {
    documento: cnpj,
    nome: capitalizar(texto(j.razao_social)),
    fantasia: capitalizar(texto(j.nome_fantasia)),
    ie,
    ieEncontrada: !!ie,
    email: texto(j.email).toLowerCase(),
    telefone: telefoneDe(texto(j.ddd_telefone_1), texto(j.ddd_telefone_2)),
    cep: somenteDigitos(texto(j.cep)),
    logradouro: capitalizar([texto(j.descricao_tipo_de_logradouro), texto(j.logradouro)].filter(Boolean).join(' ')),
    numero: texto(j.numero),
    complemento: capitalizar(texto(j.complemento)),
    bairro: capitalizar(texto(j.bairro)),
    municipio: capitalizar(texto(j.municipio)),
    uf: texto(j.uf).toUpperCase(),
    codigoMunicipio: somenteDigitos(texto(j.codigo_municipio_ibge)),
    situacaoCadastral: capitalizar(situacao),
    irregular: IRREGULARES.some((s) => situacao.includes(s)),
    fonte: 'Receita Federal (BrasilAPI)',
  };
}

/** ReceitaWS — /v1/cnpj/{cnpj} (reserva) */
function daReceitaWs(j: any, cnpj: string): DadosCnpj | null {
  if (!j || j.status === 'ERROR' || !texto(j.nome)) return null;
  const situacao = texto(j.situacao).toUpperCase();
  return {
    documento: cnpj,
    nome: capitalizar(texto(j.nome)),
    fantasia: capitalizar(texto(j.fantasia)),
    ie: '',
    ieEncontrada: false,
    email: texto(j.email).toLowerCase(),
    telefone: telefoneDe(texto(j.telefone).split('/')[0]),
    cep: somenteDigitos(texto(j.cep)),
    logradouro: capitalizar(texto(j.logradouro)),
    numero: texto(j.numero),
    complemento: capitalizar(texto(j.complemento)),
    bairro: capitalizar(texto(j.bairro)),
    municipio: capitalizar(texto(j.municipio)),
    uf: texto(j.uf).toUpperCase(),
    codigoMunicipio: '',
    situacaoCadastral: capitalizar(situacao),
    irregular: IRREGULARES.some((s) => situacao.includes(s)),
    fonte: 'Receita Federal (ReceitaWS)',
  };
}

/**
 * Busca os dados públicos de um CNPJ. Lança AppError com mensagem pronta
 * para a tela quando o CNPJ é inválido ou nenhuma base respondeu.
 */
export async function consultarCnpj(valor: string): Promise<DadosCnpj> {
  const cnpj = somenteDigitos(valor);
  if (cnpj.length !== 14) throw new AppError('O CNPJ deve ter 14 dígitos.', 400, 'CNPJ_INVALIDO');
  if (!cnpjValido(cnpj)) throw new AppError('Esse CNPJ não existe (dígito verificador errado). Confira os números.', 422, 'CNPJ_INVALIDO');

  const dados = daBrasilApi(await pegarJson(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`), cnpj) ?? daReceitaWs(await pegarJson(`https://receitaws.com.br/v1/cnpj/${cnpj}`), cnpj);

  if (!dados) {
    throw new AppError('Não encontrei esse CNPJ no cadastro da Receita agora. Tente de novo em instantes ou preencha à mão.', 404, 'CNPJ_NAO_ENCONTRADO');
  }
  return dados;
}
