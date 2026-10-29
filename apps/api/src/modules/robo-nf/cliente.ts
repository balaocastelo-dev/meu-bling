/**
 * Robô de NF — completa o cadastro do cliente sozinho:
 *  - CEP → rua, bairro, cidade, UF e código IBGE (ViaCEP)
 *  - cidade + UF sem código IBGE → código IBGE (API do IBGE)
 *  - CNPJ → razão social e endereço (BrasilAPI / Receita)
 *  - tipo de pessoa e indicador de IE coerentes com o documento
 * Só preenche o que está VAZIO: nunca troca o que alguém digitou.
 */
import type { Db } from '../comum/nfe.js';
import { somenteDigitos } from '../../lib/util.js';
import { cnpjValido } from '../comum/nfe-checagem.js';
import { normalizar } from './ncm.js';

const vazio = (v: string | null | undefined) => !v || !String(v).trim();

/** fetch com timeout; nunca lança (devolve null) — o robô roda sozinho e não pode cair por causa de internet */
async function buscarJson<T>(url: string, ms = 6000): Promise<T | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms), headers: { 'User-Agent': 'MEU-BLING/robo-nf' } });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

// caches em memória (o robô repete muito os mesmos CEPs/cidades)
const cacheCep = new Map<string, any | null>();
const cacheIbge = new Map<string, { nome: string; id: number }[]>();
const cacheCnpj = new Map<string, any | null>();

async function consultarCep(cep: string) {
  if (cacheCep.has(cep)) return cacheCep.get(cep);
  const j = await buscarJson<any>(`https://viacep.com.br/ws/${cep}/json/`);
  const r = j && !j.erro ? j : null;
  if (j) cacheCep.set(cep, r); // só guarda resposta de verdade (sem internet tenta de novo depois)
  return r;
}

async function codigoIbge(municipio: string, uf: string): Promise<string | null> {
  const chave = uf.toUpperCase();
  let lista = cacheIbge.get(chave);
  if (!lista) {
    const j = await buscarJson<{ id: number; nome: string }[]>(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${chave}/municipios`, 10000);
    if (!j?.length) return null;
    lista = j.map((m) => ({ nome: normalizar(m.nome), id: m.id }));
    cacheIbge.set(chave, lista);
  }
  const alvo = normalizar(municipio);
  return String(lista.find((m) => m.nome === alvo)?.id ?? '') || null;
}

async function consultarCnpj(cnpj: string) {
  if (cacheCnpj.has(cnpj)) return cacheCnpj.get(cnpj);
  const j = await buscarJson<any>(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, 10000);
  if (j) cacheCnpj.set(cnpj, j.cnpj ? j : null);
  return j?.cnpj ? j : null;
}

/** Completa o cadastro do cliente; devolve a lista do que foi preenchido (em português). */
export async function completarCliente(db: Db, contatoId: number): Promise<string[]> {
  const c = await db.contato.findUnique({ where: { id: contatoId } });
  if (!c) return [];
  const feito: string[] = [];
  const dados: Record<string, any> = {};
  const atual = (campo: string) => (campo in dados ? dados[campo] : (c as any)[campo]);
  const preencher = (campo: string, valor: string | null | undefined, rotulo: string) => {
    if (valor && String(valor).trim() && vazio(atual(campo))) {
      dados[campo] = String(valor).trim();
      feito.push(`${rotulo}: ${String(valor).trim()}`);
    }
  };

  const doc = somenteDigitos(c.documento);
  // tipo de pessoa pelo tamanho do documento
  if (doc.length === 14 && c.tipoPessoa !== 'J') {
    dados.tipoPessoa = 'J';
    feito.push('tipo de pessoa: jurídica (CNPJ)');
  } else if (doc.length === 11 && c.tipoPessoa === 'J') {
    dados.tipoPessoa = 'F';
    feito.push('tipo de pessoa: física (CPF)');
  }

  // CNPJ → dados da Receita
  if (doc.length === 14 && cnpjValido(doc) && (vazio(c.logradouro) || vazio(c.cep) || vazio(c.municipio) || vazio(c.fantasia))) {
    const r = await consultarCnpj(doc);
    if (r) {
      // o nome só é trocado se estiver claramente provisório (igual ao documento ou vazio)
      if (r.razao_social && (vazio(c.nome) || somenteDigitos(c.nome) === doc)) {
        dados.nome = String(r.razao_social).trim();
        feito.push(`razão social: ${dados.nome}`);
      }
      preencher('fantasia', r.nome_fantasia, 'nome fantasia');
      preencher('cep', somenteDigitos(r.cep), 'CEP');
      preencher('logradouro', [r.descricao_tipo_de_logradouro, r.logradouro].filter(Boolean).join(' '), 'rua');
      preencher('numero', r.numero, 'número');
      preencher('complemento', r.complemento, 'complemento');
      preencher('bairro', r.bairro, 'bairro');
      preencher('municipio', r.municipio, 'cidade');
      preencher('uf', r.uf, 'UF');
      if (r.codigo_municipio_ibge) preencher('codigoMunicipio', String(r.codigo_municipio_ibge), 'código IBGE');
    }
  }

  // CEP → endereço
  const cep = somenteDigitos(atual('cep'));
  const faltaEndereco = ['logradouro', 'bairro', 'municipio', 'uf'].some((k) => vazio(atual(k))) || somenteDigitos(atual('codigoMunicipio')).length !== 7;
  if (cep.length === 8 && faltaEndereco) {
    const r = await consultarCep(cep);
    if (r) {
      preencher('logradouro', r.logradouro, 'rua');
      preencher('bairro', r.bairro, 'bairro');
      preencher('municipio', r.localidade, 'cidade');
      preencher('uf', r.uf, 'UF');
      if (somenteDigitos(atual('codigoMunicipio')).length !== 7 && r.ibge) {
        dados.codigoMunicipio = String(r.ibge);
        feito.push(`código IBGE: ${r.ibge}`);
      }
    }
  }

  // cidade + UF sem código IBGE (cadastro antigo sem CEP)
  if (somenteDigitos(atual('codigoMunicipio')).length !== 7 && !vazio(atual('municipio')) && String(atual('uf') || '').length === 2) {
    const ibge = await codigoIbge(atual('municipio'), atual('uf'));
    if (ibge) {
      dados.codigoMunicipio = ibge;
      feito.push(`código IBGE: ${ibge}`);
    }
  }

  // indicador de IE coerente (1 contribuinte, 2 isento, 9 não contribuinte)
  const pj = (atual('tipoPessoa') || c.tipoPessoa) === 'J';
  const indicador = !pj ? 9 : !vazio(c.ie) ? 1 : c.ieIsento ? 2 : 9;
  if (c.indicadorIe !== indicador) {
    dados.indicadorIe = indicador;
    if (pj) feito.push(`indicador de IE: ${indicador === 1 ? 'contribuinte' : indicador === 2 ? 'isento' : 'não contribuinte'}`);
  }

  if (Object.keys(dados).length) await db.contato.update({ where: { id: c.id }, data: dados });
  return feito.map((f) => `Cliente ${c.nome} — ${f}`);
}
