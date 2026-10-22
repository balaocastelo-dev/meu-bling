/**
 * Helpers para as impressões em HTML (pedido de venda, compra, OS, etiqueta).
 * Tudo em português, pronto para window.print() no navegador.
 */
import { prisma } from '../../lib/prisma.js';
import { formatarData, formatarMoeda } from '../../lib/util.js';
import { logoParaHtml } from './logo.js';

export function esc(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export const moeda = (v: number | null | undefined) => formatarMoeda(v || 0);
export const data = (d: Date | string | null | undefined) => formatarData(d);
export const qtd = (v: number) => (Number.isInteger(v) ? String(v) : v.toLocaleString('pt-BR', { maximumFractionDigits: 4 }));

export function formatarDocumento(doc?: string | null): string {
  const d = (doc || '').replace(/\D/g, '');
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return doc || '';
}

export function formatarTelefone(t?: string | null): string {
  const d = (t || '').replace(/\D/g, '');
  const n = d.startsWith('55') && d.length >= 12 ? d.slice(2) : d;
  if (n.length === 11) return `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}`;
  if (n.length === 10) return `(${n.slice(0, 2)}) ${n.slice(2, 6)}-${n.slice(6)}`;
  return t || '';
}

export function formatarCep(c?: string | null): string {
  const d = (c || '').replace(/\D/g, '');
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : c || '';
}

export function enderecoLinha(e: {
  logradouro?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  municipio?: string | null;
  uf?: string | null;
  cep?: string | null;
}): string {
  const partes: string[] = [];
  if (e.logradouro) partes.push(`${e.logradouro}${e.numero ? ', ' + e.numero : ''}${e.complemento ? ' - ' + e.complemento : ''}`);
  if (e.bairro) partes.push(e.bairro);
  if (e.municipio || e.uf) partes.push([e.municipio, e.uf].filter(Boolean).join('/'));
  if (e.cep) partes.push('CEP ' + formatarCep(e.cep));
  return partes.join(' — ');
}

export async function dadosEmpresa() {
  const e = await prisma.empresa.findUnique({ where: { id: 1 } });
  return {
    nome: e?.nomeFantasia || e?.razaoSocial || 'Empresa',
    razaoSocial: e?.razaoSocial || '',
    cnpj: formatarDocumento(e?.cnpj),
    ie: e?.ie || '',
    telefone: formatarTelefone(e?.telefone),
    email: e?.email || '',
    site: e?.site || '',
    endereco: e ? enderecoLinha(e) : '',
    logoPath: e?.logoPath || null,
    /** logo embutido (data URI) para as impressões: não depende do endereço do sistema */
    logoSrc: await logoParaHtml(e?.logoPath),
    uf: e?.uf || '',
  };
}

/** CSS base das impressões (A4). */
export const CSS_BASE = `
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #111; margin: 0; padding: 18px 22px; background: #fff; }
  @page { size: A4; margin: 12mm; }
  @media print { body { padding: 0; } .no-print { display: none !important; } }
  h1 { font-size: 18px; margin: 0; }
  h2 { font-size: 13px; margin: 14px 0 6px; text-transform: uppercase; letter-spacing: .04em; color: #374151; border-bottom: 1px solid #d1d5db; padding-bottom: 3px; }
  .cabecalho { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; border-bottom: 2px solid #111; padding-bottom: 10px; }
  .empresa { display: flex; gap: 12px; align-items: center; }
  .empresa img { max-height: 64px; max-width: 160px; object-fit: contain; }
  .empresa .dados { font-size: 11px; line-height: 1.35; }
  .empresa .dados b { font-size: 14px; }
  .doc { text-align: right; }
  .doc .numero { font-size: 22px; font-weight: bold; }
  .doc .sit { display: inline-block; padding: 2px 8px; border-radius: 10px; color: #fff; font-size: 11px; margin-top: 4px; }
  .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px 18px; }
  .grid div { line-height: 1.4; }
  .grid b { color: #374151; }
  table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  th, td { border-bottom: 1px solid #e5e7eb; padding: 5px 6px; text-align: left; vertical-align: top; }
  th { background: #f3f4f6; font-size: 11px; text-transform: uppercase; }
  td.num, th.num { text-align: right; white-space: nowrap; }
  .totais { margin-top: 8px; margin-left: auto; width: 280px; }
  .totais td { border: none; padding: 2px 6px; }
  .totais tr.total td { border-top: 2px solid #111; font-weight: bold; font-size: 14px; }
  .obs { white-space: pre-wrap; background: #f9fafb; border: 1px solid #e5e7eb; padding: 8px; border-radius: 4px; }
  .assinatura { margin-top: 44px; display: flex; gap: 40px; }
  .assinatura div { flex: 1; border-top: 1px solid #111; text-align: center; padding-top: 4px; font-size: 11px; }
  .rodape { margin-top: 18px; font-size: 10px; color: #6b7280; text-align: center; }
  .botoes { position: fixed; top: 8px; right: 8px; }
  .botoes button { padding: 6px 12px; font-size: 12px; cursor: pointer; }
  .muted { color: #6b7280; }
`;

export function cabecalhoEmpresa(emp: Awaited<ReturnType<typeof dadosEmpresa>>): string {
  return `
  <div class="empresa">
    ${emp.logoSrc ? `<img src="${esc(emp.logoSrc)}" alt="logo">` : ''}
    <div class="dados">
      <b>${esc(emp.nome)}</b><br>
      ${esc(emp.razaoSocial)}${emp.cnpj ? ' — CNPJ ' + esc(emp.cnpj) : ''}${emp.ie ? ' — IE ' + esc(emp.ie) : ''}<br>
      ${esc(emp.endereco)}<br>
      ${[emp.telefone, emp.email, emp.site].filter(Boolean).map(esc).join(' · ')}
    </div>
  </div>`;
}

export function paginaHtml(titulo: string, corpo: string, cssExtra = ''): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titulo)}</title>
<style>${CSS_BASE}${cssExtra}</style>
</head>
<body>
<div class="botoes no-print"><button onclick="window.print()">Imprimir</button></div>
${corpo}
<script>if (location.search.includes('auto=1')) { window.addEventListener('load', () => setTimeout(() => window.print(), 300)); }</script>
</body>
</html>`;
}
