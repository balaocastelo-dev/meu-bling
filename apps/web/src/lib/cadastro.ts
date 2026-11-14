/**
 * Espelho de `faltasCadastroCliente` da API: o que falta para a nota.
 * Não impede salvar nem fechar a venda.
 */
export interface DadosCadastro {
  id?: number;
  nome?: string | null;
  documento?: string | null;
  telefone?: string | null;
  celular?: string | null;
  email?: string | null;
  logradouro?: string | null;
  numero?: string | null;
  bairro?: string | null;
  municipio?: string | null;
  uf?: string | null;
  cep?: string | null;
}

const vazio = (v: string | null | undefined) => !v || !String(v).trim();

export function faltasCadastro(c: DadosCadastro | null | undefined): string[] {
  if (!c?.nome && !c?.id) return [];
  const faltas: string[] = [];
  const doc = (c.documento || '').replace(/\D/g, '');
  if (doc.length !== 11 && doc.length !== 14) faltas.push('CPF/CNPJ');
  if (vazio(c.celular) && vazio(c.telefone)) faltas.push('telefone');
  if (vazio(c.email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(c.email).trim())) faltas.push('e-mail');
  if (vazio(c.logradouro)) faltas.push('endereço');
  if (vazio(c.numero)) faltas.push('número');
  if (vazio(c.bairro)) faltas.push('bairro');
  if (vazio(c.municipio)) faltas.push('cidade');
  if (vazio(c.uf)) faltas.push('UF');
  if ((c.cep || '').replace(/\D/g, '').length !== 8) faltas.push('CEP');
  return faltas;
}

export function cadastroIncompleto(c: DadosCadastro | null | undefined) {
  return faltasCadastro(c).length > 0;
}
