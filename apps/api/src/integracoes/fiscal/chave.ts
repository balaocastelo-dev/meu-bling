/**
 * Chave de acesso da NF-e (44 dígitos) e dígito verificador (módulo 11).
 * cUF(2) AAMM(4) CNPJ(14) mod(2) serie(3) nNF(9) tpEmis(1) cNF(8) cDV(1)
 */
export const CODIGO_UF: Record<string, string> = {
  RO: '11', AC: '12', AM: '13', RR: '14', PA: '15', AP: '16', TO: '17',
  MA: '21', PI: '22', CE: '23', RN: '24', PB: '25', PE: '26', AL: '27', SE: '28', BA: '29',
  MG: '31', ES: '32', RJ: '33', SP: '35',
  PR: '41', SC: '42', RS: '43',
  MS: '50', MT: '51', GO: '52', DF: '53',
};

export function modulo11(valor: string): number {
  let soma = 0;
  let peso = 2;
  for (let i = valor.length - 1; i >= 0; i--) {
    soma += Number(valor[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  const dv = 11 - resto;
  return dv >= 10 ? 0 : dv;
}

export interface DadosChave {
  uf: string;
  dataEmissao: Date;
  cnpj: string;
  modelo: number;
  serie: number;
  numero: number;
  tipoEmissao?: number;
  codigoNumerico?: string;
}

export function gerarChaveAcesso(d: DadosChave): { chave: string; cNF: string; cDV: string } {
  const cUF = CODIGO_UF[d.uf.toUpperCase()];
  if (!cUF) throw new Error(`UF inválida para chave de acesso: ${d.uf}`);
  const aamm = `${String(d.dataEmissao.getFullYear()).slice(2)}${String(d.dataEmissao.getMonth() + 1).padStart(2, '0')}`;
  const cnpj = d.cnpj.replace(/\D/g, '').padStart(14, '0');
  const mod = String(d.modelo).padStart(2, '0');
  const serie = String(d.serie).padStart(3, '0');
  const nNF = String(d.numero).padStart(9, '0');
  const tpEmis = String(d.tipoEmissao ?? 1);
  let cNF = d.codigoNumerico ?? String(Math.floor(Math.random() * 99999999)).padStart(8, '0');
  // cNF não pode ser igual ao número da nota
  if (Number(cNF) === d.numero) cNF = String((Number(cNF) + 1) % 100000000).padStart(8, '0');
  const semDv = `${cUF}${aamm}${cnpj}${mod}${serie}${nNF}${tpEmis}${cNF}`;
  const cDV = String(modulo11(semDv));
  return { chave: semDv + cDV, cNF, cDV };
}

export function formatarChave(chave: string): string {
  return chave.replace(/(\d{4})(?=\d)/g, '$1 ');
}
