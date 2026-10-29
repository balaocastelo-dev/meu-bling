/**
 * CONTRATO DE CONSIGNAÇÃO (HTML pronto para imprimir ou "Salvar como PDF", com logo e versículo no rodapé).
 * O mesmo documento sai na loja (para assinar no papel) e no link do consignante (assinado pelo celular).
 *
 * Minuta montada com as regras do Thiago (28/10/2026). Vale passar por um advogado antes de usar em escala.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../lib/env.js';
import { esc, enderecoLinha, formatarDocumento, formatarTelefone } from '../comum/html.js';
import { logoParaHtml } from '../comum/logo.js';
import { COR_MARCA } from '../documentos/config.js';
import { sortearVersiculo } from '../documentos/versiculos.js';
import { assinaturaDataUri } from './service.js';
import { lerJson, moedaBr, planoDiarias, type ConsignacaoLida } from './nucleo.js';

const dataBr = (d: Date | string) => new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
const dataHoraBr = (d: Date | string) => new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
const extenso = (d: Date | string) => new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: 'numeric', month: 'long', year: 'numeric' });

const TIPOS: Record<string, string> = { NOTEBOOK: 'Notebook', PC: 'Computador', PC_GAMER: 'PC Gamer', CELULAR: 'Celular / iPhone', TABLET: 'Tablet / iPad', GAMES: 'Videogame', MONITOR: 'Monitor', OUTRO: 'Equipamento' };

async function fotosEmbutidas(c: { id: number; fotos: string | null }) {
  const nomes = lerJson<string[]>(c.fotos, []).slice(0, 4);
  const r: string[] = [];
  for (const n of nomes) {
    const b = await fs.readFile(path.join(env.STORAGE_DIR, 'consignados', String(c.id), path.basename(n))).catch(() => null);
    if (b) r.push(`data:image/jpeg;base64,${b.toString('base64')}`);
  }
  return r;
}

export async function htmlContrato(c: ConsignacaoLida, opts: { botaoImprimir?: boolean } = {}) {
  const emp = await prisma.empresa.findUnique({ where: { id: 1 } });
  const logo = await logoParaHtml(emp?.logoPath);
  const assinatura = await assinaturaDataUri(c);
  const fotos = await fotosEmbutidas(c);
  const v = sortearVersiculo();
  const plano = planoDiarias(c.valorConsignanteOriginal, c);
  const pessoa = c.consignante;
  const empNome = emp?.razaoSocial || emp?.nomeFantasia || 'Balão da Informática';
  const linha = (rotulo: string, valor: string | null | undefined) => (valor ? `<div><span class="r">${esc(rotulo)}</span><b>${esc(valor)}</b></div>` : '');
  const descontos = c.descontos.filter((d) => d.status === 'AUTORIZADO');

  const clausulas = [
    ['Objeto', `O(A) CONSIGNANTE entrega à CONSIGNATÁRIA, em consignação (contrato estimatório, arts. 534 a 537 do Código Civil), o equipamento descrito acima, para que a CONSIGNATÁRIA o exponha e venda em sua loja física e no site, em nome próprio.`],
    ['Preço e valor do consignante', `O preço de venda ao público é de <b>${moedaBr(c.precoVendaOriginal)}</b>. Do preço, o(a) CONSIGNANTE recebe <b>${moedaBr(c.valorConsignanteOriginal)}</b> (${c.percentualConsignante}%), valor <b>fixo e travado</b> neste contrato; a diferença é a remuneração da CONSIGNATÁRIA. Descontos que reduzam o valor do(a) CONSIGNANTE só valem com a autorização expressa dele(a), registrada pelo link do contrato ou por mensagem.`],
    ['Pagamento na venda', `Vendido o equipamento, a CONSIGNATÁRIA paga ao(à) CONSIGNANTE o valor que faltar para completar o valor do consignante <b>no mesmo dia da venda</b>, por PIX ou transferência para a conta indicada por ele(a).`],
    ['Prazo', `O prazo de consignação é de <b>${c.prazoDias} dias corridos</b>, de ${dataBr(c.dataEntrada)} a <b>${dataBr(c.dataLimite)}</b>.`],
    [
      'Equipamento não vendido no prazo',
      `Se o equipamento não for vendido no prazo e não for retirado, a CONSIGNATÁRIA passa a pagar ao(à) CONSIGNANTE <b>${c.diariaPct}% do valor do consignante por dia útil</b> (mínimo de ${moedaBr(c.diariaMinima)} e máximo de ${moedaBr(c.diariaMaxima)} por dia), a partir do primeiro dia útil após o prazo, até completar o valor — hoje, <b>${plano.quantidade} pagamento(s) de ${moedaBr(plano.diaria)}</b>. Completado o pagamento, a propriedade do equipamento passa à CONSIGNATÁRIA. Se o equipamento for vendido durante as diárias, o saldo restante é pago de uma vez ou segue nas diárias, a critério da CONSIGNATÁRIA, sem prejuízo do valor total.`,
    ],
    ['Retirada', `O(A) CONSIGNANTE pode retirar o equipamento a qualquer momento antes da venda. Antes do fim do prazo, paga taxa de retirada de <b>${moedaBr(c.taxaRetirada)}</b>; depois do prazo, a retirada é sem taxa. Se já tiver recebido diárias, devolve os valores recebidos no ato da retirada.`],
    ['Guarda do equipamento', `Enquanto estiver com a CONSIGNATÁRIA, o equipamento fica sob sua guarda e responsabilidade, que pode testá-lo, fotografá-lo e anunciá-lo. Em caso de perda, furto ou dano na loja, a CONSIGNATÁRIA responde pelo valor do consignante.`],
    ['Declaração de origem', `O(A) CONSIGNANTE declara ser o(a) legítimo(a) proprietário(a) do equipamento, de origem lícita, livre de dívidas, alienação, bloqueio de operadora ou de conta (iCloud, Google, Samsung etc.), e responde civil e criminalmente pela veracidade desta declaração. Autoriza a conferência do IMEI/número de série nos cadastros de bloqueio.`],
    ['Garantia ao comprador', `A CONSIGNATÁRIA dá ao comprador a garantia da loja para equipamentos seminovos (3 meses), conforme o termo de garantia entregue na venda.`],
    ['Comunicação e assinatura', `As partes aceitam comunicações por WhatsApp e pelo link do contrato, e reconhecem como válida a assinatura eletrônica feita pelo celular (art. 10, § 2º, da MP 2.200-2/2001), registrada com nome, documento, data, hora e endereço IP.`],
    ['Dados pessoais', `Os dados do(a) CONSIGNANTE são usados somente para este contrato, pagamentos e avisos, conforme a Lei Geral de Proteção de Dados (Lei 13.709/2018).`],
    ['Foro', `Fica eleito o foro da comarca de ${esc(emp?.municipio || 'Campinas')}/${esc(emp?.uf || 'SP')} para dirimir qualquer dúvida deste contrato.`],
  ];

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Contrato de consignação nº ${c.numero}</title>
<style>
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
@page { size: A4; margin: 0; }
html, body { margin: 0; padding: 0; background: #e5e7eb; font-family: 'Segoe UI', Arial, Helvetica, sans-serif; color: #111827; }
.botoes { position: fixed; top: 10px; right: 10px; z-index: 10; }
.botoes button { padding: 8px 14px; font-size: 13px; cursor: pointer; border: 0; border-radius: 6px; background: ${COR_MARCA}; color: #fff; font-weight: 600; box-shadow: 0 2px 6px rgba(0,0,0,.2); }
@media print { html, body { background: #fff; } .botoes { display: none !important; } .folha { margin: 0 !important; box-shadow: none !important; } }
.folha { width: 210mm; min-height: 297mm; margin: 12px auto; background: #fff; box-shadow: 0 4px 18px rgba(0,0,0,.15); padding: 11mm 13mm 9mm 15mm; position: relative; font-size: 10.3px; line-height: 1.5; display: flex; flex-direction: column; }
@media (max-width: 820px) { .folha { width: 100%; min-height: 0; padding: 18px 16px 14px 20px; margin: 0; } .grade, .assin { grid-template-columns: 1fr !important; } }
.faixa { position: absolute; left: 0; top: 0; bottom: 0; width: 5mm; background: linear-gradient(${COR_MARCA}, #a3120f); }
.topo { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding-bottom: 7px; border-bottom: 2.5px solid ${COR_MARCA}; }
.topo img { height: 46px; max-width: 190px; object-fit: contain; }
.topo .emp { flex: 1; font-size: 9.3px; color: #374151; } .topo .emp b { font-size: 11px; color: #111; }
.topo .doc { text-align: right; } .topo .doc .t { font-size: 9px; letter-spacing: .14em; color: #6b7280; font-weight: 700; text-transform: uppercase; } .topo .doc .n { font-size: 22px; font-weight: 800; }
h1 { font-size: 15px; text-align: center; margin: 10px 0 4px; letter-spacing: .04em; }
.sub { text-align: center; color: #4b5563; font-size: 10px; margin-bottom: 6px; }
.sec { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: .08em; color: ${COR_MARCA}; margin: 9px 0 4px; display: flex; align-items: center; gap: 6px; }
.sec::after { content: ''; flex: 1; height: 1px; background: #f3c4c3; }
.grade { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.caixa { border: 1px solid #e5e7eb; border-radius: 6px; padding: 6px 8px; background: #fafafa; display: grid; gap: 2px; }
.caixa .r { color: #6b7280; font-size: 8.3px; text-transform: uppercase; letter-spacing: .06em; display: block; } .caixa b { font-size: 10.5px; }
.valores { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
.valores div { border-radius: 8px; padding: 6px 8px; background: #fff6f6; border: 1px solid #f1d5d4; text-align: center; } .valores span { display: block; font-size: 8.3px; color: #6b7280; text-transform: uppercase; letter-spacing: .06em; } .valores b { font-size: 13px; color: ${COR_MARCA}; }
@media (max-width: 820px) { .valores { grid-template-columns: 1fr 1fr; } }
.fotos { display: flex; gap: 6px; } .fotos img { width: 25%; height: 80px; object-fit: cover; border-radius: 6px; border: 1px solid #eee; }
ol { margin: 4px 0 0; padding-left: 18px; } ol li { margin-bottom: 4px; text-align: justify; } ol li b.t { color: #111; }
.assin { display: grid; grid-template-columns: 1fr 1fr; gap: 26px; margin-top: 14px; align-items: end; }
.assin .bloco { text-align: center; font-size: 9px; color: #374151; } .assin .linha { border-top: 1px solid #111; padding-top: 3px; }
.assin img { max-height: 60px; max-width: 100%; display: block; margin: 0 auto 2px; }
.registro { font-size: 8.3px; color: #047857; margin-top: 2px; }
.rodape { margin-top: auto; padding-top: 7px; border-top: 1px solid #e5e7eb; text-align: center; }
.versiculo { font-family: Georgia, 'Times New Roman', serif; font-style: italic; color: #374151; font-size: 11px; } .versiculo b { font-style: normal; font-family: Arial; color: ${COR_MARCA}; font-size: .9em; }
.legal { font-size: 8px; color: #9ca3af; margin-top: 3px; }
</style></head><body>
${opts.botaoImprimir !== false ? '<div class="botoes"><button onclick="window.print()">Imprimir / Salvar PDF</button></div>' : ''}
<div class="folha"><div class="faixa"></div>
<div class="topo">
  ${logo ? `<img src="${logo}" alt="">` : ''}
  <div class="emp"><b>${esc(empNome)}</b><br>${emp?.cnpj ? `CNPJ ${esc(formatarDocumento(emp.cnpj))}<br>` : ''}${esc(emp ? enderecoLinha(emp) : '')}<br>${esc([formatarTelefone(emp?.telefone), emp?.email, emp?.site].filter(Boolean).join(' · '))}</div>
  <div class="doc"><div class="t">Consignação</div><div class="n">nº ${c.numero}</div><div>${dataBr(c.dataEntrada)}</div></div>
</div>
<h1>CONTRATO DE CONSIGNAÇÃO DE EQUIPAMENTO</h1>
<div class="sub">CONSIGNATÁRIA: <b>${esc(empNome)}</b> · CONSIGNANTE: <b>${esc(pessoa.nome)}</b></div>

<div class="sec">Consignante</div>
<div class="grade">
  <div class="caixa">${linha('Nome', pessoa.nome)}${linha('CPF / CNPJ', formatarDocumento(pessoa.documento))}${linha('RG', pessoa.rg)}</div>
  <div class="caixa">${linha('Endereço', enderecoLinha(pessoa))}${linha('Celular (WhatsApp)', formatarTelefone(pessoa.celular || pessoa.telefone))}${linha('E-mail', pessoa.email)}</div>
</div>

<div class="sec">Equipamento</div>
<div class="grade">
  <div class="caixa">${linha('Tipo', TIPOS[c.tipoEquipamento] || c.tipoEquipamento)}${linha('Descrição', c.descricao)}${linha('Marca / modelo', [c.marca, c.modelo].filter(Boolean).join(' '))}</div>
  <div class="caixa">${linha('Nº de série', c.numeroSerie)}${linha('IMEI', c.imei)}${linha('Estado', c.estado)}${linha('Acessórios', c.acessorios)}</div>
</div>
${fotos.length ? `<div class="fotos" style="margin-top:6px">${fotos.map((f) => `<img src="${f}" alt="">`).join('')}</div>` : ''}

<div class="sec">Valores</div>
<div class="valores">
  <div><span>Preço de venda</span><b>${moedaBr(c.precoVendaOriginal)}</b></div>
  <div><span>Você recebe (${c.percentualConsignante}%)</span><b>${moedaBr(c.valorConsignanteOriginal)}</b></div>
  <div><span>Prazo</span><b>até ${dataBr(c.dataLimite)}</b></div>
  <div><span>Depois do prazo</span><b>${moedaBr(plano.diaria)}/dia útil</b></div>
</div>
${descontos.length ? `<div class="legal" style="text-align:left;color:#374151">Descontos autorizados pelo consignante: ${descontos.map((d) => `${d.pct}% em ${dataBr(d.respondidoEm || d.pedidoEm)} (você recebe ${moedaBr(d.valorPara)})`).join('; ')}.</div>` : ''}

<div class="sec">Cláusulas</div>
<ol>${clausulas.map(([t, x]) => `<li><b class="t">${esc(t)}.</b> ${x}</li>`).join('')}</ol>

<div class="assin">
  <div class="bloco">
    ${assinatura ? `<img src="${assinatura}" alt="assinatura">` : '<div style="height:44px"></div>'}
    <div class="linha">${esc(c.assinaturaNome || pessoa.nome)} — CONSIGNANTE<br>CPF/CNPJ ${esc(formatarDocumento(c.assinaturaDocumento || pessoa.documento))}</div>
    ${c.assinadoEm ? `<div class="registro">${c.assinadoPor === 'CELULAR' ? `Assinado eletronicamente pelo celular em ${dataHoraBr(c.assinadoEm)}${c.assinaturaIp ? ` · IP ${esc(c.assinaturaIp)}` : ''}` : `Assinado na loja em ${dataHoraBr(c.assinadoEm)}`}</div>` : ''}
  </div>
  <div class="bloco"><div style="height:44px"></div><div class="linha">${esc(empNome)} — CONSIGNATÁRIA${c.vendedor ? `<br>Atendido por ${esc(c.vendedor.nome)}` : ''}</div></div>
</div>
<div style="text-align:center;font-size:9.5px;margin-top:8px">${esc(emp?.municipio || 'Campinas')}, ${extenso(c.dataEntrada)}.</div>

<div class="rodape"><div class="versiculo">“${esc(v.texto)}” <b>— ${esc(v.ref)}</b></div><div class="legal">Contrato nº ${c.numero} · acompanhe pelo link enviado no seu WhatsApp</div></div>
</div></body></html>`;
}
